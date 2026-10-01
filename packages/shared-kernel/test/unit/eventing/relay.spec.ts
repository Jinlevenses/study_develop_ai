import type { ServiceName } from '@fathom/contracts/common/ids';
import { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import type { InboxDelivery } from '@fathom/contracts/events/inbox';
import { createFakeClock } from '@fathom/testkit/clock';
import { createUlidSequence } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../../src/errors/errors.js';
import { appendEvent, createOutbox } from '../../../src/eventing/outbox.js';
import type { Relay, RelayRouting } from '../../../src/eventing/relay.js';
import { backoffDelayMs, startRelay } from '../../../src/eventing/relay.js';
import type { DeliveryFailure, InboxTransport } from '../../../src/eventing/transport.js';
import { createMetrics } from '../../../src/metrics/metrics.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { CORR, captureLogger, openInfraDb, PAYLOADS } from './support.js';

type Call = { dest: ServiceName; body: InboxDelivery; attempt: number };
type Reply = { acked: number | 'last' } | { fail: DeliveryFailure };

function fakeTransport(replies: () => Reply = () => ({ acked: 'last' })): { transport: InboxTransport; calls: Call[] } {
  const calls: Call[] = [];
  const transport: InboxTransport = {
    deliver(dest, body, attempt) {
      calls.push({ dest, body, attempt });
      const r = replies();
      if ('fail' in r) {
        return Promise.resolve(err(r.fail));
      }
      const last = body.events[body.events.length - 1]?.producer_seq ?? 0;
      return Promise.resolve(ok({ acked_through_seq: r.acked === 'last' ? last : r.acked }));
    },
  };
  return { transport, calls };
}

const DURABLE: RelayRouting = { learning: { mode: 'durable', types: ['a.b.c'] } };
const relays: Relay[] = [];

function rig(routing: RelayRouting = DURABLE, replies?: () => Reply, opts: { pollMs?: number } = {}) {
  const clock = createFakeClock();
  const db = openInfraDb(clock);
  const metrics = createMetrics();
  const cap = captureLogger(clock);
  const { transport, calls } = fakeTransport(replies);
  const kicks: string[] = [];
  const relay = startRelay({ db, svc: 'content', routing, transport, clock, log: cap.log, metrics, ...opts });
  relays.push(relay);
  const outbox = createOutbox({
    db,
    svc: 'content',
    clock,
    payloads: PAYLOADS,
    currentTraceparent: () => null,
    onAppended: () => relay.kick(),
    newId: createUlidSequence(1000),
  });
  const add = (type: string, n = 0): number =>
    db.tx(() => appendEvent(outbox, { type, schema_version: 1, correlation_id: CORR, payload: { n } })).seq;
  return { clock, db, metrics, cap, relay, outbox, add, calls, kicks };
}

const cursor = (db: SqlitePort, dest = 'learning'): Record<string, unknown> | undefined =>
  db
    .prepare(
      'SELECT last_acked_seq, attempts, next_attempt_at, last_error_code FROM outbox_delivery WHERE dest = :dest',
    )
    .get({ dest });

afterEach(async () => {
  for (const r of relays.splice(0)) {
    await r.stop();
  }
  vi.useRealTimers();
});

describe('relay — 커서·백오프', () => {
  it('UT-SK-013 미구독 구간 포함 전진·배치 0행 head 전진·백오프 500…30000 상한·재시작 후 이어쓰기 [NFR-AVL-011]', async () => {
    // Arrange: 구독 타입(a.b.c)과 미구독(x.y.z)이 섞인 outbox
    const { db, add, relay, clock, calls } = rig();
    add('x.y.z'); // 1
    add('a.b.c'); // 2
    add('x.y.z'); // 3
    const s4 = add('a.b.c'); // 4
    // Act
    await relay.drainOnce();
    // Assert: 보낸 것은 구독 타입 2건, 커서는 건너뛴 구간을 포함해 4까지
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.events.map((e) => e.producer_seq)).toEqual([2, 4]);
    expect(cursor(db)?.last_acked_seq).toBe(s4);
    // 배치 0행: 구독하지 않는 타입만 남음 → head까지 전진
    add('x.y.z'); // 5
    const s6 = add('x.y.z'); // 6
    await relay.drainOnce();
    expect(calls).toHaveLength(1);
    expect(cursor(db)?.last_acked_seq).toBe(s6);
    // 연속 실패 → next_attempt_at − now = 500·1000·2000·… 상한 30000
    await relay.stop();
    let fail = true;
    const failing = fakeTransport(() =>
      fail ? { fail: { code: 'DEP-CONNECT', acked_through_seq: null } } : { acked: 'last' },
    );
    const metrics = createMetrics();
    const log = captureLogger(clock).log;
    const r2 = startRelay({ db, svc: 'content', routing: DURABLE, transport: failing.transport, clock, log, metrics });
    relays.push(r2);
    const outbox = createOutbox({
      db,
      svc: 'content',
      clock,
      payloads: PAYLOADS,
      currentTraceparent: () => null,
      onAppended: () => undefined,
      newId: createUlidSequence(2000),
    });
    db.tx(() => appendEvent(outbox, { type: 'a.b.c', schema_version: 1, correlation_id: CORR, payload: { n: 7 } }));
    const delays: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      await r2.drainOnce();
      const row = cursor(db);
      delays.push(Number(row?.next_attempt_at) - clock.now());
      expect(row?.attempts).toBe(i + 1);
      expect(row?.last_error_code).toBe('DEP-CONNECT');
      clock.advance(delays[i] ?? 0);
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    // 백오프 시간 안에는 전송하지 않는다
    const callsBefore = failing.calls.length;
    await r2.drainOnce(); // 9번째 실패 직후 clock.advance(30000) 했으므로 허용 → 10번째 시도
    expect(failing.calls.length).toBe(callsBefore + 1);
    expect(Number(cursor(db)?.attempts)).toBe(10);
    await r2.drainOnce(); // 아직 next_attempt_at 전
    expect(failing.calls.length).toBe(callsBefore + 1);
    // 재시작: 새 relay가 attempts·next_attempt_at을 이어 쓴다
    await r2.stop();
    fail = false;
    const after = Number(cursor(db)?.next_attempt_at);
    const r3 = startRelay({
      db,
      svc: 'content',
      routing: DURABLE,
      transport: failing.transport,
      clock,
      log,
      metrics: createMetrics(),
    });
    relays.push(r3);
    await r3.drainOnce();
    expect(failing.calls.length).toBe(callsBefore + 1); // 백오프 중
    expect(cursor(db)?.attempts).toBe(10);
    clock.set(after);
    await r3.drainOnce();
    expect(failing.calls.at(-1)?.attempt).toBe(11); // attempts + 1
    expect(cursor(db)).toMatchObject({ attempts: 0, next_attempt_at: 0, last_error_code: null });
  });

  it('backoffDelayMs는 0.5s에서 시작해 두 배씩 30s에서 멈춘다 [NFR-AVL-011]', () => {
    expect([1, 2, 3, 7, 8, 100].map(backoffDelayMs)).toEqual([500, 1000, 2000, 30_000, 30_000, 30_000]);
  });
});

