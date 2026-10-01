import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BootstrapEnvelope,
  IpcOpsToSupervisor,
  IpcServiceToSupervisor,
  IpcSupervisorToOps,
  IpcSupervisorToService,
} from '@fathom/contracts/admin/ipc';
import { IpcJob } from '@fathom/contracts/admin/jobs';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { JobChannel } from '@fathom/shared-kernel/jobs/jobs';
import { defineJob, serveJob } from '@fathom/shared-kernel/jobs/jobs';
import { createFakeClock } from '@fathom/testkit/clock';
import { afterEach, describe, expect, it } from 'vitest';
import type { ControlApi } from '../../../src/supervisor/control-ipc.js';
import { handleOpsRequest } from '../../../src/supervisor/control-ipc.js';
import { createLogSink } from '../../../src/supervisor/log-sink.js';
import type { Harness } from '../../unit/supervisor/fakes.js';
import { createHarness, flush } from '../../unit/supervisor/fakes.js';

const SERVICES = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const;
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** ops 요청 1건을 보내고 `re`가 같은 응답을 돌려받는다. */
async function ask(
  h: Harness,
  body: Record<string, unknown>,
  withId = true,
): Promise<Record<string, unknown> | undefined> {
  const id = ulid();
  const ops = h.spawn.last('ops-api');
  const before = ops.sent.length;
  expect(IpcOpsToSupervisor.safeParse({ v: 1, ...(withId ? { id } : {}), ...body }).success).toBe(true);
  ops.message({ v: 1, ...(withId ? { id } : {}), ...body });
  await flush();
  const fresh = ops.sent.slice(before);
  return withId ? fresh.find((m) => m.re === id) : fresh[0];
}
/** 응답을 기다리지 않고 요청만 보낸다(작업 완료 후 ack를 검증하는 테스트용). */
function post(h: Harness, body: Record<string, unknown>): string {
  const id = ulid();
  h.spawn.last('ops-api').message({ v: 1, id, ...body });
  return id;
}
function reply(h: Harness, id: string): Record<string, unknown> | undefined {
  return h.spawn.last('ops-api').sent.find((m) => m.re === id);
}
function strictOps(m: Record<string, unknown> | undefined): void {
  expect(m).toBeDefined();
  expect(IpcSupervisorToOps.safeParse(m).success).toBe(true);
}

describe('supervisor → 서비스 메시지 (IF-IPC-001~004)', () => {
  it('CT-SUP-701 bootstrap: 자식마다 첫 메시지 정확히 1회·listen.host = 127.0.0.1·strict 통과 [IF-IPC-001]', async () => {
    const h = createHarness({ profile: 'prod' });
    await h.up();
    h.sup.setLogLevel('warn');
    for (const svc of SERVICES) {
      const child = h.spawn.last(svc);
      expect(child.sent[0]?.type).toBe('bootstrap');
      expect(child.sentOfType('bootstrap')).toHaveLength(1);
      const env = BootstrapEnvelope.safeParse(child.sent[0]);
      expect(env.success).toBe(true);
      expect(env.data?.listen.host).toBe('127.0.0.1');
      expect(BootstrapEnvelope.safeParse({ ...(child.sent[0] as object), extra: 1 }).success).toBe(false);
    }
  });

  it('CT-SUP-702 registry.updated: 실제로 보낸 메시지가 IpcSupervisorToService strict 통과 [IF-IPC-002]', async () => {
    const h = createHarness();
    await h.up();
    const updates = h.spawn.children.flatMap((c) => c.sentOfType('registry.updated'));
    expect(updates.length).toBeGreaterThan(0);
    for (const m of updates) {
      expect(IpcSupervisorToService.safeParse(m).success).toBe(true);
      expect(Object.keys((m as { peers: object }).peers).sort()).toEqual([...SERVICES].sort());
    }
  });

  it('CT-SUP-703 shutdown: grace_ms 정수 0~10000으로 송신 [IF-IPC-003]', async () => {
    const h = createHarness();
    await h.up();
    await ask(h, { type: 'svc.stop', svc: 'content' });
    const sent = h.spawn.last('content').sentOfType('shutdown');
    expect(sent).toHaveLength(1);
    expect(IpcSupervisorToService.safeParse(sent[0]).success).toBe(true);
    expect(IpcSupervisorToService.safeParse({ type: 'shutdown', v: 1, grace_ms: 10_001 }).success).toBe(false);
  });

  it('CT-SUP-704 log.level: setLogLevel이 연결된 서비스 전원에 strict 통과 메시지를 보낸다 [IF-IPC-004]', async () => {
    const h = createHarness();
    await h.up();
    h.sup.setLogLevel('debug');
    for (const svc of SERVICES) {
      const sent = h.spawn.last(svc).sentOfType('log.level');
      expect(sent).toEqual([{ type: 'log.level', v: 1, level: 'debug' }]);
      expect(IpcSupervisorToService.safeParse(sent[0]).success).toBe(true);
    }
    expect(h.deps.log.level).toBe('debug');
  });
});

