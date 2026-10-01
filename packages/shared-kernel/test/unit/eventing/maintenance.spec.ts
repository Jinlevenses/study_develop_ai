import { AdminEventsView } from '@fathom/contracts/admin/admin-routes';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { OUTBOX_HEAD } from '../../../src/eventing/outbox.sql.js';
import { purgeInfraOnce } from '../../../src/eventing/retention.js';
import { rewindCursors } from '../../../src/eventing/rewind.js';
import { readEventingSnapshot } from '../../../src/eventing/snapshot-read.js';
import { readEventTimeline } from '../../../src/eventing/timeline.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { CORR, openInfraDb } from './support.js';

const DAY = 86_400_000;

function addOutbox(
  db: SqlitePort,
  seqIdx: number,
  occurredAt: number,
  corr = CORR,
  causation: string | null = null,
): void {
  db.prepare(
    'INSERT INTO outbox(event_id, type, schema_version, occurred_at, correlation_id, causation_id, payload) VALUES (:id, :t, 1, :at, :c, :ca, :p)',
  ).run({ id: fixedUlid(seqIdx), t: 'a.b.c', at: occurredAt, c: corr, ca: causation, p: '{"n":1}' });
}
const delivery = (db: SqlitePort, dest: string, mode: string, acked: number): void => {
  db.prepare('INSERT INTO outbox_delivery(dest, mode, last_acked_seq, updated_at) VALUES (:d, :m, :a, 0)').run({
    d: dest,
    m: mode,
    a: acked,
  });
};
const count = (db: SqlitePort, table: 'outbox' | 'inbox_dedupe' | 'inbox_dead' | 'idem_request'): number => {
  const sql = {
    outbox: 'SELECT count(*) AS n FROM outbox',
    inbox_dedupe: 'SELECT count(*) AS n FROM inbox_dedupe',
    inbox_dead: 'SELECT count(*) AS n FROM inbox_dead',
    idem_request: 'SELECT count(*) AS n FROM idem_request',
  }[table];
  return Number(db.prepare(sql).get()?.n);
};

describe('rewindCursors', () => {
  it('UT-SK-158 durable만·뒤로도 이동·반환 행 수·notify 무시·잘못된 값은 던진다 [NFR-DATA-012]', () => {
    // Arrange
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    delivery(db, 'learning', 'durable', 50);
    delivery(db, 'content', 'durable', 70);
    delivery(db, 'gateway', 'notify', 90);
    db.prepare(
      "UPDATE outbox_delivery SET attempts = 4, next_attempt_at = 99, last_error_code = 'X' WHERE dest = 'learning'",
    ).run();
    // Act
    const changed = rewindCursors(db, { learning: 10, gateway: 0, 'ops-api': 3 }, clock);
    // Assert
    expect(changed).toBe(1);
    const row = db
      .prepare(
        "SELECT last_acked_seq, attempts, next_attempt_at, last_error_code, updated_at FROM outbox_delivery WHERE dest = 'learning'",
      )
      .get();
    expect(row).toEqual({
      last_acked_seq: 10,
      attempts: 0,
      next_attempt_at: 0,
      last_error_code: null,
      updated_at: clock.now(),
    });
    expect(db.prepare("SELECT last_acked_seq FROM outbox_delivery WHERE dest = 'content'").get()).toEqual({
      last_acked_seq: 70,
    });
    expect(db.prepare("SELECT last_acked_seq FROM outbox_delivery WHERE dest = 'gateway'").get()).toEqual({
      last_acked_seq: 90,
    });
    expect(() => rewindCursors(db, { learning: -1 }, clock)).toThrow(/non-negative/);
    expect(() => rewindCursors(db, { learning: 1.5 }, clock)).toThrow(/non-negative/);
    // 한 목적지가 잘못되면 아무것도 바뀌지 않는다(검증이 tx 앞이다)
    expect(db.prepare("SELECT last_acked_seq FROM outbox_delivery WHERE dest = 'learning'").get()).toEqual({
      last_acked_seq: 10,
    });
  });
});