describe('relay — 전송·envelope', () => {
  it('UT-SK-142 envelope = IntegrationEventEnvelope·producer_seq = seq·배치 ≤ 100·seq 오름차순·목적지별 in-flight 1 [NFR-DATA-013][IF-COM-004]', async () => {
    // Arrange
    const { add, relay, calls, db } = rig(DURABLE, undefined, { pollMs: 60_000 });
    for (let i = 0; i < 120; i += 1) {
      add('a.b.c', i);
    }
    // Act
    await Promise.all([relay.drainOnce(), relay.drainOnce()]); // 동시 2회 → 전송 1회
    // Assert
    expect(calls).toHaveLength(1);
    const events = calls[0]?.body.events ?? [];
    expect(events).toHaveLength(100);
    expect(events.map((e) => e.producer_seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    for (const e of events) {
      expect(IntegrationEventEnvelope.safeParse(e).success).toBe(true);
      expect(e.producer).toBe('content');
    }
    expect(calls[0]?.attempt).toBe(1);
    expect(cursor(db)?.last_acked_seq).toBe(100);
    // 남은 20건은 다음 회차
    await relay.drainOnce();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body.events).toHaveLength(20);
  });

  it('UT-SK-143 한 tx 안 append 3건 → kick 예약 1회, 500ms 안전망이 동작한다 [NFR-DATA-013][IF-COM-004]', async () => {
    // Arrange
    vi.useFakeTimers();
    const { db, calls, relay } = rig();
    const spy = vi.spyOn(globalThis, 'setImmediate');
    const before = spy.mock.calls.length;
    // Act: 같은 tx에서 3건
    const clock = createFakeClock();
    const outbox = createOutbox({
      db,
      svc: 'content',
      clock,
      payloads: PAYLOADS,
      currentTraceparent: () => null,
      onAppended: () => relay.kick(),
      newId: createUlidSequence(5000),
    });
    db.tx(() => {
      for (let i = 0; i < 3; i += 1) {
        appendEvent(outbox, { type: 'a.b.c', schema_version: 1, correlation_id: CORR, payload: { n: i } });
      }
    });
    // Assert: setImmediate 예약은 1번뿐
    expect(spy.mock.calls.length - before).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.events).toHaveLength(3);
    // 안전망: kick 없이 쌓인 행은 500ms 폴링이 전달한다
    db.tx(() =>
      db
        .prepare(
          "INSERT INTO outbox(event_id, type, schema_version, occurred_at, correlation_id, payload) VALUES ('01J0000000000000000000ZZZZ', 'a.b.c', 1, 1, :c, '{\"n\":9}')",
        )
        .run({ c: CORR }),
    );
    await vi.advanceTimersByTimeAsync(498); // 누적 499ms
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toHaveLength(2);
  });
});

