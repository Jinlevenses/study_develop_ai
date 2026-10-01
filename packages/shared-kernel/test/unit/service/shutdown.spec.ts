import { ShutdownAck } from '@fathom/contracts/admin/admin-routes';
import { Problem } from '@fathom/contracts/common/problem';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceState } from '../../../src/service/service-state.js';
import { createShutdown } from '../../../src/service/shutdown.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { captureLogger } from '../eventing/support.js';
import type { Probes } from './routes.js';
import { fixtureDef } from './routes.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, OPS, rigOf } from './support.js';

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

function fakeDb(name: string, calls: string[]): SqlitePort {
  return {
    path: name,
    readOnly: false,
    prepare: () => {
      throw new Error('unused');
    },
    exec: (sql: string) => void calls.push(`${name}:exec:${sql}`),
    tx: () => {
      throw new Error('unused');
    },
    fn: () => undefined,
    close: () => void calls.push(`${name}:close`),
  };
}

describe('종료 절차', () => {
  it('UT-SK-185 순서: 새 요청 503 → 진행 중 완료 대기 → relay drain 1회·stop → 타이머 → onShutdown 역순 → jobs → OPTIMIZE 후 close → app close → exit 0, 2회 호출 = 같은 Promise [IF-COM-008][NFR-AVL-003]', async () => {
    // Arrange
    const calls: string[] = [];
    const state = createServiceState({ ready: true });
    state.enterRequest(); // 진행 중 요청 1건
    const shutdown = createShutdown({
      state,
      relay: () => ({
        drainOnce: () => {
          calls.push('relay.drainOnce');
          return Promise.resolve();
        },
        stop: () => {
          calls.push('relay.stop');
          return Promise.resolve();
        },
      }),
      stopTimers: () => void calls.push('timers.stop'),
      hooks: [
        () => void calls.push('hook1'),
        () => Promise.reject(new Error('hook2 failed')),
        () => void calls.push('hook3'),
      ],
      jobs: {
        run: () => Promise.reject(new Error('unused')),
        cancel: () => undefined,
        isBusy: () => false,
        shutdown: () => Promise.resolve(void calls.push('jobs.shutdown')),
      },
      writeDbs: [fakeDb('a.db', calls), fakeDb('b.db', calls)],
      closeApp: () => Promise.resolve(void calls.push('app.close')),
      exit: (code) => void calls.push(`exit:${code}`),
      log: captureLogger().log,
    });
    // Act
    const first = shutdown(1000);
    const second = shutdown(1000);
    expect(second).toBe(first);
    expect(state.shuttingDown).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(calls).toEqual([]); // 진행 중 요청이 끝나기 전에는 진행하지 않는다
    state.leaveRequest();
    await first;
    // Assert
    expect(calls).toEqual([
      'relay.drainOnce',
      'relay.stop',
      'timers.stop',
      'hook3',
      'hook1',
      'jobs.shutdown',
      'a.db:exec:PRAGMA optimize',
      'a.db:close',
      'b.db:exec:PRAGMA optimize',
      'b.db:close',
      'app.close',
      'exit:0',
    ]);
    expect(shutdown(0)).toBe(first);
  });

  it('UT-SK-185 grace 초과는 warn 후 다음 단계로 — 종료 코드는 0 [NFR-AVL-003]', async () => {
    // Arrange
    const calls: string[] = [];
    const state = createServiceState({ ready: true });
    state.enterRequest(); // 끝나지 않는 요청
    const cap = captureLogger();
    const shutdown = createShutdown({
      state,
      relay: () => ({ drainOnce: () => new Promise<void>(() => undefined), stop: () => Promise.resolve() }),
      stopTimers: () => undefined,
      hooks: [],
      jobs: {
        run: () => Promise.reject(new Error('unused')),
        cancel: () => undefined,
        isBusy: () => false,
        shutdown: () => Promise.resolve(),
      },
      writeDbs: [],
      closeApp: () => Promise.resolve(),
      exit: (code) => void calls.push(`exit:${code}`),
      log: cap.log,
    });
    // Act
    await shutdown(60);
    // Assert
    expect(calls).toEqual(['exit:0']);
    const events = cap.lines().map((l) => l.event);
    expect(events).toContain('shutdown.requests.timeout');
    expect(events).toContain('shutdown.relay.drain_timeout');
  });

  it('UT-SK-185 종료 중에는 새 요청이 503 DEP-900(+retry-after)이고 health는 응답하며, 진행 중 요청은 끝까지 처리된다 [IF-COM-008][NFR-AVL-003]', async () => {
    // Arrange
    const probes: Probes = { puts: 0, slowRelease: null, slowStarted: null };
    const rig = await rigOf(fixtureDef(defOf('content'), probes));
    rigs.push(rig);
    const slow = rig.app.fastify.inject({
      method: 'POST',
      url: '/internal/v1/test/put',
      headers: { 'content-type': 'application/json', ...GATEWAY, 'idempotency-key': fixedUlid(1) },
      payload: '{"v":1,"mode":"slow"}',
    });
    await expect.poll(() => probes.slowRelease !== null).toBe(true);
    const exits: number[] = [];
    const shutdown = createShutdown({
      state: rig.internals.state,
      relay: null,
      stopTimers: () => undefined,
      hooks: rig.internals.shutdownHooks,
      jobs: rig.internals.jobs,
      writeDbs: [],
      closeApp: () => Promise.resolve(),
      exit: (code) => void exits.push(code),
      log: rig.cap.log,
    });
    // Act
    const done = shutdown(2000);
    const rejected = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/items/x', headers: GATEWAY });
    const health = await rig.app.fastify.inject({ method: 'GET', url: '/healthz' });
    expect(exits).toEqual([]);
    probes.slowRelease?.();
    // Assert
    expect(rejected.statusCode).toBe(503);
    expect(Problem.parse(JSON.parse(rejected.body)).code).toBe('CT-DEP-900');
    expect(rejected.headers['retry-after']).toBe('1');
    expect(health.statusCode).toBe(200);
    expect((await slow).statusCode).toBe(201);
    await done;
    expect(exits).toEqual([0]);
  });

  it('UT-SK-185 admin shutdown 라우트는 202 ShutdownAck를 돌려준 뒤 종료 절차를 시작한다(ops-api는 이 라우트가 없다) [IF-COM-008]', async () => {
    // Arrange
    const requested: number[] = [];
    const rig = await rigOf(defOf('content'), {}, { requestShutdown: (g) => void requested.push(g) });
    rigs.push(rig);
    // Act
    const res = await rig.app.fastify.inject({
      method: 'POST',
      url: '/internal/v1/admin/shutdown',
      headers: { 'content-type': 'application/json', ...OPS, 'idempotency-key': fixedUlid(2) },
      payload: '{"grace_ms":1234}',
    });
    // Assert
    expect(res.statusCode).toBe(202);
    expect(ShutdownAck.parse(JSON.parse(res.body))).toEqual({ accepted_at: rig.clock.now(), grace_ms: 1234 });
    await expect.poll(() => requested).toEqual([1234]);
    const ops = await rigOf(defOf('ops-api'));
    rigs.push(ops);
    expect(ops.app.registeredRoutes().some((r) => r.url.endsWith('/admin/shutdown'))).toBe(false);
    expect(vi.isFakeTimers()).toBe(false);
  });
});
