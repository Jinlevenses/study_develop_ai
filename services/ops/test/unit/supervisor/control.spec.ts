import { ulid } from '@fathom/shared-kernel/ids/ids';
import { describe, expect, it } from 'vitest';
import { runModeArgv } from '../../../src/supervisor/run-mode.js';
import type { Harness } from './fakes.js';
import { createHarness, flush } from './fakes.js';

type Msg = Record<string, unknown>;

/** ops-api 자식이 요청을 보내고, 같은 `re`를 가진 응답을 돌려받는다. */
async function ask(h: Harness, body: Msg): Promise<Msg | undefined> {
  const id = ulid();
  const ops = h.spawn.last('ops-api');
  ops.message({ v: 1, id, ...body });
  await flush();
  return ops.sent.find((m) => m.re === id);
}

describe('ops-api 제어 IPC (IF-IPC-008~017)', () => {
  it('UT-SUP-040 svc.stop·start·restart는 작업 완료 후 ack(re = 요청 id) [FR-SET-007][IF-IPC-008~010]', async () => {
    const h = createHarness();
    await h.up();
    const stopId = ulid();
    h.spawn.last('ops-api').message({ v: 1, id: stopId, type: 'svc.stop', svc: 'learning' });
    await flush();
    expect(h.spawn.of('ops-api')[0]?.sentOfType('svc.ack')).toHaveLength(0); // 아직 종료 전 — 완료 후 ack
    h.spawn.last('learning').exit(0);
    await flush();
    expect(h.spawn.last('ops-api').sentOfType('svc.ack')[0]).toEqual({
      v: 1,
      re: stopId,
      type: 'svc.ack',
      ok: true,
      error: null,
    });
    expect(await ask(h, { type: 'svc.start', svc: 'learning' })).toMatchObject({ type: 'svc.ack', ok: true });
    expect(h.spawn.of('learning')).toHaveLength(2);
    expect(await ask(h, { type: 'svc.start', svc: 'learning' })).toMatchObject({ ok: true }); // 이미 실행 중 = 멱등
    expect(h.spawn.of('learning')).toHaveLength(2);
    const restartId = ulid();
    h.spawn.last('ops-api').message({ v: 1, id: restartId, type: 'svc.restart', svc: 'content' });
    await flush();
    const old = h.spawn.last('content');
    expect(old.sentOfType('shutdown')).toHaveLength(1);
    old.exit(0);
    await flush();
    expect(h.spawn.of('content')).toHaveLength(2);
    expect(h.spawn.last('ops-api').sent.find((m) => m.re === restartId)).toMatchObject({ type: 'svc.ack', ok: true });
  });

  it('UT-SUP-041 ops-api 외 자식이 보낸 제어 요청은 warn 후 무시 [FR-SET-007][IF-IPC-008]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('content').message({ v: 1, id: ulid(), type: 'svc.stop', svc: 'learning' });
    await flush();
    expect(h.spawn.last('learning').sentOfType('shutdown')).toHaveLength(0);
    expect(h.spawn.last('content').sent.filter((m) => m.type === 'svc.ack')).toHaveLength(0);
    expect(h.events('ipc.message.invalid')).toHaveLength(1);
    expect(h.events('ipc.message.invalid')[0]).toMatchObject({ level: 'warn', child: 'content', type: 'svc.stop' });
  });

  it('UT-SUP-042 파싱 실패(필드 누락·미지 키)는 warn(type만) 후 무시 [FR-SET-007][IF-IPC-008]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('ops-api').message({ v: 1, type: 'svc.stop' });
    h.spawn.last('ops-api').message({ v: 1, type: 'svc.stop', svc: 'content', extra: 1 });
    h.spawn.last('ops-api').message('garbage');
    await flush();
    const warns = h.events('ipc.message.invalid');
    expect(warns).toHaveLength(3);
    expect(warns.map((w) => w.type)).toEqual(['svc.stop', 'svc.stop', null]);
    expect(JSON.stringify(warns)).not.toContain('extra');
  });

  it('UT-SUP-043 prod에서 vite 대상 → ok:false·not_managed, Safe Mode ai-gateway start → safe_mode [FR-SET-007][IF-IPC-008~010]', async () => {
    const h = createHarness({ profile: 'prod' });
    await h.up();
    for (const type of ['svc.start', 'svc.stop', 'svc.restart']) {
      expect(await ask(h, { type, svc: 'vite' })).toMatchObject({ type: 'svc.ack', ok: false, error: 'not_managed' });
    }
    const safe = createHarness({ safeMode: true });
    await safe.up();
    expect(await ask(safe, { type: 'svc.start', svc: 'ai-gateway' })).toMatchObject({ ok: false, error: 'safe_mode' });
    expect(safe.spawn.of('ai-gateway')).toHaveLength(0);
  });

  it('UT-SUP-044 run_mode: argv 매핑 3모드 [FR-SET-007][IF-IPC-011]', () => {
    expect(runModeArgv({ mode: 'migrate', dry_run: true, db_copy_dir: '/tmp/c', app_dir: null })).toEqual([
      '--mode=migrate',
      '--dry-run',
      '--db-copy-dir=/tmp/c',
    ]);
    expect(runModeArgv({ mode: 'migrate', dry_run: false, db_copy_dir: null, app_dir: '/new' })).toEqual([
      '--mode=migrate',
    ]);
    expect(
      runModeArgv({
        mode: 'restore',
        from: '/b/x.fathom',
        rewind_cursors: { gateway: 0, learning: 5, content: 1, 'ai-gateway': 2, 'ops-api': 0 },
      }),
    ).toEqual([
      '--mode=restore',
      '--from=/b/x.fathom',
      '--rewind-cursors={"ai-gateway":2,"content":1,"gateway":0,"learning":5,"ops-api":0}',
    ]);
    expect(runModeArgv({ mode: 'verify', replay: true, db_copy_dir: null })).toEqual(['--mode=verify', '--replay']);
    expect(runModeArgv({ mode: 'verify', replay: false, db_copy_dir: '/c' })).toEqual([
      '--mode=verify',
      '--db-copy-dir=/c',
    ]);
  });

  it('UT-SUP-045 run_mode: 실행 중이면 먼저 정지(선행 shutdown)·끝난 뒤 재기동 0·tail 200줄×2000자·종료 코드 전달 [FR-SET-007][IF-IPC-011]', async () => {
    const h = createHarness();
    await h.up();
    const id = ulid();
    h.spawn.last('ops-api').message({
      v: 1,
      id,
      type: 'svc.run_mode',
      svc: 'content',
      args: { mode: 'migrate', dry_run: true, db_copy_dir: null, app_dir: null },
    });
    await flush();
    const live = h.spawn.last('content');
    expect(live.sentOfType('shutdown')).toHaveLength(1);
    expect(h.spawn.of('content')).toHaveLength(1); // 정지가 끝나기 전에는 run_mode 자식 없음
    live.exit(0);
    await flush();
    const job = h.spawn.last('content');
    expect(job).not.toBe(live);
    expect(job.spec).toMatchObject({ kind: 'fork', args: ['--mode=migrate', '--dry-run'] });
    expect(job.sent).toEqual([]); // 봉투 없음
    for (let i = 0; i < 250; i++) {
      job.line(i % 2 === 0 ? 'stdout' : 'stderr', `line-${i}-${'x'.repeat(2500)}`);
    }
    job.exit(3);
    await flush();
    const result = h.spawn.last('ops-api').sent.find((m) => m.re === id) as {
      type: string;
      exit_code: number;
      tail: string[];
    };
    expect(result).toMatchObject({ type: 'svc.run_mode.result', exit_code: 3 });
    expect(result.tail).toHaveLength(200);
    expect(result.tail[0]?.startsWith('line-50-')).toBe(true);
    expect(result.tail.every((l) => l.length <= 2000)).toBe(true);
    await h.timers.advance(10_000);
    expect(h.spawn.of('content')).toHaveLength(2); // 자동 재기동 0
    expect(h.files.last().services.content?.state).toBe('stopped');
  });

  it('UT-SUP-039 run_mode: 같은 svc에 진행 중이면 busy → 75, 타임아웃 → treeKill·70 [FR-SET-007][IF-IPC-011]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('learning').exit(0); // 이미 정지된 상태에서 시작
    const args = { mode: 'verify', replay: false, db_copy_dir: null };
    h.spawn.last('ops-api').message({ v: 1, id: ulid(), type: 'svc.run_mode', svc: 'ai-gateway', args });
    await flush();
    h.spawn.last('ai-gateway').exit(0);
    await flush();
    const running = h.spawn.last('ai-gateway');
    const busyId = ulid();
    h.spawn.last('ops-api').message({ v: 1, id: busyId, type: 'svc.run_mode', svc: 'ai-gateway', args });
    await flush();
    expect(h.spawn.last('ops-api').sent.find((m) => m.re === busyId)).toMatchObject({
      type: 'svc.run_mode.result',
      exit_code: 75,
      tail: ['supervisor: run_mode busy'],
    });
    await h.timers.advance(600_000);
    expect(running.killed).toBe(1);
    const timeout = h.spawn
      .last('ops-api')
      .sentOfType('svc.run_mode.result')
      .find((m) => m.exit_code === 70) as { tail: string[] };
    expect(timeout.tail.at(-1)).toBe('supervisor: run_mode timeout');
  });

  it('UT-SUP-046 status 행 순서(supervisor → gateway → content → learning → ai-gateway → ops-api)·dev는 vite 추가 [FR-SET-007][IF-IPC-012]', async () => {
    const h = createHarness();
    await h.up();
    const res = (await ask(h, { type: 'status.get' })) as {
      type: string;
      services: { svc: string; state: string; pid: number | null }[];
    };
    expect(res.type).toBe('status');
    expect(res.services.map((s) => s.svc)).toEqual([
      'supervisor',
      'gateway',
      'content',
      'learning',
      'ai-gateway',
      'ops-api',
    ]);
    expect(res.services[0]).toMatchObject({
      svc: 'supervisor',
      state: 'ready',
      pid: process.pid,
      port: null,
      restarts_60s: 0,
    });
    expect(res.services.slice(1).every((s) => s.state === 'ready' && s.pid !== null)).toBe(true);
    const dev = createHarness({
      profile: 'dev',
      watch: () => ({ close: () => undefined }),
      probeTcp: () => Promise.resolve(true),
    });
    await dev.up();
    await flush();
    expect(
      dev.sup
        .statusRows()
        .map((s) => s.svc)
        .at(-1),
    ).toBe('vite');
    h.spawn.last('content').exit(1);
    await flush();
    expect(h.sup.statusRows().find((s) => s.svc === 'content')).toMatchObject({
      state: 'restarting',
      restarts_60s: 1,
      last_exit_code: 1,
    });
  });

  it('UT-SUP-058 run_mode 중에는 같은 서비스의 svc.start·svc.restart·dev 재기동을 거부·건너뜀(run_mode_busy), 끝나면 다시 허용 [FR-SET-007][IF-IPC-011]', async () => {
    let emit: (p: string) => void = () => undefined;
    const h = createHarness({
      profile: 'dev',
      watch: (_roots, onEvent) => {
        emit = onEvent;
        return { close: (): void => undefined };
      },
      probeTcp: () => Promise.resolve(true),
    });
    await h.up();
    await flush();
    const runId = ulid();
    h.spawn.last('ops-api').message({
      v: 1,
      id: runId,
      type: 'svc.run_mode',
      svc: 'content',
      args: {
        mode: 'restore',
        from: '/backup/b1',
        rewind_cursors: { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 },
      },
    });
    await flush();
    const live = h.spawn.last('content');
    expect(live.sentOfType('shutdown')).toHaveLength(1); // 정지 도중에도 이미 보호된다
    expect(await ask(h, { type: 'svc.start', svc: 'content' })).toMatchObject({ ok: false, error: 'run_mode_busy' });
    expect(await ask(h, { type: 'svc.restart', svc: 'content' })).toMatchObject({ ok: false, error: 'run_mode_busy' });
    live.exit(0);
    await flush();
    const job = h.spawn.last('content');
    expect(job.spec.args[0]).toBe('--mode=restore');
    const forks = h.spawn.of('content').length;
    expect(await ask(h, { type: 'svc.start', svc: 'content' })).toMatchObject({ ok: false, error: 'run_mode_busy' });
    emit('/app/services/content/src/a.ts');
    await h.timers.advance(300);
    expect(h.spawn.of('content')).toHaveLength(forks); // 라이브 서비스 fork 0
    expect(await ask(h, { type: 'svc.start', svc: 'learning' })).toMatchObject({ ok: true }); // 다른 서비스는 영향 없음
    job.exit(0);
    await flush();
    expect(h.spawn.last('ops-api').sent.find((m) => m.re === runId)).toMatchObject({ exit_code: 0 });
    expect(await ask(h, { type: 'svc.start', svc: 'content' })).toMatchObject({ ok: true });
    expect(h.spawn.of('content')).toHaveLength(forks + 1);
  });

  it('UT-SUP-069 run_mode app_dir은 절대 경로만(상대 → 64·fork 0)·절대는 설치본 dist 진입, 실행 중 자식의 오류는 warn으로 보고 [FR-SET-007][NFR-SEC-019]', async () => {
    const h = createHarness();
    await h.up();
    const relId = ulid();
    h.spawn.last('ops-api').message({
      v: 1,
      id: relId,
      type: 'svc.run_mode',
      svc: 'content',
      args: { mode: 'migrate', dry_run: true, db_copy_dir: null, app_dir: '../escape' },
    });
    await flush();
    h.spawn.last('content').exit(0);
    await flush();
    expect(h.spawn.of('content')).toHaveLength(1);
    expect(h.spawn.last('ops-api').sent.find((m) => m.re === relId)).toMatchObject({
      type: 'svc.run_mode.result',
      exit_code: 64,
    });
    h.spawn.last('ops-api').message({
      v: 1,
      id: ulid(),
      type: 'svc.run_mode',
      svc: 'content',
      args: { mode: 'migrate', dry_run: true, db_copy_dir: null, app_dir: '/opt/fathom-next' },
    });
    await flush();
    expect(h.spawn.last('content').spec).toMatchObject({
      entry: '/opt/fathom-next/services/content/dist/main.js',
      cwd: '/opt/fathom-next',
    });
    h.spawn.last('learning').error('child', new Error('EPIPE'));
    expect(h.events('supervisor.child.error')).toHaveLength(1);
    expect(h.events('supervisor.child.error')[0]).toMatchObject({ level: 'warn', child: 'learning', what: 'child' });
  });

  it('UT-SUP-057 logs.tail: n 상한·서비스별·supervisor 링 [FR-SET-007][IF-IPC-013]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('content').line('stdout', '{"n":1}');
    h.spawn.last('content').line('stdout', '{"n":2}');
    h.spawn.last('content').line('stdout', '{"n":3}');
    const res = await ask(h, { type: 'logs.tail', svc: 'content', n: 2 });
    expect(res).toMatchObject({ type: 'logs.tail.result', svc: 'content', lines: ['{"n":2}', '{"n":3}'] });
    const sup = await ask(h, { type: 'logs.tail', svc: 'supervisor', n: 5000 });
    expect(sup).toMatchObject({ type: 'logs.tail.result', svc: 'supervisor' });
    h.spawn.last('ops-api').message({ v: 1, id: ulid(), type: 'logs.tail', svc: 'content', n: 5001 });
    await flush();
    expect(h.events('ipc.message.invalid')).toHaveLength(1);
  });

  it('UT-SUP-047 shutdown.all → ack를 먼저 보낸 뒤 종료 시작 [FR-SET-001][IF-IPC-017]', async () => {
    const h = createHarness();
    await h.up();
    const id = ulid();
    const ops = h.spawn.last('ops-api');
    ops.message({ v: 1, id, type: 'shutdown.all', grace_ms: 1234 });
    expect(ops.sent.at(-1)).toEqual({ v: 1, re: id, type: 'svc.ack', ok: true, error: null });
    await flush();
    expect(h.spawn.last('gateway').sentOfType('shutdown')).toEqual([{ type: 'shutdown', v: 1, grace_ms: 1234 }]);
    expect(ops.sentOfType('shutdown')).toHaveLength(0); // ops-api는 마지막
  });
});