describe('relay — notify·부분 ack·halt', () => {
  it('UT-SK-144 notify: 60s 지난 행은 전송 0·커서 전진, 신선한 행만 전송 [NFR-AVL-011]', async () => {
    // Arrange
    const { db, add, relay, clock, calls } = rig({ gateway: { mode: 'notify', types: ['a.b.c'] } });
    add('a.b.c'); // seq 1 (오래됨)
    clock.advance(61_000);
    // Act 1: 전부 오래됨
    await relay.drainOnce();
    // Assert
    expect(calls).toHaveLength(0);
    expect(cursor(db, 'gateway')?.last_acked_seq).toBe(1);
    // Act 2: 오래된 것 + 신선한 것
    const outbox = createOutbox({
      db,
      svc: 'content',
      clock,
      payloads: PAYLOADS,
      currentTraceparent: () => null,
      onAppended: () => undefined,
      newId: createUlidSequence(7000),
    });
    db.tx(() => appendEvent(outbox, { type: 'a.b.c', schema_version: 1, correlation_id: CORR, payload: { n: 2 } }));
    await relay.drainOnce();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.dest).toBe('gateway');
    expect(cursor(db, 'gateway')?.last_acked_seq).toBe(2);
  });

  it('UT-SK-145 부분 ack: 진전 있으면 attempts = 1, 없으면 +1, 다음 전송의 attempt = attempts + 1 [NFR-AVL-011]', async () => {
    // Arrange: 3건 중 앞 1건만 ack하는 소비자
    let acked = 1;
    const { db, add, relay, clock, calls } = rig(DURABLE, () => ({ acked }));
    add('a.b.c');
    add('a.b.c');
    add('a.b.c');
    // Act / Assert
    await relay.drainOnce(); // 진전(0→1)
    expect(cursor(db)).toMatchObject({ last_acked_seq: 1, attempts: 1, last_error_code: 'INBOX-PARTIAL' });
    expect(calls[0]?.attempt).toBe(1);
    clock.advance(500);
    await relay.drainOnce(); // 같은 값 1 → 진전 없음
    expect(calls[1]?.attempt).toBe(2);
    expect(cursor(db)).toMatchObject({ last_acked_seq: 1, attempts: 2 });
    clock.advance(1000);
    acked = 2;
    await relay.drainOnce(); // 진전(1→2) → attempts 다시 1
    expect(calls[2]?.attempt).toBe(3);
    expect(cursor(db)).toMatchObject({ last_acked_seq: 2, attempts: 1 });
    clock.advance(500);
    acked = 3;
    await relay.drainOnce();
    expect(calls[3]?.attempt).toBe(2);
    expect(cursor(db)).toMatchObject({ last_acked_seq: 3, attempts: 0, next_attempt_at: 0, last_error_code: null });
  });

  it('UT-SK-146 INBOX-HALT → 커서 = acked_through_seq(더 작은 값이 와도 역행 0)·백오프·실패 메트릭·로그 [NFR-AVL-011]', async () => {
    // Arrange
    let reply: Reply = { fail: { code: 'INBOX-HALT', acked_through_seq: 2 } };
    const { db, add, relay, clock, metrics, cap } = rig(DURABLE, () => reply);
    for (let i = 0; i < 4; i += 1) {
      add('a.b.c');
    }
    // Act / Assert
    await relay.drainOnce();
    expect(cursor(db)).toMatchObject({ last_acked_seq: 2, attempts: 1, last_error_code: 'INBOX-HALT' });
    expect(Number(cursor(db)?.next_attempt_at) - clock.now()).toBe(500);
    clock.advance(500);
    reply = { fail: { code: 'INBOX-HALT', acked_through_seq: 1 } }; // 더 작은 값
    await relay.drainOnce();
    expect(cursor(db)).toMatchObject({ last_acked_seq: 2, attempts: 2 });
    expect(Number(cursor(db)?.next_attempt_at) - clock.now()).toBe(1000);
    // seq 없는 HALT = 일반 실패
    clock.advance(1000);
    reply = { fail: { code: 'INBOX-HALT', acked_through_seq: null } };
    await relay.drainOnce();
    expect(cursor(db)).toMatchObject({ last_acked_seq: 2, attempts: 3 });
    expect(metrics.render()).toContain('relay_delivery_failures_total{dest="learning"} 3');
    const failed = cap.lines().filter((l) => l.event === 'relay.delivery.failed');
    expect(failed).toHaveLength(3);
    expect(failed[0]).toMatchObject({ level: 'warn', dest: 'learning', code: 'INBOX-HALT', attempts: 1 });
  });

  it('UT-SK-148 ENSURE_DELIVERY가 mode를 갱신하고 피어 URL 없음 → DEP-NOPEER [NFR-AVL-011]', async () => {
    // Arrange: 같은 DB에 durable → notify로 바뀐 routing으로 relay 재시작
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    const mk = (mode: 'durable' | 'notify'): Relay => {
      const r = startRelay({
        db,
        svc: 'content',
        routing: { learning: { mode, types: ['a.b.c'] } },
        transport: fakeTransport(() => ({ fail: { code: 'DEP-NOPEER', acked_through_seq: null } })).transport,
        clock,
        log: captureLogger(clock).log,
        metrics: createMetrics(),
      });
      relays.push(r);
      return r;
    };
    mk('durable');
    expect(db.prepare("SELECT mode FROM outbox_delivery WHERE dest = 'learning'").get()).toEqual({ mode: 'durable' });
    db.prepare("UPDATE outbox_delivery SET last_acked_seq = 5 WHERE dest = 'learning'").run();
    const second = mk('notify');
    expect(db.prepare("SELECT mode, last_acked_seq FROM outbox_delivery WHERE dest = 'learning'").get()).toEqual({
      mode: 'notify',
      last_acked_seq: 5,
    });
    await second.stop();
    // 피어 없음 실패 코드는 그대로 기록된다
    const { db: db2, add, relay } = rig(DURABLE, () => ({ fail: { code: 'DEP-NOPEER', acked_through_seq: null } }));
    add('a.b.c');
    await relay.drainOnce();
    expect(cursor(db2)).toMatchObject({ attempts: 1, last_error_code: 'DEP-NOPEER' });
  });
});

