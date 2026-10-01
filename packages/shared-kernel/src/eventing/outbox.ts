import type { ServiceName } from '@fathom/contracts/common/ids';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import { isUlid, ulid } from '@fathom/shared-kernel/ids/ids';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { z } from 'zod';
import { APPEND_OUTBOX } from './outbox.sql.js';

// IF-01 §9.2 기록 행 · STD-EVT-10·11 — transactional outbox 기록. 이벤트 1건 = 행 1개(목적지별 복제 없음).

/** = contracts `registry.gen` EVENT_PAYLOADS 모양: `{ '<type>': { <schema_version>: ZodType } }`. */
export type EventPayloadRegistry = Readonly<Record<string, Readonly<Record<number, z.ZodType>>>>;

export type OutboxOptions = {
  readonly db: SqlitePort;
  readonly svc: ServiceName;
  readonly clock: Clock;
  readonly payloads: EventPayloadRegistry;
  readonly currentTraceparent: () => string | null;
  readonly onAppended: () => void;
  readonly newId?: () => string;
};
export type AppendEventInput = {
  readonly type: string;
  readonly schema_version: number;
  readonly correlation_id: string;
  readonly causation_id?: string | null;
  readonly payload: unknown;
};
export interface Outbox {
  readonly db: SqlitePort;
  readonly svc: ServiceName;
  append(input: AppendEventInput): { readonly event_id: string; readonly seq: number };
}

/**
 * [Brief 결정] ARC의 `appendEvent(tx, …)`의 `tx` = `Outbox` 핸들(DB + 시계 + 페이로드 레지스트리 + 추적 컨텍스트).
 * 호출자는 반드시 `outbox.db.tx(() => { …상태 변경…; appendEvent(outbox, {...}) })` 안에서 부른다(같은 `BEGIN IMMEDIATE`, STD-EVT-10) —
 * 런타임에서 검사할 수단이 없으므로 이 JSDoc과 통합 테스트(롤백 시 outbox 0행)로 보증한다.
 */
export function createOutbox(opts: OutboxOptions): Outbox {
  const newId = opts.newId ?? ulid;
  return {
    db: opts.db,
    svc: opts.svc,
    append(input: AppendEventInput): { readonly event_id: string; readonly seq: number } {
      const schema = opts.payloads[input.type]?.[input.schema_version];
      if (schema === undefined) {
        throw new Error(`invariant: unknown event ${input.type}@v${input.schema_version}`);
      }
      if (!isUlid(input.correlation_id)) {
        throw new Error('invariant: event correlation_id must be a ULID');
      }
      const causation = input.causation_id ?? null;
      if (causation !== null && !isUlid(causation)) {
        throw new Error('invariant: event causation_id must be a ULID or null');
      }
      const parsed = schema.safeParse(input.payload);
      if (!parsed.success) {
        throw new Error(`invariant: event payload invalid for ${input.type}@v${input.schema_version}`, {
          cause: parsed.error,
        });
      }
      const eventId = newId();
      const result = opts.db.prepare(APPEND_OUTBOX).run({
        event_id: eventId,
        type: input.type,
        schema_version: input.schema_version,
        occurred_at: opts.clock.now(),
        correlation_id: input.correlation_id,
        causation_id: causation,
        traceparent: opts.currentTraceparent(),
        payload: canonicalJson(parsed.data),
      });
      const seq = Number(result.lastInsertRowid);
      if (!Number.isSafeInteger(seq)) {
        throw new Error('invariant: outbox seq is not a safe integer');
      }
      opts.onAppended();
      return { event_id: eventId, seq };
    },
  };
}

/** `tx.append(input)` — ARC-01 §17.3 `appendEvent(tx, …)`. */
export function appendEvent(tx: Outbox, input: AppendEventInput): { readonly event_id: string; readonly seq: number } {
  return tx.append(input);
}