describe('서비스 → supervisor 메시지 (IF-IPC-005~007)', () => {
  it('CT-SUP-705 listening: 유효 샘플 수용, port 0·미지 키 → 무시 + warn·상태 불변 [IF-IPC-005]', async () => {
    const h = createHarness();
    await h.start();
    const content = h.spawn.last('content');
    expect(IpcServiceToSupervisor.safeParse({ type: 'listening', v: 1, port: 4762 }).success).toBe(true);
    content.message({ type: 'listening', v: 1, port: 0 });
    content.message({ type: 'listening', v: 1, port: 4762, extra: true });
    await flush();
    expect(h.files.last().services.content?.port).toBeNull();
    expect(h.events('ipc.message.invalid')).toHaveLength(2);
    content.message({ type: 'listening', v: 1, port: 4762 });
    expect(h.files.last().services.content?.port).toBe(4762);
  });

  it('CT-SUP-706 ready: 유효 샘플 수용, contracts_hash 누락 → 무시 + warn·상태 불변 [IF-IPC-006]', async () => {
    const h = createHarness();
    await h.start();
    const content = h.spawn.last('content');
    content.message({ type: 'ready', v: 1, schema_versions: {}, app_version: '1.2.3' });
    await flush();
    expect(h.files.last().services.content?.state).toBe('starting');
    expect(h.events('ipc.message.invalid')).toHaveLength(1);
    content.ready();
    expect(h.files.last().services.content?.state).toBe('ready');
  });

  it('CT-SUP-707 fatal: exit_code ∈ {64,70,75,78}만 수용, exit_code 1 → 무시 + warn [IF-IPC-007]', async () => {
    const h = createHarness();
    await h.up();
    const content = h.spawn.last('content');
    content.message({ type: 'fatal', v: 1, exit_code: 1, code: 'x' });
    content.exit(78);
    await flush();
    expect(h.files.last().services.content?.reason).toBe('exit_78:unknown'); // 위반 fatal은 코드로 쓰이지 않는다
    expect(h.events('ipc.message.invalid')).toHaveLength(1);
    const again = createHarness();
    await again.up();
    again.spawn.last('content').message({ type: 'fatal', v: 1, exit_code: 78, code: 'schema_needs_migrate' });
    again.spawn.last('content').exit(78);
    await flush();
    expect(again.files.last().services.content?.reason).toBe('exit_78:schema_needs_migrate');
  });
});

