import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { applyIncremental } from '../../application/learner-model/incremental.js';
import type {
  LedgerReplaySource,
  ProjectionApplier,
  ProjectionStore,
  ProjectorParamsResolver,
} from '../../application/learner-model/ports.js';
import { LIVE_TABLES } from '../db/learner-model-projection.sql.js';
import { createProjectionStore } from '../db/learner-model-store.js';
import { createEventTargetLookup } from '../db/learner-model-targets.js';
import { ensureProjectionMeta } from './meta.js';

// ADR-011 §5 · DB-01 §6.3 append 프로토콜 4 — 원장 append와 같은 BEGIN IMMEDIATE tx 안에서 동기 호출되는 인라인 투영.
// 동기 함수, tx를 열지 않는다(STD-ASY-02). 예외(ts-fsrs FSRSValidationError 포함)는 감싸지 않고 그대로 던진다(STD-ERR-14) — 롤백·경보는 writer 몫.

export type ProjectionApplierDeps = {
  readonly source: LedgerReplaySource;
  readonly params: ProjectorParamsResolver;
  readonly clock: Clock;
};

export function createProjectionApplier(deps: ProjectionApplierDeps): ProjectionApplier {
  const targets = createEventTargetLookup();
  const stores = new WeakMap<SqlitePort, ProjectionStore>();
  return {
    apply(db: SqlitePort, event: LedgerEventEnvelope): void {
      let store = stores.get(db);
      if (store === undefined) {
        store = createProjectionStore(db, LIVE_TABLES);
        stores.set(db, store);
      }
      applyIncremental({ db, source: deps.source, targets, store, params: deps.params }, event);
      ensureProjectionMeta(db, deps.clock);
    },
  };
}