describe('purgeInfraOnce', () => {
  it('UT-SK-159 outbox: 모든 durable ack 이하 + 7일 경계 ±1ms, durable 없음 → 7d만 [NFR-DATA-012]', () => {
    // Arrange
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    const now = clock.now();
    addOutbox(db, 1, now - 7 * DAY - 1); // 1: 오래됨, ack됨 → 삭제
    addOutbox(db, 2, now - 7 * DAY); // 2: 경계(< cutoff 아님) → 유지
    addOutbox(db, 3, now - 8 * DAY); // 3: 오래됐지만 ack 안 됨 → 유지
    delivery(db, 'learning', 'durable', 2);
    delivery(db, 'content', 'durable', 5);
    delivery(db, 'gateway', 'notify', 0); // notify는 무시
    // Act
    const r = purgeInfraOnce(db, clock);
    // Assert
    expect(r.deleted.outbox).toBe(1);
    expect(
      db
        .prepare('SELECT seq FROM outbox ORDER BY seq')
        .all()
        .map((x) => x.seq),
    ).toEqual([2, 3]);
    // durable 없음 → 7d만 본다
    const db2 = openInfraDb(clock);
    addOutbox(db2, 1, now - 7 * DAY - 1);
    addOutbox(db2, 2, now - 7 * DAY);
    delivery(db2, 'gateway', 'notify', 0);
    expect(purgeInfraOnce(db2, clock).deleted.outbox).toBe(1);
    expect(count(db2, 'outbox')).toBe(1);
  });

  it('UT-SK-160 inbox_dedupe(30d·워터마크 이하)·inbox_dead(해결 + 90d)·idem_request(7d) 경계 ±1ms [NFR-DATA-012]', () => {
    // Arrange
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    const now = clock.now();
    const dd = (id: number, producer: string, seq: number, at: number): void => {
      db.prepare(
        'INSERT INTO inbox_dedupe(event_id, producer, producer_seq, type, received_at) VALUES (:i, :p, :s, :t, :a)',
      ).run({ i: fixedUlid(id), p: producer, s: seq, t: 'a.b.c', a: at });
    };
    db.prepare("INSERT INTO inbox_watermark(producer, last_producer_seq, updated_at) VALUES ('content', 10, 0)").run();
    dd(1, 'content', 5, now - 30 * DAY - 1); // 삭제
    dd(2, 'content', 5, now - 30 * DAY); // 경계 유지
    dd(3, 'content', 11, now - 40 * DAY); // 워터마크 위 → 유지
    dd(4, 'learning', 1, now - 40 * DAY); // 워터마크 없음(0) → 유지
    const dead = (id: number, resolvedAt: number | null): void => {
      db.prepare(
        "INSERT INTO inbox_dead(event_id, producer, producer_seq, type, envelope, error_code, error_detail, attempts, failed_at, resolved_at, resolution) VALUES (:i, 'content', 1, 'a.b.c', '{}', 'X', 'y', 3, 0, :r, :res)",
      ).run({ i: fixedUlid(id), r: resolvedAt, res: resolvedAt === null ? null : 'discarded' });
    };
    dead(10, now - 90 * DAY - 1); // 삭제
    dead(11, now - 90 * DAY); // 경계 유지
    dead(12, null); // 미해결 유지
    const idem = (k: number, at: number): void => {
      db.prepare(
        "INSERT INTO idem_request(key, caller, route_id, request_hash, status, response_json, created_at) VALUES (:k, 'gateway', 'r', 'h', 200, '{}', :a)",
      ).run({ k: fixedUlid(k), a: at });
    };
    idem(20, now - 7 * DAY - 1); // 삭제
    idem(21, now - 7 * DAY); // 경계 유지
    // Act
    const r = purgeInfraOnce(db, clock);
    // Assert
    expect(r.deleted).toEqual({ outbox: 0, inbox_dedupe: 1, inbox_dead: 1, idem_request: 1 });
    expect(count(db, 'inbox_dedupe')).toBe(3);
    expect(count(db, 'inbox_dead')).toBe(2);
    expect(count(db, 'idem_request')).toBe(1);
    expect(r.more).toBe(false);
  });

  it('UT-SK-161 배치 ≤ 500행·≤ maxBatches — 남은 행은 다음 회차 [NFR-DATA-012]', () => {
    // Arrange
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    db.tx(() => {
      for (let i = 1; i <= 1100; i += 1) {
        db.prepare(
          "INSERT INTO idem_request(key, caller, route_id, request_hash, status, response_json, created_at) VALUES (:k, 'gateway', 'r', 'h', 200, '{}', 1)",
        ).run({ k: `k${i}` });
      }
    });
    // Act / Assert
    expect(purgeInfraOnce(db, clock, { maxBatches: 1 })).toMatchObject({ deleted: { idem_request: 500 }, more: true });
    expect(count(db, 'idem_request')).toBe(600);
    expect(purgeInfraOnce(db, clock, { maxBatches: 2 })).toMatchObject({ deleted: { idem_request: 600 }, more: false });
    expect(count(db, 'idem_request')).toBe(0);
    expect(() => purgeInfraOnce(db, clock, { maxBatches: 0 })).toThrow(/maxBatches/);
  });

  it('UT-SK-147 OUTBOX_HEAD는 정리 뒤에도 정확하다(sqlite_sequence) [NFR-AVL-011]', () => {
    // Arrange
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    expect(db.prepare(OUTBOX_HEAD).get()).toEqual({ head: 0 });
    for (let i = 1; i <= 3; i += 1) {
      addOutbox(db, i, 1);
    }
    // Act: 전부 정리
    purgeInfraOnce(db, clock);
    // Assert
    expect(count(db, 'outbox')).toBe(0);
    expect(db.prepare(OUTBOX_HEAD).get()).toEqual({ head: 3 });
  });
});