describe('relay — pause·resume·stop·gauge', () => {
  it('UT-SK-150 pause 중 drainOnce 전송 0·resume이 즉시 처리·stop 후 타이머 0 [NFR-AVL-011]', async () => {
    // Arrange
    vi.useFakeTimers();
    const { add, relay, calls } = rig();
    relay.pause();
    add('a.b.c');
    // Act / Assert
    await relay.drainOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(0);
    relay.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    await relay.stop();
    expect(vi.getTimerCount()).toBe(0);
    add('a.b.c');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
  });

  it('UT-SK-151 collectGauges → outbox_pending{dest}·outbox_oldest_age_ms{dest} [NFR-AVL-011]', () => {
    // Arrange
    const { add, relay, clock, metrics, db } = rig({
      learning: { mode: 'durable', types: ['a.b.c'] },
      gateway: { mode: 'notify', types: ['x.y.z'] },
    });
    clock.advance(1000);
    add('a.b.c');
    clock.advance(250);
    add('a.b.c');
    add('x.y.z');
    clock.advance(100);
    db.prepare("UPDATE outbox_delivery SET last_acked_seq = 3 WHERE dest = 'gateway'").run();
    // Act
    relay.collectGauges();
    // Assert
    const text = metrics.render();
    expect(text).toContain('outbox_pending{dest="learning"} 2');
    expect(text).toContain('outbox_pending{dest="gateway"} 0');
    expect(text).toContain('outbox_oldest_age_ms{dest="learning"} 350');
    expect(text).toContain('outbox_oldest_age_ms{dest="gateway"} 0');
  });
});