describe('ops-api ↔ supervisor (IF-IPC-008~017)', () => {
  it('CT-SUP-708 svc.stop → svc.ack strict·re 일치 [IF-IPC-008]', async () => {
    const h = createHarness();
    await h.up();
    const id = post(h, { type: 'svc.stop', svc: 'ai-gateway' });
    await flush();
    expect(reply(h, id)).toBeUndefined(); // 완료 후 ack
    h.spawn.last('ai-gateway').exit(0);
    await flush();
    const res = reply(h, id);
    strictOps(res);
    expect(res).toMatchObject({ type: 'svc.ack', ok: true, error: null, v: 1 });
  });

  it('CT-SUP-709 svc.start → svc.ack strict [IF-IPC-009]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('ai-gateway').exit(78);
    await flush();
    const res = await ask(h, { type: 'svc.start', svc: 'ai-gateway' });
    strictOps(res);
    expect(res).toMatchObject({ ok: true });
  });

  it('CT-SUP-710 svc.restart → svc.ack strict [IF-IPC-010]', async () => {
    const h = createHarness();
    await h.up();
    const id = post(h, { type: 'svc.restart', svc: 'learning' });
    await flush();
    h.spawn.last('learning').exit(0);
    await flush();
    strictOps(reply(h, id));
  });

  it('CT-SUP-711 svc.run_mode → svc.run_mode.result strict(exit_code·tail) [IF-IPC-011]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('learning').exit(0);
    await flush();
    const id = post(h, {
      type: 'svc.run_mode',
      svc: 'learning',
      args: {
        mode: 'restore',
        from: '/b/x',
        rewind_cursors: { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 },
      },
    });
    await flush();
    const job = h.spawn.last('learning');
    expect(job.spec.args[0]).toBe('--mode=restore');
    job.line('stdout', 'restored');
    job.exit(0);
    await flush();
    const res = reply(h, id);
    strictOps(res);
    expect(res).toMatchObject({ type: 'svc.run_mode.result', exit_code: 0, tail: ['restored'] });
  });

  it('CT-SUP-712 status.get → status strict(행 7필드) [IF-IPC-012]', async () => {
    const h = createHarness();
    await h.up();
    const res = await ask(h, { type: 'status.get' });
    strictOps(res);
    expect(Object.keys((res as { services: object[] }).services[1] ?? {}).sort()).toEqual([
      'last_exit_code',
      'pid',
      'port',
      'restarts_60s',
      'started_at',
      'state',
      'svc',
    ]);
  });

  it('CT-SUP-713 logs.tail → logs.tail.result strict [IF-IPC-013]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('gateway').line('stdout', '{"a":1}');
    const res = await ask(h, { type: 'logs.tail', svc: 'gateway', n: 10 });
    strictOps(res);
    expect(res).toMatchObject({ svc: 'gateway', lines: ['{"a":1}'] });
  });

  it('CT-SUP-714 shutdown.all → svc.ack strict(ack 먼저) [IF-IPC-017]', async () => {
    const h = createHarness();
    await h.up();
    const res = await ask(h, { type: 'shutdown.all', grace_ms: 3000 });
    strictOps(res);
    expect(res).toMatchObject({ type: 'svc.ack', ok: true });
  });

  it('CT-SUP-715 요청에 id가 없으면 응답에 re를 쓰지 않는다 [IF-IPC-012]', async () => {
    const h = createHarness();
    await h.up();
    const res = await ask(h, { type: 'status.get' }, false);
    strictOps(res);
    expect(res).not.toHaveProperty('re');
  });

  it('CT-SUP-716 run_mode tail 한도: 200줄 × 2,000자 이하 [IF-IPC-011]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('content').exit(0);
    await flush();
    const id = post(h, {
      type: 'svc.run_mode',
      svc: 'content',
      args: { mode: 'verify', replay: true, db_copy_dir: null },
    });
    await flush();
    for (let i = 0; i < 400; i++) {
      h.spawn.last('content').line('stderr', 'y'.repeat(5000));
    }
    h.spawn.last('content').exit(0);
    await flush();
    const res = reply(h, id) as { tail: string[] };
    strictOps(res);
    expect(res.tail).toHaveLength(200);
    expect(res.tail.every((l) => l.length === 2000)).toBe(true);
  });

  it('CT-SUP-717 logs.tail 한도: lines ≤ 5,000 × 8,000자(래핑·이스케이프 뒤에도) · 처리 실패도 응답한다 [IF-IPC-013]', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'fathom-ct-'));
    dirs.push(home);
    const sink = createLogSink({ home, clock: createFakeClock(), foreground: false });
    const h = createHarness({ sink });
    await h.up();
    // 반환 창(마지막 5,000줄 = i ≥ 200) 안에 과대 줄·따옴표/역슬래시 폭탄·8,000자에서 잘려 깨진 JSON을 둔다.
    const wide: Record<number, string> = {
      300: 'q'.repeat(20_000),
      301: '"'.repeat(5000),
      302: '\\'.repeat(5000),
      303: `{"a":"${'x'.repeat(9000)}"}`,
      304: '한'.repeat(9000),
    };
    for (let i = 0; i < 5200; i++) {
      h.spawn.last('content').line('stderr', wide[i] ?? `{"i":${i}}`);
    }
    const res = (await ask(h, { type: 'logs.tail', svc: 'content', n: 5000 })) as { lines: string[] };
    strictOps(res);
    expect(res.lines).toHaveLength(5000);
    expect(res.lines.every((l) => l.length <= 8000)).toBe(true);
    const wrapped = res.lines.slice(100, 105).map((l) => JSON.parse(l) as { raw: string; level: string });
    expect(wrapped.every((w) => w.level === 'fatal' && w.raw.length > 1000)).toBe(true);
    expect(wrapped[0]?.raw.startsWith('q')).toBe(true);
    await sink.close();

    // 응답 구성이 실패해도 요청은 침묵으로 버려지지 않는다 — svc.ack{ok:false,error:'internal'}.
    const sent: unknown[] = [];
    const errors: unknown[] = [];
    const api = {
      tail: () => ['x'.repeat(8001)],
      onDetachedError: (e: unknown): void => void errors.push(e),
    } as unknown as ControlApi;
    const id = ulid();
    await handleOpsRequest({ v: 1, id, type: 'logs.tail', svc: 'content', n: 5 }, api, (m) => void sent.push(m));
    expect(errors).toHaveLength(1);
    expect(sent).toEqual([{ v: 1, re: id, type: 'svc.ack', ok: false, error: 'internal' }]);
    expect(IpcSupervisorToOps.safeParse(sent[0]).success).toBe(true);
  });
});