describe('readEventTimeline · readEventingSnapshot', () => {
  it('UT-SK-161 readEventTimeline: AdminEventsView 통과·delivered 5키·dead 상관 필터·inbox [] [IF-COM-009]', () => {
    // Arrange
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    const other = fixedUlid(777);
    addOutbox(db, 1, 100, CORR, fixedUlid(55));
    addOutbox(db, 2, 200, other);
    addOutbox(db, 3, 300, CORR);
    delivery(db, 'learning', 'durable', 1);
    delivery(db, 'gateway', 'notify', 3);
    const dead = (id: number, corr: string, failedAt: number): void => {
      const env = JSON.stringify({ correlation_id: corr });
      db.prepare(
        "INSERT INTO inbox_dead(event_id, producer, producer_seq, type, envelope, error_code, error_detail, attempts, failed_at) VALUES (:i, 'content', 1, 'a.b.c', :e, 'X', 'y', 3, :f)",
      ).run({ i: fixedUlid(id), e: env, f: failedAt });
    };
    dead(30, CORR, 20);
    dead(31, other, 10);
    dead(32, CORR, 10);
    // Act
    const view = readEventTimeline(db, 'content', CORR);
    // Assert
    expect(AdminEventsView.safeParse(view).success).toBe(true);
    expect(view.svc).toBe('content');
    expect(view.outbox.map((o) => o.seq)).toEqual([1, 3]);
    expect(view.outbox[0]).toMatchObject({
      causation_id: fixedUlid(55),
      delivered: { learning: true, gateway: true, content: false, 'ai-gateway': false, 'ops-api': false },
    });
    expect(view.outbox[1]?.delivered).toEqual({
      learning: false,
      gateway: true,
      content: false,
      'ai-gateway': false,
      'ops-api': false,
    });
    expect(Object.keys(view.outbox[0]?.delivered ?? {}).sort()).toEqual([
      'ai-gateway',
      'content',
      'gateway',
      'learning',
      'ops-api',
    ]);
    expect(view.dead.map((d) => d.event_id)).toEqual([fixedUlid(32), fixedUlid(30)]);
    expect(view.inbox).toEqual([]);
  });

  it('UT-SK-161 readEventingSnapshot: durable 커서·워터마크, 나머지 5키 0 채움 [IF-COM-009]', () => {
    // Arrange
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    expect(readEventingSnapshot(db)).toEqual({
      outbox_head_seq: 0,
      delivery: { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 },
      inbox_watermark: { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 },
    });
    addOutbox(db, 1, 1);
    addOutbox(db, 2, 1);
    delivery(db, 'learning', 'durable', 2);
    delivery(db, 'gateway', 'notify', 2);
    db.prepare("INSERT INTO inbox_watermark(producer, last_producer_seq, updated_at) VALUES ('content', 9, 0)").run();
    // Act
    const snap = readEventingSnapshot(db);
    // Assert
    expect(snap).toEqual({
      outbox_head_seq: 2,
      delivery: { gateway: 0, content: 0, learning: 2, 'ai-gateway': 0, 'ops-api': 0 },
      inbox_watermark: { gateway: 0, content: 9, learning: 0, 'ai-gateway': 0, 'ops-api': 0 },
    });
  });
});
