import { setImmediate as yieldTick } from 'node:timers/promises';
import type { ServiceName } from '@fathom/contracts/common/ids';
import type { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import type { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import type { InboxDelivery } from '@fathom/contracts/events/inbox';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import { redactString } from '@fathom/shared-kernel/redact/redact';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { z } from 'zod';
import { INBOX_DEAD_INSERT, INBOX_RECORD, INBOX_SEEN, INBOX_WATERMARK } from './inbox.sql.js';

// IF-01 §3.3 · ARC-01 §8.3 inbox 규칙 · STD-EVT-20~24 — 소비 측 처리기. Fastify에 의존하지 않는다(라우트·인증·본문 검증·quiesce 게이트는 service 모듈).

export type InboxHandlerDef = {
  readonly type: string;
  readonly run: (envelope: IntegrationEventEnvelope, db: SqlitePort) => void;
};
export type InboxConfig =
  | { readonly mode: 'durable'; readonly manifest: ConsumerManifest; readonly handlers: readonly InboxHandlerDef[] }
  | {
      readonly mode: 'notify';
      readonly manifest: ConsumerManifest;
      readonly notify: (events: readonly IntegrationEventEnvelope[]) => void;
    };
export type InboxOutcome =
  | { readonly kind: 'ack'; readonly acked_through_seq: number }
  | { readonly kind: 'halt'; readonly acked_through_seq: number; readonly producer: ServiceName }
  | { readonly kind: 'reject'; readonly reason: 'producer_mismatch' | 'producer_seq_order' };
export interface InboxProcessor {
  process(caller: ServiceName, delivery: InboxDelivery, attempt: number): Promise<InboxOutcome>;
}
export type InboxDeps = {
  readonly db: SqlitePort | null;
  readonly clock: Clock;
  readonly log: Logger;
  readonly metrics: MetricsRegistry;
};

const DEAD_LETTER_ATTEMPTS = 3;
const ERROR_DETAIL_MAX = 500;

// ───────── 실패 표지 [Brief 결정] ─────────

export type InboxFailureCode = 'VAL-SCHEMA' | 'HANDLER-ASYNC' | 'HANDLER-MISSING';

/** inbox 내부 실패 표지: `cause = { inbox_code, error }`. */
export function inboxError(code: InboxFailureCode, message: string, error: unknown = null): Error {
  return new Error(message, { cause: { inbox_code: code, error } });
}

/** 실패 분류기: 표지 → 그 코드, `AppError` → `HANDLER-<code>`, 그 밖 → `HANDLER-EXCEPTION`. */
export function inboxErrorCode(e: unknown): string {
  if (e instanceof Error) {
    const cause: unknown = e.cause;
    if (typeof cause === 'object' && cause !== null && 'inbox_code' in cause && typeof cause.inbox_code === 'string') {
      return cause.inbox_code;
    }
    if (e instanceof AppError) {
      return `HANDLER-${e.code}`;
    }
  }
  return 'HANDLER-EXCEPTION';
}

function isThenable(v: unknown): boolean {
  return (
    (typeof v === 'object' || typeof v === 'function') && v !== null && 'then' in v && typeof v.then === 'function'
  );
}

function summarize(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) {
    return 'payload invalid';
  }
  const where = issue.path.map(String).join('.');
  return `payload invalid at ${where === '' ? '(root)' : where}: ${issue.code}`;
}

/** 스키마 파싱을 통과한 값을 `handle`이 기대하는 출력 타입으로 좁힌다 — `safeParse`가 이미 검증했으므로 이 한 곳에서만 단언한다. */
function narrowPayload<P extends Readonly<Record<number, z.ZodType>>>(parsed: unknown): z.output<P[keyof P]> {
  return parsed as z.output<P[keyof P]>;
}

/** STD-API-27: payload 검증은 여기서 1번만(스키마 선택 = `envelope.schema_version`). thenable 반환 = `HANDLER-ASYNC`(tx가 ROLLBACK된다). */
export function defineInboxHandler<const P extends Readonly<Record<number, z.ZodType>>>(
  type: string,
  payloads: P,
  handle: (envelope: IntegrationEventEnvelope, payload: z.output<P[keyof P]>, db: SqlitePort) => void,
): InboxHandlerDef {
  const byVersion: Readonly<Record<number, z.ZodType>> = payloads;
  return {
    type,
    run(envelope: IntegrationEventEnvelope, db: SqlitePort): void {
      const schema = byVersion[envelope.schema_version];
      if (schema === undefined) {
        throw inboxError('VAL-SCHEMA', `no payload schema for ${type}@v${envelope.schema_version}`);
      }
      const parsed = schema.safeParse(envelope.payload);
      if (!parsed.success) {
        throw inboxError('VAL-SCHEMA', summarize(parsed.error), parsed.error);
      }
      const result: unknown = handle(envelope, narrowPayload<P>(parsed.data), db);
      if (isThenable(result)) {
        throw inboxError('HANDLER-ASYNC', `handler for ${type} returned a Promise (handlers must be synchronous)`);
      }
    },
  };
}

// ───────── 처리기 ─────────

type Subscription = ConsumerManifest['subscriptions'][number];
type EventResult =
  | { readonly kind: 'done'; readonly skipped: string | null }
  | { readonly kind: 'failed'; readonly code: string; readonly detail: string; readonly sub: Subscription | undefined };

function errorDetail(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const firstLine = message.split(/\r?\n/, 1)[0] ?? '';
  return redactString(firstLine).slice(0, ERROR_DETAIL_MAX);
}

function checkConfig(cfg: InboxConfig, deps: InboxDeps): void {
  const wantMode = cfg.mode;
  if (cfg.mode === 'durable' && deps.db === null) {
    throw new Error('invariant: durable inbox requires a database');
  }
  for (const sub of cfg.manifest.subscriptions) {
    if (sub.mode !== wantMode) {
      throw new Error(`invariant: inbox ${wantMode} config has a ${sub.mode} subscription (${sub.type})`);
    }
  }
}

function indexHandlers(cfg: InboxConfig, log: Logger): Map<string, InboxHandlerDef> {
  const handlers = new Map<string, InboxHandlerDef>();
  if (cfg.mode !== 'durable') {
    return handlers;
  }
  for (const h of cfg.handlers) {
    if (handlers.has(h.type)) {
      throw new Error(`invariant: duplicate inbox handler for ${h.type}`);
    }
    handlers.set(h.type, h);
  }
  const subscribed = new Set(cfg.manifest.subscriptions.map((s) => s.type));
  const unsubscribed = [...handlers.keys()].filter((t) => !subscribed.has(t));
  if (unsubscribed.length > 0) {
    log.warn({ event: 'inbox.handler.unsubscribed', types: unsubscribed }, 'inbox handlers without subscription');
  }
  const missing = [...subscribed].filter((t) => !handlers.has(t));
  if (missing.length > 0) {
    log.error({ event: 'inbox.handler.missing', types: missing }, 'inbox subscription without handler');
  }
  return handlers;
}

export function inboxPlugin(cfg: InboxConfig, deps: InboxDeps): InboxProcessor {
  checkConfig(cfg, deps);
  const { clock, log, metrics } = deps;
  const subs = new Map<string, Subscription>(cfg.manifest.subscriptions.map((s) => [s.type, s]));
  const handlers = indexHandlers(cfg, log);
  const deadTotal = metrics.counter('inbox_dead_total', 'inbox_dead로 격리된 독 이벤트 수');
  const haltedGauge = metrics.gauge('inbox_halted', '원장 경로 정지 여부(1 = 정지)', ['producer']);

  function applyEvent(db: SqlitePort, ev: IntegrationEventEnvelope): EventResult {
    const record = (): void => {
      const now = clock.now();
      db.prepare(INBOX_RECORD).run({
        event_id: ev.event_id,
        producer: ev.producer,
        producer_seq: ev.producer_seq,
        type: ev.type,
        now,
      });
      db.prepare(INBOX_WATERMARK).run({ producer: ev.producer, producer_seq: ev.producer_seq, now });
    };
    const sub = subs.get(ev.type);
    try {
      return db.tx((): EventResult => {
        if (db.prepare(INBOX_SEEN).get({ event_id: ev.event_id }) !== undefined) {
          return { kind: 'done', skipped: null };
        }
        if (sub === undefined || !sub.schema_versions.includes(ev.schema_version) || sub.on_poison === 'drop') {
          record();
          return { kind: 'done', skipped: sub === undefined ? 'unsubscribed' : 'schema_version_or_drop' };
        }
        const handler = handlers.get(ev.type);
        if (handler === undefined) {
          throw inboxError('HANDLER-MISSING', `no inbox handler for ${ev.type}`);
        }
        handler.run(ev, db);
        record();
        return { kind: 'done', skipped: null };
      });
    } catch (e) {
      return { kind: 'failed', code: inboxErrorCode(e), detail: errorDetail(e), sub };
    }
  }

  function deadLetter(
    db: SqlitePort,
    ev: IntegrationEventEnvelope,
    failed: { code: string; detail: string },
    attempt: number,
  ): void {
    const now = clock.now();
    db.tx(() => {
      db.prepare(INBOX_DEAD_INSERT).run({
        event_id: ev.event_id,
        producer: ev.producer,
        producer_seq: ev.producer_seq,
        type: ev.type,
        envelope: canonicalJson(ev),
        error_code: failed.code,
        error_detail: failed.detail,
        attempts: attempt,
        failed_at: now,
      });
      db.prepare(INBOX_RECORD).run({
        event_id: ev.event_id,
        producer: ev.producer,
        producer_seq: ev.producer_seq,
        type: ev.type,
        now,
      });
      db.prepare(INBOX_WATERMARK).run({ producer: ev.producer, producer_seq: ev.producer_seq, now });
    });
    deadTotal.inc();
    log.error(
      {
        event: 'inbox.event.dead_lettered',
        producer: ev.producer,
        type: ev.type,
        event_id: ev.event_id,
        code: failed.code,
      },
      'inbox event dead-lettered',
    );
  }

  async function processDurable(db: SqlitePort, delivery: InboxDelivery, attempt: number): Promise<InboxOutcome> {
    const first = delivery.events[0];
    if (first === undefined) {
      throw new Error('invariant: inbox delivery has no events');
    }
    let lastOk = Math.max(0, first.producer_seq - 1);
    let processed = 0;
    for (const [index, ev] of delivery.events.entries()) {
      if (index > 0) {
        await yieldTick(); // STD-ASY-06: 한 틱 ≤ 50ms — 이벤트 사이에 양보한다.
      }
      const result = applyEvent(db, ev);
      if (result.kind === 'done') {
        if (result.skipped !== null) {
          log.warn(
            {
              event: 'inbox.event.skipped',
              producer: ev.producer,
              type: ev.type,
              schema_version: ev.schema_version,
              reason: result.skipped,
            },
            'inbox event skipped',
          );
        }
        lastOk = ev.producer_seq;
        processed += 1;
        continue;
      }
      if (result.sub?.on_poison === 'dead_letter' && attempt >= DEAD_LETTER_ATTEMPTS) {
        deadLetter(db, ev, result, attempt);
        lastOk = ev.producer_seq;
        processed += 1;
        continue;
      }
      if (result.sub?.on_poison === 'dead_letter') {
        return { kind: 'ack', acked_through_seq: lastOk };
      }
      haltedGauge.set(1, { producer: delivery.producer });
      log.error(
        { event: 'inbox.path.halted', producer: ev.producer, type: ev.type, event_id: ev.event_id, code: result.code },
        'inbox path halted',
      );
      return { kind: 'halt', acked_through_seq: lastOk, producer: delivery.producer };
    }
    if (processed > 0) {
      haltedGauge.set(0, { producer: delivery.producer });
    }
    return { kind: 'ack', acked_through_seq: lastOk };
  }

  function processNotify(delivery: InboxDelivery): InboxOutcome {
    const last = delivery.events[delivery.events.length - 1];
    if (last === undefined) {
      throw new Error('invariant: inbox delivery has no events');
    }
    if (cfg.mode === 'notify') {
      const wanted = delivery.events.filter((e) => subs.has(e.type));
      if (wanted.length > 0) {
        try {
          cfg.notify(wanted);
        } catch (e) {
          log.error({ event: 'inbox.notify.failed', err: e }, 'inbox notify callback failed');
        }
      }
    }
    return { kind: 'ack', acked_through_seq: last.producer_seq };
  }

  return {
    process(caller: ServiceName, delivery: InboxDelivery, attempt: number): Promise<InboxOutcome> {
      if (caller !== delivery.producer) {
        return Promise.resolve({ kind: 'reject', reason: 'producer_mismatch' });
      }
      for (let i = 1; i < delivery.events.length; i += 1) {
        const prev = delivery.events[i - 1];
        const cur = delivery.events[i];
        if (prev === undefined || cur === undefined || cur.producer_seq <= prev.producer_seq) {
          return Promise.resolve({ kind: 'reject', reason: 'producer_seq_order' });
        }
      }
      if (cfg.mode === 'notify') {
        return Promise.resolve(processNotify(delivery));
      }
      if (deps.db === null) {
        throw new Error('invariant: durable inbox requires a database');
      }
      return processDurable(deps.db, delivery, attempt);
    },
  };
}