type Sent = unknown[];
function fakeChannel(): { channel: JobChannel; sent: Sent; deliver(m: unknown): void; disconnect(): void } {
  const sent: Sent = [];
  const handlers: ((m: unknown) => void)[] = [];
  const disconnects: (() => void)[] = [];
  return {
    sent,
    channel: {
      send: (m) => void sent.push(m),
      onMessage: (cb) => void handlers.push(cb),
      onDisconnect: (cb) => void disconnects.push(cb),
    },
    deliver: (m) => {
      for (const cb of handlers) {
        cb(m);
      }
    },
    disconnect: () => {
      for (const cb of disconnects) {
        cb();
      }
    },
  };
}

describe('job IPC (shared-kernel serveJob ↔ IpcJob, IF-IPC-018~022)', () => {
  const start = (job: string): Record<string, unknown> => ({
    type: 'job.start',
    v: 1,
    id: ulid(),
    job,
    args: { n: 1 },
  });

  it('CT-SUP-718 job.start(부모가 보내는 샘플)가 IpcJob 통과 [IF-IPC-018]', () => {
    expect(IpcJob.safeParse(start('snapshot')).success).toBe(true);
    expect(IpcJob.safeParse({ ...start('snapshot'), job: 'nope' }).success).toBe(false);
  });

  it('CT-SUP-719 job.progress: 자식이 낸 메시지가 IpcJob 통과·re = job.start id [IF-IPC-019]', async () => {
    const fx = fakeChannel();
    const job = defineJob('snapshot', (_args, ctx) => {
      ctx.progress(50, 'half');
      return Promise.resolve({ done: true });
    });
    const exit = serveJob([job], fx.channel);
    const msg = start('snapshot');
    fx.deliver(msg);
    expect(await exit).toBe(0);
    const progress = fx.sent.find((m) => (m as { type: string }).type === 'job.progress');
    expect(IpcJob.safeParse(progress).success).toBe(true);
    expect(progress).toMatchObject({ re: msg.id, pct: 50, step: 'half' });
  });

  it('CT-SUP-720 job.result: IpcJob 통과 [IF-IPC-020]', async () => {
    const fx = fakeChannel();
    const exit = serveJob([defineJob('integrity', () => Promise.resolve({ ok: 1 }))], fx.channel);
    fx.deliver(start('integrity'));
    expect(await exit).toBe(0);
    const result = fx.sent.find((m) => (m as { type: string }).type === 'job.result');
    expect(IpcJob.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ result: { ok: 1 } });
  });

  it('CT-SUP-721 job.error: 핸들러 실패가 IpcJob 통과·종료 70 [IF-IPC-021]', async () => {
    const fx = fakeChannel();
    const exit = serveJob([defineJob('merge', () => Promise.reject(new Error('boom')))], fx.channel);
    fx.deliver(start('merge'));
    expect(await exit).toBe(70);
    const error = fx.sent.find((m) => (m as { type: string }).type === 'job.error');
    expect(IpcJob.safeParse(error).success).toBe(true);
    expect(error).toMatchObject({ code: 'handler_failed' });
  });

  it('CT-SUP-722 job.cancel(부모 샘플 IpcJob 통과) → job.error{code:cancelled} [IF-IPC-022]', async () => {
    const fx = fakeChannel();
    const job = defineJob(
      'rebuild',
      (_args, ctx) =>
        new Promise<Record<string, unknown>>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const exit = serveJob([job], fx.channel);
    fx.deliver(start('rebuild'));
    const cancel = { type: 'job.cancel', v: 1 };
    expect(IpcJob.safeParse(cancel).success).toBe(true);
    fx.deliver(cancel);
    expect(await exit).toBe(0);
    const error = fx.sent.find((m) => (m as { type: string }).type === 'job.error');
    expect(IpcJob.safeParse(error).success).toBe(true);
    expect(error).toMatchObject({ code: 'cancelled' });
  });
});
