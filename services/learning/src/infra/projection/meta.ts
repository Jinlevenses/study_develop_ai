import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import {
  LEDGER_COUNT,
  LEDGER_LAST_ORDER,
  LEDGER_LAST_POLICY_SWITCHED,
  META_LIVE_PRESENT,
  META_UPSERT,
} from '../db/learner-model-hash.sql.js';
import { projectionHashFromDb } from './projection-hash.js';

// DB-01 §6.7 lr_projection_meta — "마지막 계산 시점의 일관된 3종(hash·count·last_order)". 라이브 append마다 다시 계산하지 않는다(≤ 100ms tx 예산).
// 갱신 지점 = 지연 시드(CO-20)·rebuild·T-01-09/IT-03이 체크포인트·epoch 때 호출하는 recomputeProjectionMeta.

export const FSRS_IMPL = 'ts-fsrs@5.4.2';
export const NO_POLICY_VERSION = 'ps_0000000000000000';

function safeCount(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error('invariant: ledger count is not a safe non-negative integer');
  }
  return n;
}

/** 호출자 tx 안에서 projection_hash·fsrs_impl·policy_version·event_count·last_order_json·computed_at을 UPSERT한다. */
export function recomputeProjectionMeta(
  db: SqlitePort,
  clock: Clock,
): { readonly projection_hash: string; readonly event_count: number } {
  const projectionHash = projectionHashFromDb(db);
  const eventCount = safeCount(db.prepare(LEDGER_COUNT).get()?.n);
  const last = db.prepare(LEDGER_LAST_ORDER).get();
  const lastOrder = last === undefined ? [] : [Number(last.client_ts), String(last.device_id), Number(last.device_seq)];
  const policy = db.prepare(LEDGER_LAST_POLICY_SWITCHED).get();
  const policyVersion = typeof policy?.ps === 'string' ? policy.ps : NO_POLICY_VERSION;
  db.prepare(META_UPSERT).run({
    projection_hash: projectionHash,
    fsrs_impl: FSRS_IMPL,
    policy_version: policyVersion,
    event_count: eventCount,
    last_order_json: JSON.stringify(lastOrder),
    computed_at: clock.now(),
  });
  return { projection_hash: projectionHash, event_count: eventCount };
}

/** `name='live'` 행이 없을 때만 계산한다(CO-20 지연 시드). 있으면 읽기 1회뿐. */
export function ensureProjectionMeta(db: SqlitePort, clock: Clock): void {
  if (db.prepare(META_LIVE_PRESENT).get() !== undefined) {
    return;
  }
  recomputeProjectionMeta(db, clock);
}
