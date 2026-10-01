import type { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import type { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import type { InboxDelivery } from '@fathom/contracts/events/inbox';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../../src/errors/errors.js';
import type { InboxConfig } from '../../../src/eventing/inbox.js';
import { defineInboxHandler, inboxErrorCode, inboxPlugin } from '../../../src/eventing/inbox.js';
import { createMetrics } from '../../../src/metrics/metrics.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { captureLogger, openInfraDb } from './support.js';

const V1 = { 1: z.object({ n: z.number().int() }).strict() } as const;

type Sub = ConsumerManifest['subscriptions'][number];
function sub(type: string, over: Partial<Sub> = {}): Sub {
  return { type, schema_versions: [1], mode: 'durable', on_poison: 'dead_letter', reads: ['n'], ...over };
}

function ev(seq: number, over: Partial<IntegrationEventEnvelope> = {}): IntegrationEventEnvelope {
  return {
    event_id: fixedUlid(seq),
    type: 'a.b.c',
    schema_version: 1,
    producer: 'content',
    producer_seq: seq,
    occurred_at: 1_790_000_000_000,
    correlation_id: fixedUlid(900),
    causation_id: null,
    traceparent: null,
    payload: { n: seq },
    ...over,
  };
}
const delivery = (...events: IntegrationEventEnvelope[]): InboxDelivery => ({ producer: 'content', events });

function rig(
  subscriptions: Sub[],
  handlerImpl?: (e: IntegrationEventEnvelope, p: { n: number }, db: SqlitePort) => void,
  extra: Partial<{ handlers: InboxConfig }> = {},
) {
  const clock = createFakeClock();
  const db = openInfraDb(clock);
  db.exec('CREATE TABLE handled(event_id TEXT PRIMARY KEY, n INTEGER NOT NULL) STRICT');
  const metrics = createMetrics();
  const cap = captureLogger(clock);
  const handled: number[] = [];
  const handler = defineInboxHandler('a.b.c', V1, (e, p, d) => {
    handled.push(p.n);
    if (handlerImpl !== undefined) {
      return handlerImpl(e, p, d);
    }
    d.prepare('INSERT INTO handled(event_id, n) VALUES (:id, :n)').run({ id: e.event_id, n: p.n });
  });
  const cfg: InboxConfig = extra.handlers ?? {
    mode: 'durable',
    manifest: { consumer: 'learning', subscriptions },
    handlers: [handler],
  };
  const inbox = inboxPlugin(cfg, { db, clock, log: cap.log, metrics });
  const count = (table: string): number => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n); // sql-ok: 테스트 고정 표 이름
  return { clock, db, metrics, cap, inbox, handled, count };
}

describe('inbox — 정지·격리', () => {
  it('UT-SK-014 halt 구독 실패 → halt(직전 성공 seq)·inbox_dead 0행·inbox_halted = 1, dead_letter: attempt 1·2 → ack·격리 0, attempt 3 → inbox_dead 1행 + dedupe + 계속·inbox_dead_total +1 [NFR-AVL-005]', async () => {
    // Arrange (halt)
    const failOn2 = (e: IntegrationEventEnvelope, p: { n: number }, db: SqlitePort): void => {
      if (p.n === 2) {
        throw new Error('poison');
      }
      db.prepare('INSERT INTO handled(event_id, n) VALUES (:id, :n)').run({ id: e.event_id, n: p.n });
    };
    const halt = rig([sub('a.b.c', { on_poison: 'halt' })], failOn2);
    // Act
    const h = await halt.inbox.process('content', delivery(ev(1), ev(2), ev(3)), 1);
    // Assert
    expect(h).toEqual({ kind: 'halt', acked_through_seq: 1, producer: 'content' });
    expect(halt.count('inbox_dead')).toBe(0);
    expect(halt.count('handled')).toBe(1);
    expect(halt.metrics.render()).toContain('inbox_halted{producer="content"} 1');
    expect(halt.cap.lines().some((l) => l.event === 'inbox.path.halted' && l.level === 'error')).toBe(true);
    // 첫 이벤트부터 실패하면 직전 성공 seq = 첫 seq − 1
    const first = rig([sub('a.b.c', { on_poison: 'halt' })], () => {
      throw new Error('poison');
    });
    expect(await first.inbox.process('content', delivery(ev(5), ev(6)), 1)).toEqual({
      kind: 'halt',
      acked_through_seq: 4,
      producer: 'content',
    });

    // Arrange (dead_letter)
    const dl = rig([sub('a.b.c', { on_poison: 'dead_letter' })], failOn2);
    // attempt 1·2 → ack(직전 성공 seq), 격리 0
    for (const attempt of [1, 2]) {
      expect(await dl.inbox.process('content', delivery(ev(1), ev(2), ev(3)), attempt)).toEqual({
        kind: 'ack',
        acked_through_seq: 1,
      });
      expect(dl.count('inbox_dead')).toBe(0);
    }
    // attempt 3 → 격리 + dedupe + 다음 이벤트 계속
    const third = await dl.inbox.process('content', delivery(ev(1), ev(2), ev(3)), 3);
    expect(third).toEqual({ kind: 'ack', acked_through_seq: 3 });
    expect(dl.count('inbox_dead')).toBe(1);
    expect(dl.db.prepare('SELECT event_id, error_code, attempts, resolved_at FROM inbox_dead').get()).toMatchObject({
      event_id: fixedUlid(2),
      error_code: 'HANDLER-EXCEPTION',
      attempts: 3,
      resolved_at: null,
    });
    expect(dl.count('inbox_dedupe')).toBe(3);
    expect(dl.count('handled')).toBe(2);
    expect(dl.db.prepare("SELECT last_producer_seq FROM inbox_watermark WHERE producer = 'content'").get()).toEqual({
      last_producer_seq: 3,
    });
    expect(dl.metrics.render()).toContain('inbox_dead_total 1');
  });
});

describe('inbox — 처리 규칙', () => {
  it('UT-SK-152 같은 event 2회 → 핸들러 1회·watermark = max·이벤트별 tx(2번째 실패가 1번째를 되돌리지 않음) [NFR-DATA-013][IF-COM-004]', async () => {
    // Arrange
    const r = rig([sub('a.b.c')], (e, p, db) => {
      if (p.n === 2) {
        throw new Error('second fails');
      }
      db.prepare('INSERT INTO handled(event_id, n) VALUES (:id, :n)').run({ id: e.event_id, n: p.n });
    });
    // Act
    const out = await r.inbox.process('content', delivery(ev(1), ev(2)), 1);
    // Assert: 1번째 반영은 남는다
    expect(out).toEqual({ kind: 'ack', acked_through_seq: 1 });
    expect(r.count('handled')).toBe(1);
    // 같은 event 재전달 → 핸들러 호출 안 함
    r.handled.length = 0;
    await r.inbox.process('content', delivery(ev(1)), 1);
    expect(r.handled).toEqual([]);
    expect(r.count('inbox_dedupe')).toBe(1);
    // watermark = max(역순으로 작은 seq가 와도 줄지 않는다)
    const ok = rig([sub('a.b.c')]);
    await ok.inbox.process('content', delivery(ev(5)), 1);
    await ok.inbox.process('content', delivery(ev(3)), 1);
    expect(ok.db.prepare("SELECT last_producer_seq FROM inbox_watermark WHERE producer = 'content'").get()).toEqual({
      last_producer_seq: 5,
    });
  });

  it('UT-SK-153 미구독 type·범위 밖 version → 건너뜀 + 기록 + ack(warn 로그) [NFR-DATA-013][IF-COM-004]', async () => {
    // Arrange
    const r = rig([sub('a.b.c', { schema_versions: [1] })]);
    // Act
    const out = await r.inbox.process(
      'content',
      delivery(ev(1, { type: 'x.y.z' }), ev(2, { schema_version: 7 }), ev(3)),
      1,
    );
    // Assert
    expect(out).toEqual({ kind: 'ack', acked_through_seq: 3 });
    expect(r.handled).toEqual([3]);
    expect(r.count('inbox_dedupe')).toBe(3);
    const skipped = r.cap.lines().filter((l) => l.event === 'inbox.event.skipped');
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toMatchObject({ level: 'warn', type: 'x.y.z' });
  });

  it('UT-SK-154 payload 위반 → VAL-SCHEMA, thenable 반환 → HANDLER-ASYNC(tx 롤백) [NFR-DATA-013][NFR-AVL-005]', async () => {
    // Arrange
    const bad = rig([sub('a.b.c', { on_poison: 'dead_letter' })]);
    // Act: payload 위반을 3번째 시도에서 격리
    const out = await bad.inbox.process('content', delivery(ev(1, { payload: { n: 'x' } })), 3);
    // Assert
    expect(out.kind).toBe('ack');
    expect(bad.db.prepare('SELECT error_code, error_detail FROM inbox_dead').get()).toMatchObject({
      error_code: 'VAL-SCHEMA',
    });
    // thenable
    const asyncRig = rig([sub('a.b.c')], (e, _p, db) => {
      db.prepare('INSERT INTO handled(event_id, n) VALUES (:id, 1)').run({ id: e.event_id });
      return Promise.resolve() as unknown as undefined;
    });
    expect(await asyncRig.inbox.process('content', delivery(ev(1)), 3)).toEqual({ kind: 'ack', acked_through_seq: 1 });
    expect(asyncRig.db.prepare('SELECT error_code FROM inbox_dead').get()).toEqual({ error_code: 'HANDLER-ASYNC' });
    expect(asyncRig.count('handled')).toBe(0); // 롤백
    // 분류기
    expect(inboxErrorCode(new AppError('LR-VAL-900', 400))).toBe('HANDLER-LR-VAL-900');
    expect(inboxErrorCode(new Error('x'))).toBe('HANDLER-EXCEPTION');
    expect(inboxErrorCode('str')).toBe('HANDLER-EXCEPTION');
  });

  it('UT-SK-155 핸들러 없음 → HANDLER-MISSING 독 이벤트(halt면 정지·dead_letter면 격리 — 유실 0) [NFR-AVL-005]', async () => {
    // Arrange: 구독은 있으나 핸들러가 없다
    const clock = createFakeClock();
    const mk = (on_poison: 'halt' | 'dead_letter') => {
      const db = openInfraDb(clock);
      const cap = captureLogger(clock);
      const inbox = inboxPlugin(
        {
          mode: 'durable',
          manifest: { consumer: 'learning', subscriptions: [sub('a.b.c', { on_poison })] },
          handlers: [],
        },
        { db, clock, log: cap.log, metrics: createMetrics() },
      );
      return { db, cap, inbox };
    };
    const halt = mk('halt');
    expect(halt.cap.lines().some((l) => l.event === 'inbox.handler.missing' && l.level === 'error')).toBe(true);
    expect(await halt.inbox.process('content', delivery(ev(1)), 1)).toEqual({
      kind: 'halt',
      acked_through_seq: 0,
      producer: 'content',
    });
    const dl = mk('dead_letter');
    expect(await dl.inbox.process('content', delivery(ev(1)), 3)).toEqual({ kind: 'ack', acked_through_seq: 1 });
    expect(dl.db.prepare('SELECT error_code FROM inbox_dead').get()).toEqual({ error_code: 'HANDLER-MISSING' });
  });

  it('UT-SK-156 producer 불일치·seq 비증가 → reject [IF-COM-004]', async () => {
    // Arrange
    const r = rig([sub('a.b.c')]);
    // Act / Assert
    expect(await r.inbox.process('learning', delivery(ev(1)), 1)).toEqual({
      kind: 'reject',
      reason: 'producer_mismatch',
    });
    expect(await r.inbox.process('content', delivery(ev(2), ev(2)), 1)).toEqual({
      kind: 'reject',
      reason: 'producer_seq_order',
    });
    expect(await r.inbox.process('content', delivery(ev(3), ev(2)), 1)).toEqual({
      kind: 'reject',
      reason: 'producer_seq_order',
    });
    expect(r.handled).toEqual([]);
  });

  it('UT-SK-157 notify 모드: 콜백 1회(구독 타입만)·예외에도 ack·tx 없음 [NFR-AVL-005][IF-COM-004]', async () => {
    // Arrange
    const clock = createFakeClock();
    const notify = vi.fn((events: readonly IntegrationEventEnvelope[]): void => {
      if (events.length > 0) {
        throw new Error('sse ring broke');
      }
    });
    const cap = captureLogger(clock);
    const inbox = inboxPlugin(
      {
        mode: 'notify',
        manifest: { consumer: 'gateway', subscriptions: [sub('a.b.c', { mode: 'notify', on_poison: 'drop' })] },
        notify,
      },
      { db: null, clock, log: cap.log, metrics: createMetrics() },
    );
    // Act
    const out = await inbox.process('content', delivery(ev(1, { type: 'x.y.z' }), ev(2), ev(3, { type: 'x.y.z' })), 1);
    // Assert
    expect(out).toEqual({ kind: 'ack', acked_through_seq: 3 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0].map((e) => e.producer_seq)).toEqual([2]);
    expect(cap.lines().some((l) => l.event === 'inbox.notify.failed' && l.level === 'error')).toBe(true);
    // 구독 타입이 없으면 콜백 0
    notify.mockClear();
    await inbox.process('content', delivery(ev(4, { type: 'x.y.z' })), 1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('생성 시 검사: durable인데 db null·모드 불일치 구독·중복 핸들러 → invariant [IF-COM-004]', () => {
    // Arrange
    const clock = createFakeClock();
    const deps = { db: null, clock, log: captureLogger(clock).log, metrics: createMetrics() };
    const handler = defineInboxHandler('a.b.c', V1, () => undefined);
    // Act / Assert
    expect(() =>
      inboxPlugin({ mode: 'durable', manifest: { consumer: 'learning', subscriptions: [] }, handlers: [] }, deps),
    ).toThrow(/requires a database/);
    const db = openInfraDb(clock);
    expect(() =>
      inboxPlugin(
        {
          mode: 'durable',
          manifest: { consumer: 'learning', subscriptions: [sub('a.b.c', { mode: 'notify' })] },
          handlers: [],
        },
        { ...deps, db },
      ),
    ).toThrow(/notify subscription|has a notify/);
    expect(() =>
      inboxPlugin(
        { mode: 'notify', manifest: { consumer: 'gateway', subscriptions: [sub('a.b.c')] }, notify: () => undefined },
        deps,
      ),
    ).toThrow(/has a durable/);
    expect(() =>
      inboxPlugin(
        {
          mode: 'durable',
          manifest: { consumer: 'learning', subscriptions: [sub('a.b.c')] },
          handlers: [handler, handler],
        },
        { ...deps, db },
      ),
    ).toThrow(/duplicate inbox handler/);
  });

  it('UT-SK-162 error_detail은 스택·토큰 0·≤ 500자 한 줄이고, 성공 후 inbox_halted = 0 [NFR-DATA-012][IF-COM-009]', async () => {
    // Arrange
    const token = `Bearer ${'a'.repeat(64)}`;
    let explode = true;
    const r = rig([sub('a.b.c', { on_poison: 'halt' }), sub('a.b.d', { on_poison: 'dead_letter' })], (e, _p, db) => {
      if (explode) {
        throw new Error(`${token} ${'x'.repeat(900)}\n    at secret (/home/u/file.ts:1:1)`);
      }
      db.prepare('INSERT INTO handled(event_id, n) VALUES (:id, 1)').run({ id: e.event_id });
    });
    // Act: 격리용 별도 rig
    const dead = rig([sub('a.b.c', { on_poison: 'dead_letter' })], () => {
      throw new Error(`${token} ${'x'.repeat(900)}\n    at secret (/home/u/file.ts:1:1)`);
    });
    await dead.inbox.process('content', delivery(ev(1)), 3);
    const row = dead.db.prepare('SELECT error_detail FROM inbox_dead').get();
    const detail = String(row?.error_detail);
    // Assert
    expect(detail.length).toBeLessThanOrEqual(500);
    expect(detail).not.toContain('\n');
    expect(detail).not.toContain('    at ');
    expect(detail).not.toContain('a'.repeat(64));
    expect(detail).toContain('[REDACTED]');
    // halt 후 성공 → 0
    expect((await r.inbox.process('content', delivery(ev(1)), 1)).kind).toBe('halt');
    expect(r.metrics.render()).toContain('inbox_halted{producer="content"} 1');
    explode = false;
    expect((await r.inbox.process('content', delivery(ev(1)), 2)).kind).toBe('ack');
    expect(r.metrics.render()).toContain('inbox_halted{producer="content"} 0');
  });
});
