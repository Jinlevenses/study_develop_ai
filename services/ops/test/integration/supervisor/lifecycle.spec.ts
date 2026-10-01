import { spawn } from 'node:child_process';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RegistryFile, SupervisorLockFile } from '../../../src/supervisor/runtime-files.js';
import {
  adopt,
  cleanupAll,
  isAlive,
  logRecords,
  readRegistry,
  SERVICES,
  spawnSupervisor,
  startSupervisor,
  waitFor,
  waitReady,
  writeEntries,
} from './harness.js';

afterEach(cleanupAll);

async function fileMode(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}

async function forkTimes(home: string, svc: string): Promise<number[]> {
  return (await logRecords(home, 'supervisor'))
    .filter((r) => r.event === 'supervisor.child.forked' && r.child === svc)
    .map((r) => Number(r.ts));
}

function pidsOf(home: string): number[] {
  const reg = readRegistry(home);
  return Object.values(reg?.services ?? {}).flatMap((s) => (s.pid === null ? [] : [s.pid]));
}

describe('supervisor 프로세스 수명주기 (진짜 supervisor + fixture)', () => {
  it('IT-520 콜드 기동: 전원 ready ≤ 10s·gateway는 content·learning ready 뒤·registry/lock/cli.token 형식 [FR-SET-001][NFR-PERF-008]', async () => {
    const t0 = Date.now();
    const sup = await startSupervisor();
    const reg = await waitReady(sup, 10_000);
    expect(Date.now() - t0).toBeLessThanOrEqual(10_000);
    const registryPath = path.join(sup.home, 'run', 'registry.json');
    const text = await readFile(registryPath, 'utf8');
    expect(RegistryFile.safeParse(JSON.parse(text)).success).toBe(true);
    expect(text).not.toMatch(/[0-9a-f]{64}/); // 토큰 0
    expect(await fileMode(registryPath)).toBe(0o600);
    expect(Object.keys(reg.services).sort()).toEqual([...SERVICES].sort());
    const lock = SupervisorLockFile.parse(
      JSON.parse(await readFile(path.join(sup.home, 'run', 'supervisor.lock'), 'utf8')),
    );
    expect(lock).toMatchObject({ pid: sup.proc.pid, boot_id: reg.boot_id, profile: 'test' });
    const tokenPath = path.join(sup.home, 'run', 'cli.token');
    expect(await readFile(tokenPath, 'utf8')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await fileMode(tokenPath)).toBe(0o600);
    // gateway fork 시각 > content·learning ready 시각(fixture ready 로그 ts)
    const gatewayFork = (await forkTimes(sup.home, 'gateway'))[0] ?? 0;
    for (const svc of ['content', 'learning'] as const) {
      const ready = (await logRecords(sup.home, svc)).find((r) => r.msg === 'fixture.ready');
      expect(Number(ready?.ts)).toBeLessThanOrEqual(gatewayFork);
    }
  });

  it('IT-521 E0-7: supervisor SIGKILL → 자식 5 + 손자 전부 ≤ 5s 종료(고아 0) [NFR-AVL-003][RK-13]', async () => {
    const sup = await startSupervisor({ fx: { content: ['--fx-grandchild'] } });
    await waitReady(sup);
    const grand = await waitFor('grandchild pid', async () => {
      const rec = (await logRecords(sup.home, 'content')).find((r) => r.msg === 'fixture.grandchild');
      return typeof rec?.pid === 'number' ? rec.pid : null;
    });
    const pids = [...pidsOf(sup.home), grand];
    expect(pids).toHaveLength(6);
    for (const p of pids) {
      expect(isAlive(p)).toBe(true);
    }
    process.kill(sup.proc.pid ?? 0, 'SIGKILL');
    await waitFor('all orphans gone', () => pids.every((p) => !isAlive(p)), 5000);
  });

  it('IT-522 E0-7: content SIGKILL → 새 pid ready ≤ 5s·같은 포트·restarts=1·새 봉투 after_crash [NFR-AVL-003][FR-SET-001]', async () => {
    const sup = await startSupervisor();
    const before = (await waitReady(sup)).services.content;
    expect(before?.pid).toBeTruthy();
    const killedAt = Date.now();
    process.kill(before?.pid ?? 0, 'SIGKILL');
    const after = await waitFor(
      'content restarted',
      () => {
        const c = readRegistry(sup.home)?.services.content;
        return c !== undefined && c.pid !== before?.pid && c.state === 'ready' ? c : null;
      },
      5000,
    );
    expect(Date.now() - killedAt).toBeLessThanOrEqual(5000);
    expect(after.port).toBe(before?.port);
    expect(after.restarts).toBe(1);
    const ready = (await logRecords(sup.home, 'content')).filter((r) => r.msg === 'fixture.ready');
    expect(ready.map((r) => r.after_crash)).toEqual([false, true]);
  });

  it('IT-523 크래시 루프: 4번째 크래시 후 degraded·fork 4회·간격 ≥ 250·1000·2000ms [NFR-AVL-003]', async () => {
    const sup = await startSupervisor({ fx: { content: ['--fx-crash-after-ms=50'] } });
    const reg = await waitFor(
      'content degraded',
      () => {
        const r = readRegistry(sup.home);
        return r?.services.content?.state === 'degraded' ? r : null;
      },
      20_000,
    );
    expect(reg.services.content?.reason).toBe('crash_loop');
    const times = await forkTimes(sup.home, 'content');
    expect(times).toHaveLength(4);
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    expect(gaps[0]).toBeGreaterThanOrEqual(250);
    expect(gaps[1]).toBeGreaterThanOrEqual(1000);
    expect(gaps[2]).toBeGreaterThanOrEqual(2000);
  });

  it('IT-524 --fx-exit=78 → fork 1회·degraded·reason에 fatal 코드 [FR-SET-002]', async () => {
    const sup = await startSupervisor({ fx: { content: ['--fx-exit=78'] } });
    const reg = await waitFor('content degraded', () => {
      const r = readRegistry(sup.home);
      return r?.services.content?.state === 'degraded' ? r : null;
    });
    expect(reg.services.content?.reason).toBe('exit_78:fx_schema_needs_migrate');
    expect(reg.state).toBe('degraded');
    expect(await forkTimes(sup.home, 'content')).toHaveLength(1);
    expect(reg.services.gateway?.pid).toBeNull();
  });

  it('IT-525 learning 해시 불일치 → degraded(contracts_hash_mismatch)·gateway 미기동·전체 degraded [NFR-MAINT-006]', async () => {
    const sup = await startSupervisor({ fx: { learning: [`--fx-hash=${'ab'.repeat(32)}`] } });
    const reg = await waitFor('learning degraded', () => {
      const r = readRegistry(sup.home);
      return r?.services.learning?.state === 'degraded' ? r : null;
    });
    expect(reg.services.learning?.reason).toBe('contracts_hash_mismatch');
    expect(reg.state).toBe('degraded');
    expect(reg.services.gateway).toMatchObject({ pid: null, state: 'stopped' });
    expect(await forkTimes(sup.home, 'learning')).toHaveLength(1);
    expect(await forkTimes(sup.home, 'gateway')).toHaveLength(0);
  });

  it('IT-526 SIGTERM → gateway → {content,learning,ai-gateway} → ops-api 순 종료·exit 0·lock·cli.token 삭제·registry stopped [FR-SET-001]', async () => {
    const sup = await startSupervisor();
    await waitReady(sup);
    process.kill(sup.proc.pid ?? 0, 'SIGTERM');
    expect(await sup.exit).toBe(0);
    const at = async (svc: string): Promise<number> =>
      Number((await logRecords(sup.home, svc)).find((r) => r.msg === 'fixture.shutdown')?.at);
    const gateway = await at('gateway');
    const tier2 = [await at('content'), await at('learning'), await at('ai-gateway')];
    const ops = await at('ops-api');
    for (const t of tier2) {
      expect(t).toBeGreaterThanOrEqual(gateway);
      expect(ops).toBeGreaterThanOrEqual(t);
    }
    await expect(access(path.join(sup.home, 'run', 'supervisor.lock'))).rejects.toThrow();
    await expect(access(path.join(sup.home, 'run', 'cli.token'))).rejects.toThrow();
    const reg = RegistryFile.parse(JSON.parse(await readFile(path.join(sup.home, 'run', 'registry.json'), 'utf8')));
    expect(reg.state).toBe('stopped');
    expect(Object.values(reg.services).every((s) => s?.state === 'stopped')).toBe(true);
  });

  it('IT-527 --fx-hang-shutdown → grace 3000 + 2000ms 뒤 강제 종료·exit 0·잔존 0 [NFR-AVL-003]', async () => {
    const sup = await startSupervisor({ fx: { content: ['--fx-hang-shutdown'] } });
    const reg = await waitReady(sup);
    const pids = Object.values(reg.services).flatMap((s) => (s.pid === null ? [] : [s.pid]));
    const t0 = Date.now();
    process.kill(sup.proc.pid ?? 0, 'SIGTERM');
    expect(await sup.exit).toBe(0);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(4900);
    expect(elapsed).toBeLessThan(9000);
    for (const p of pids) {
      expect(isAlive(p)).toBe(false);
    }
  });

  it('IT-528 --safe → ai-gateway fork 0·content 봉투 batch_enabled=false·safe_mode=true [NFR-AVL-009][FR-SET-001]', async () => {
    const sup = await startSupervisor({ extra: ['--safe'] });
    const reg = await waitReady(sup);
    expect(reg.services['ai-gateway']).toMatchObject({ pid: null, state: 'stopped', reason: 'safe_mode' });
    expect(await forkTimes(sup.home, 'ai-gateway')).toHaveLength(0);
    const ready = (await logRecords(sup.home, 'content')).find((r) => r.msg === 'fixture.ready');
    expect(ready).toMatchObject({ batch_enabled: false, safe_mode: true });
  });

  it('IT-529 두 번째 supervisor → exit 75·기존 상태 불변, 죽은 pid lock → 인수 + 첫 봉투 전원 after_crash [FR-SET-001]', async () => {
    const sup = await startSupervisor();
    const reg = await waitReady(sup);
    const lockPath = path.join(sup.home, 'run', 'supervisor.lock');
    const lockBefore = await readFile(lockPath, 'utf8');
    const second = adopt(spawnSupervisor(sup.home, sup.entriesFile));
    expect(await second.exit).toBe(75);
    expect(second.stderr()).toContain('already_running');
    expect(await readFile(lockPath, 'utf8')).toBe(lockBefore);
    expect(readRegistry(sup.home)?.boot_id).toBe(reg.boot_id);
    process.kill(sup.proc.pid ?? 0, 'SIGTERM');
    expect(await sup.exit).toBe(0);

    // 죽은 pid가 남긴 lock
    const dead = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
    await new Promise<void>((resolve) => dead.once('exit', () => resolve()));
    const stale = { pid: dead.pid, boot_id: reg.boot_id, version: '0.0.0', started_at: 1, profile: 'test' };
    const entries = await writeEntries(path.dirname(sup.entriesFile));
    await writeFile(lockPath, `${JSON.stringify(stale)}\n`);
    adopt(spawnSupervisor(sup.home, entries));
    await waitFor('taken over ready', () => {
      const r = readRegistry(sup.home);
      return r !== null && r.boot_id !== reg.boot_id && r.state === 'ready' ? r : null;
    });
    const gatewayReady = (await logRecords(sup.home, 'gateway')).filter((r) => r.msg === 'fixture.ready');
    expect(gatewayReady.at(-1)?.after_crash).toBe(true);
    for (const svc of SERVICES) {
      expect((await logRecords(sup.home, svc)).filter((r) => r.msg === 'fixture.ready').at(-1)?.after_crash).toBe(true);
    }
  });
});
