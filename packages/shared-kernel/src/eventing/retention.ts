import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { PURGE_IDEM_REQUEST, PURGE_INBOX_DEAD, PURGE_INBOX_DEDUPE, PURGE_OUTBOX } from './retention.sql.js';

// DB-01 §15 공통 4행 — `_infra` 보존 정리. 한 배치 = `db.tx` 1개(≤ 500행). 호출자(createService 타이머)가 회차를 나눈다.

const DAY_MS = 86_400_000;
const BATCH_ROWS = 500;
const DEFAULT_MAX_BATCHES = 20;

export type PurgeResult = {
  readonly deleted: Readonly<Record<'outbox' | 'inbox_dedupe' | 'inbox_dead' | 'idem_request', number>>;
  /** 어느 표든 배치 상한에 닿아 아직 지울 행이 남았을 수 있으면 true — 호출자가 다음 회차를 잡는다. */
  readonly more: boolean;
};

export function purgeInfraOnce(db: SqlitePort, clock: Clock, opts?: { readonly maxBatches?: number }): PurgeResult {
  const maxBatches = opts?.maxBatches ?? DEFAULT_MAX_BATCHES;
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new Error('invariant: purge maxBatches must be a positive integer');
  }
  const now = clock.now();
  let more = false;
  /** `once`는 문장 1배치를 실행하고 지운 행 수를 돌려준다. 배치마다 tx 1개. */
  const run = (once: () => number): number => {
    let total = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const changes = db.tx(once);
      total += changes;
      if (changes < BATCH_ROWS) {
        return total;
      }
    }
    more = true;
    return total;
  };
  return {
    deleted: {
      outbox: run(() => db.prepare(PURGE_OUTBOX).run({ cutoff_7d: now - 7 * DAY_MS }).changes),
      inbox_dedupe: run(() => db.prepare(PURGE_INBOX_DEDUPE).run({ cutoff_30d: now - 30 * DAY_MS }).changes),
      inbox_dead: run(() => db.prepare(PURGE_INBOX_DEAD).run({ cutoff_90d: now - 90 * DAY_MS }).changes),
      idem_request: run(() => db.prepare(PURGE_IDEM_REQUEST).run({ cutoff_7d: now - 7 * DAY_MS }).changes),
    },
    more,
  };
}
