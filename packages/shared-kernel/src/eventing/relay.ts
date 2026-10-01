import { ServiceName } from '@fathom/contracts/common/ids';
import { InboxDelivery } from '@fathom/contracts/events/inbox';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import {
  DELIVERY_GET,
  ENSURE_DELIVERY,
  OUTBOX_PENDING,
  RELAY_ACK,
  RELAY_BATCH,
  RELAY_FAIL,
  RELAY_PARTIAL,
  RELAY_SKIP_TO_HEAD,
} from './relay.sql.js';
import { rowInt, rowIntOrNull, rowStr, rowStrOrNull } from './row.js';
import type { DeliveryFailure, InboxTransport } from './transport.js';

// ARC-01 §8.3 relay 규칙 · DB-01 §4.2 — 목적지별 FIFO push. 목적지별 in-flight 1·배치 ≤ 100·seq 오름차순.
// STD-TS-27 허용 상태 객체: 시작 인자로 만든 클로저 하나가 상태(일시정지·in-flight·타이머)를 쥔다.

export type RelayRouting = Readonly<
  Partial<Record<ServiceName, { readonly mode: 'durable' | 'notify'; readonly types: readonly string[] }>>
>;
export type { DeliveryFailure, InboxTransport };

export type RelayOptions = {
  readonly db: SqlitePort;
  readonly svc: ServiceName;
  readonly routing: RelayRouting;
  readonly transport: InboxTransport;
  readonly clock: Clock;
  readonly log: Logger;
  readonly metrics: MetricsRegistry;
  readonly pollMs?: number;
};
export interface Relay {
  kick(): void;
  drainOnce(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  /** outbox_pending·outbox_oldest_age_ms 갱신 — 메트릭 스크레이프 직전에 호출한다. */
  collectGauges(): void;
}

const DEFAULT_POLL_MS = 500;
const BATCH_MAX = 100;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
const NOTIFY_STALE_MS = 60_000;

type Dest = { readonly dest: ServiceName; readonly mode: 'durable' | 'notify'; readonly typesJson: string };
type DeliveryRow = { readonly lastAcked: number; readonly attempts: number; readonly nextAttemptAt: number };
type BatchRow = {
  readonly seq: number;
  readonly eventId: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly occurredAt: number;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly traceparent: string | null;
  readonly payload: string;
};

/** 지수 백오프(지터 없음 — 결정적): 0.5s → 1s → 2s … 상한 30s. `attemptsAfter` ≥ 1. */
export function backoffDelayMs(attemptsAfter: number): number {
  const exponent = Math.min(Math.max(attemptsAfter - 1, 0), 20);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

function toBatchRow(row: Record<string, unknown>): BatchRow {
  return {
    seq: rowInt(row, 'seq'),
    eventId: rowStr(row, 'event_id'),
    type: rowStr(row, 'type'),
    schemaVersion: rowInt(row, 'schema_version'),
    occurredAt: rowInt(row, 'occurred_at'),
    correlationId: rowStr(row, 'correlation_id'),
    causationId: rowStrOrNull(row, 'causation_id'),
    traceparent: rowStrOrNull(row, 'traceparent'),
    payload: rowStr(row, 'payload'),
  };
}

export function startRelay(opts: RelayOptions): Relay {
  const { db, svc, clock, log, metrics, transport } = opts;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const dests: Dest[] = [];
  for (const [name, spec] of Object.entries(opts.routing)) {
    if (spec === undefined) {
      continue;
    }
    // Object.entries 키는 string — contracts 검사로 ServiceName에 좁힌다(모르는 키는 결함).
    dests.push({ dest: ServiceName.parse(name), mode: spec.mode, typesJson: JSON.stringify(spec.types) });
  }
  const failures = metrics.counter('relay_delivery_failures_total', 'relay 전달 실패 횟수', ['dest']);
  const pendingGauge = metrics.gauge('outbox_pending', '목적지별 미전달 outbox 행 수', ['dest']);
  const oldestGauge = metrics.gauge('outbox_oldest_age_ms', '목적지별 가장 오래된 미전달 행의 나이(ms)', ['dest']);

  db.tx(() => {
    for (const d of dests) {
      db.prepare(ENSURE_DELIVERY).run({ dest: d.dest, mode: d.mode, now: clock.now() });
    }
  });

  let paused = false;
  let stopped = false;
  let kickScheduled = false;
  const inFlight = new Set<ServiceName>();
  const running = new Set<Promise<void>>();

  function track(p: Promise<void>): Promise<void> {
    running.add(p);
    void p.finally(() => {
      running.delete(p);
    });
    return p;
  }

  function readDelivery(dest: ServiceName): DeliveryRow | null {
    const row = db.prepare(DELIVERY_GET).get({ dest });
    if (row === undefined) {
      return null;
    }
    return {
      lastAcked: rowInt(row, 'last_acked_seq'),
      attempts: rowInt(row, 'attempts'),
      nextAttemptAt: rowInt(row, 'next_attempt_at'),
    };
  }

  /** `acked`가 있고 `partial`이면 커서를 전진시키며(RELAY_PARTIAL) 시도 횟수를 진전 여부로 정한다, 아니면 RELAY_FAIL. */
  function recordFailure(d: Dest, row: DeliveryRow, code: string, acked: number | null, partial: boolean): void {
    const now = clock.now();
    let attemptsAfter = row.attempts + 1;
    if (partial && acked !== null) {
      attemptsAfter = acked > row.lastAcked ? 1 : row.attempts + 1;
      db.prepare(RELAY_PARTIAL).run({
        dest: d.dest,
        acked_through_seq: acked,
        next_attempt_at: now + backoffDelayMs(attemptsAfter),
        code,
        now,
      });
    } else {
      db.prepare(RELAY_FAIL).run({
        dest: d.dest,
        next_attempt_at: now + backoffDelayMs(attemptsAfter),
        code,
        now,
      });
    }
    failures.inc({ dest: d.dest });
    log.warn({ event: 'relay.delivery.failed', dest: d.dest, attempts: attemptsAfter, code }, 'relay delivery failed');
  }

  async function processBatch(d: Dest, row: DeliveryRow): Promise<boolean> {
    const rawBatch = db.prepare(RELAY_BATCH).all({ last_acked_seq: row.lastAcked, types_json: d.typesJson });
    if (rawBatch.length === 0) {
      db.prepare(RELAY_SKIP_TO_HEAD).run({ dest: d.dest, now: clock.now() });
      return false;
    }
    const batch = rawBatch.map(toBatchRow);
    const lastBatchSeq = batch[batch.length - 1]?.seq ?? row.lastAcked;
    const now = clock.now();
    const sendable = d.mode === 'notify' ? batch.filter((e) => e.occurredAt >= now - NOTIFY_STALE_MS) : batch;
    if (sendable.length === 0) {
      db.prepare(RELAY_ACK).run({ dest: d.dest, acked_through_seq: lastBatchSeq, now });
      return batch.length >= BATCH_MAX;
    }
    const lastSentSeq = sendable[sendable.length - 1]?.seq ?? lastBatchSeq;
    const delivery = InboxDelivery.safeParse({
      producer: svc,
      events: sendable.map((e) => ({
        event_id: e.eventId,
        type: e.type,
        schema_version: e.schemaVersion,
        producer: svc,
        producer_seq: e.seq,
        occurred_at: e.occurredAt,
        correlation_id: e.correlationId,
        causation_id: e.causationId,
        traceparent: e.traceparent,
        payload: parseJsonStrict(e.payload),
      })),
    });
    if (!delivery.success) {
      recordFailure(d, row, 'CONTRACT', null, false);
      return false;
    }
    const result = await transport.deliver(d.dest, delivery.data, row.attempts + 1);
    if (!result.ok) {
      recordFailure(d, row, result.error.code, result.error.acked_through_seq, result.error.code === 'INBOX-HALT');
      return false;
    }
    const acked = result.value.acked_through_seq;
    if (acked >= lastSentSeq) {
      db.prepare(RELAY_ACK).run({ dest: d.dest, acked_through_seq: acked, now: clock.now() });
      return batch.length >= BATCH_MAX;
    }
    recordFailure(d, row, 'INBOX-PARTIAL', acked, true);
    return false;
  }

  async function processDest(d: Dest): Promise<void> {
    if (paused || stopped || inFlight.has(d.dest)) {
      return;
    }
    inFlight.add(d.dest);
    let again = false;
    try {
      const row = readDelivery(d.dest);
      if (row === null || clock.now() < row.nextAttemptAt) {
        return;
      }
      again = await processBatch(d, row);
    } catch (e) {
      log.error({ event: 'relay.drain.crashed', dest: d.dest, err: e }, 'relay drain crashed');
    } finally {
      inFlight.delete(d.dest);
    }
    if (again) {
      kick();
    }
  }

  async function drainAll(): Promise<void> {
    for (const d of dests) {
      await processDest(d);
    }
  }

  function kick(): void {
    if (kickScheduled || paused || stopped) {
      return;
    }
    kickScheduled = true;
    setImmediate(() => {
      kickScheduled = false;
      void track(drainAll());
    });
  }

  const timer = setInterval(() => {
    void track(drainAll());
  }, pollMs);
  timer.unref();

  return {
    kick,
    drainOnce(): Promise<void> {
      if (paused || stopped) {
        return Promise.resolve();
      }
      return track(drainAll());
    },
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
      kick();
    },
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await Promise.all([...running]);
    },
    collectGauges(): void {
      const now = clock.now();
      for (const d of dests) {
        const row = readDelivery(d.dest);
        if (row === null) {
          continue;
        }
        const pending = db.prepare(OUTBOX_PENDING).get({ last_acked_seq: row.lastAcked, types_json: d.typesJson });
        pendingGauge.set(pending === undefined ? 0 : rowInt(pending, 'n'), { dest: d.dest });
        const oldest = pending === undefined ? null : rowIntOrNull(pending, 'oldest');
        oldestGauge.set(oldest === null ? 0 : Math.max(0, now - oldest), { dest: d.dest });
      }
    },
  };
}
