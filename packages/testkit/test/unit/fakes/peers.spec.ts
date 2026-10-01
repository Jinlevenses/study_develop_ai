import { COMMON_ADMIN_ROUTES } from '@fathom/contracts/admin/admin-routes';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { describe, expect, it } from 'vitest';
import { createFakeClock } from '../../../src/clock.js';
import type { FakeHandler } from '../../../src/fakes/peers/peers.js';
import { createFakePeer } from '../../../src/fakes/peers/peers.js';
import { fixedUlid } from '../../../src/ids.js';

const [healthRoute, , metricsRoute, , , , shutdownRoute] = COMMON_ADMIN_ROUTES;
if (healthRoute === undefined || metricsRoute === undefined || shutdownRoute === undefined) {
  throw new Error('fixture routes missing');
}

const health: FakeHandler = () =>
  ok({
    status: 200,
    body: { ok: true, svc: 'learning', version: '1.0.0', boot_id: fixedUlid(1), uptime_ms: 5 },
    replayed: false,
  });

describe('fake peer', () => {
  it('UT-TK-040 호출을 기록하고 데드라인 헤더를 deadlineAt − now − 10으로 차감한다 [NFR-MAINT-011]', async () => {
    // 호출을 기록하고 데드라인 헤더를 deadlineAt − now − 10으로 차감한다 [NFR-MAINT-011]
    {
      // Arrange
      const clock = createFakeClock(1_000_000);
      const peer = createFakePeer({ peer: 'learning', clock, handlers: { [healthRoute.id]: health } });
      // Act
      const result = await peer.call(healthRoute, {}, { deadlineAt: 1_000_300, requestId: fixedUlid(9) });
      clock.advance(100);
      await peer.call(healthRoute, { query: { a: 1 } }, { deadlineAt: 1_000_300 });
      await peer.call(healthRoute, {});
      // Assert
      expect(result).toMatchObject({ ok: true, value: { status: 200, replayed: false } });
      expect(peer.calls).toEqual([
        {
          route_id: healthRoute.id,
          input: {},
          idempotency_key: null,
          deadline_header_ms: 290,
          request_id: fixedUlid(9),
        },
        {
          route_id: healthRoute.id,
          input: { query: { a: 1 } },
          idempotency_key: null,
          deadline_header_ms: 190,
          request_id: null,
        },
        { route_id: healthRoute.id, input: {}, idempotency_key: null, deadline_header_ms: null, request_id: null },
      ]);
    }
    // 남은 데드라인이 0 이하이면 핸들러를 부르지 않고 deadline_exhausted를 돌려준다 [NFR-MAINT-011]
    {
      // Arrange
      let handlerCalls = 0;
      const clock = createFakeClock(5000);
      const peer = createFakePeer({
        peer: 'content',
        clock,
        handlers: {
          [healthRoute.id]: (input) => {
            handlerCalls += 1;
            return health(input);
          },
        },
      });
      // Act
      const exhausted = await peer.call(healthRoute, {}, { deadlineAt: 5010 }); // 5010 − 5000 − 10 = 0
      const past = await peer.call(healthRoute, {}, { deadlineAt: 4000 });
      // Assert
      expect(exhausted).toEqual({ ok: false, error: { kind: 'deadline_exhausted', dependency: 'content' } });
      expect(past.ok).toBe(false);
      expect(handlerCalls).toBe(0);
      expect(peer.calls).toHaveLength(2);
      expect(peer.calls[0]?.deadline_header_ms).toBe(0);
    }
  });

  it('UT-TK-041 멱등 라우트는 키가 없으면, 핸들러가 없는 route id는 던진다 [NFR-MAINT-011]', async () => {
    // Arrange
    const peer = createFakePeer({
      peer: 'ops-api',
      clock: createFakeClock(),
      handlers: {
        [shutdownRoute.id]: () => ok({ status: 202, body: { accepted_at: 1, grace_ms: 3000 }, replayed: true }),
      },
    });
    // Act / Assert
    await expect(peer.call(shutdownRoute, { body: { grace_ms: 10 } })).rejects.toThrow(/^invariant:/);
    await expect(peer.call(metricsRoute, {})).rejects.toThrow('invariant: no fake handler for common.metrics.get');
    const okResult = await peer.call(shutdownRoute, { body: { grace_ms: 10 } }, { idempotencyKey: fixedUlid(3) });
    expect(okResult).toMatchObject({ ok: true, value: { status: 202, replayed: true } });
    expect(peer.calls.at(-1)?.idempotency_key).toBe(fixedUlid(3));
  });

  it('UT-TK-042 응답이 계약을 위반하면 contract_violation이고 실패는 그대로 전달한다 [NFR-MAINT-011]', async () => {
    // Arrange
    const peer = createFakePeer({
      peer: 'learning',
      clock: createFakeClock(),
      handlers: {
        [healthRoute.id]: () => ok({ status: 200, body: { ok: false }, replayed: false }),
        [metricsRoute.id]: () => ok({ status: 418, body: 'x', replayed: false }),
        [shutdownRoute.id]: () => err({ kind: 'timeout', dependency: 'learning' }),
      },
    });
    // Act
    const badBody = await peer.call(healthRoute, {});
    const undeclared = await peer.call(metricsRoute, {});
    const failure = await peer.call(shutdownRoute, {}, { idempotencyKey: fixedUlid(1) });
    // Assert
    expect(badBody).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation', dependency: 'learning', status: 200 },
    });
    expect(undeclared).toMatchObject({ ok: false, error: { kind: 'contract_violation', status: 418 } });
    expect(failure).toEqual({ ok: false, error: { kind: 'timeout', dependency: 'learning' } });
  });
});
