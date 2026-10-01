import { access, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupAll,
  isAlive,
  logLines,
  logRecords,
  readRegistry,
  startSupervisor,
  supervisorEnv,
  waitFor,
  waitReady,
} from './harness.js';

afterEach(cleanupAll);

type Response = {
  type: string;
  ok?: boolean;
  exit_code?: number;
  tail?: string[];
  lines?: string[];
  services?: { svc: string }[];
};
type OpsReport = { pid: number; env_keys: string[]; responses: Record<string, Response> };

async function readReport(file: string): Promise<OpsReport | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as OpsReport;
  } catch {
    return null;
  }
}

describe('supervisor 제어 IPC · 환경 · 로그 (진짜 supervisor + fixture)', () => {
  it('IT-530 ops-api fixture: status·logs.tail·svc.restart(새 pid)·svc.run_mode 응답 기록 [FR-SET-007][IF-IPC-008~016]', async () => {
    const report = path.join(tmpdir(), `fathom-ops-report-${process.pid}.json`);
    const sup = await startSupervisor({
      fx: { 'ops-api': ['--fx-ops=status,logs,restart,run_mode', `--fx-report=${report}`] },
    });
    const done = await waitFor(
      'ops report',
      async () => {
        const r = await readReport(report);
        return r !== null && r.responses.run_mode !== undefined ? r : null;
      },
      30_000,
    );
    expect(done.responses.status?.type).toBe('status');
    expect(done.responses.status?.services?.[0]?.svc).toBe('supervisor');
    expect(done.responses.logs?.type).toBe('logs.tail.result');
    expect(Array.isArray(done.responses.logs?.lines)).toBe(true);
    expect(done.responses.restart).toMatchObject({ type: 'svc.ack', ok: true });
    expect(done.responses.run_mode).toMatchObject({ type: 'svc.run_mode.result', exit_code: 0 });
    expect(done.responses.run_mode?.tail?.some((l) => l.includes('fixture.migrate.done'))).toBe(true);
    const forks = (await logRecords(sup.home, 'supervisor')).filter(
      (r) => r.event === 'supervisor.child.forked' && r.child === 'content',
    );
    expect(forks.length).toBeGreaterThanOrEqual(2); // 새 pid로 재시작
    expect(new Set(forks.map((r) => r.child_pid)).size).toBe(forks.length);
    expect(readRegistry(sup.home)?.services.learning).toMatchObject({ state: 'stopped', pid: null }); // 자동 재기동 0
    await rm(report, { force: true });
  });

  it('IT-531 ops-api fixture shutdown.all{3000} → ack 수신 후 전체 종료·supervisor exit 0 [IF-IPC-017][FR-SET-001]', async () => {
    const report = path.join(tmpdir(), `fathom-ops-shutdown-${process.pid}.json`);
    const sup = await startSupervisor({ fx: { 'ops-api': ['--fx-ops=shutdown', `--fx-report=${report}`] } });
    expect(await sup.exit).toBe(0);
    const r = await readReport(report);
    expect(r?.responses.shutdown).toMatchObject({ type: 'svc.ack', ok: true });
    await expect(access(path.join(sup.home, 'run', 'supervisor.lock'))).rejects.toThrow();
    expect(readRegistry(sup.home)?.state).toBe('stopped');
    await rm(report, { force: true });
  });

  it('IT-532 자식 env = 허용 목록(값 있는 것) ∪ {FATHOM_HOME, NODE_OPTIONS}·/proc environ에 토큰 0 [NFR-SEC-003]', async () => {
    const report = path.join(tmpdir(), `fathom-env-${process.pid}.json`);
    const env = supervisorEnv({
      LANG: 'C',
      TZ: 'UTC',
      ANTHROPIC_API_KEY: 'sk-test-secret',
      CI: '1',
      HTTPS_PROXY: 'http://proxy.invalid:3128',
      NODE_OPTIONS: '--max-old-space-size=256',
      UNLISTED_VAR: 'x',
    });
    const sup = await startSupervisor({ fx: { content: [`--fx-report=${report}`] }, env });
    await waitReady(sup);
    const r = await waitFor('env report', () => readReport(report));
    const expected = ['PATH', 'HOME', 'LANG', 'TZ'].filter((k) => env[k] !== undefined && env[k] !== '');
    const actual = r.env_keys.filter((k) => !k.startsWith('NODE_CHANNEL'));
    expect([...actual].sort()).toEqual([...expected, 'FATHOM_HOME', 'NODE_OPTIONS'].sort());
    if (process.platform === 'linux') {
      const environ = await readFile(`/proc/${r.pid}/environ`, 'utf8');
      expect(environ).not.toMatch(/[0-9a-f]{64}/);
      expect(environ).not.toContain('sk-test-secret');
      expect(environ).toContain('--max-old-space-size=256 --disable-warning=ExperimentalWarning');
    }
    await rm(report, { force: true });
  });

  it('IT-533 --fx-sqlite: 자식·spawn 손자 stderr에 ExperimentalWarning 0줄(대조군 1줄만) [NFR-PORT-002][FR-SET-012]', async () => {
    const sup = await startSupervisor({ fx: { content: ['--fx-sqlite', '--fx-sqlite-control'] } });
    await waitReady(sup);
    const lines = await waitFor('sqlite grandchild + control output', async () => {
      const all = await logLines(sup.home, 'content');
      const ran = all.filter((l) => l.includes('fixture.sqlite.grandchild')).length;
      const warned = all.filter((l) => l.includes('ExperimentalWarning')).length;
      return ran >= 2 && warned >= 1 ? all : null;
    });
    // 병합된 NODE_OPTIONS를 받은 손자는 경고가 없고, NODE_OPTIONS를 지운 대조 손자만 경고를 낸다.
    expect(lines.filter((l) => l.includes('ExperimentalWarning'))).toHaveLength(1);
  });

  it('IT-534 --fx-raw-line → logs/<svc>/<UTC date>.jsonl에 {level:fatal, svc, raw} 1줄·JSON 줄은 원문 그대로 [NFR-AVL-007]', async () => {
    const sup = await startSupervisor({ fx: { content: ['--fx-raw-line'] } });
    await waitReady(sup);
    const records = await waitFor('raw line record', async () => {
      const recs = await logRecords(sup.home, 'content');
      return recs.some((r) => r.raw !== undefined) ? recs : null;
    });
    const raw = records.filter((r) => r.raw !== undefined);
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ level: 'fatal', svc: 'content', raw: 'NATIVE CRASH output (not json)' });
    const ready = records.find((r) => r.msg === 'fixture.ready');
    expect(ready).toMatchObject({ svc: 'fixture', level: 'info' }); // fixture가 쓴 JSON 원문(감싸지 않음)
    const dir = path.join(sup.home, 'logs', 'content');
    const names = await readdir(dir);
    expect(names.every((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))).toBe(true);
    expect(isAlive(sup.proc.pid ?? 0)).toBe(true);
  });
});
