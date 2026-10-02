import type { SqlitePort, Stmt } from '@fathom/shared-kernel/sqlite/sqlite';
import type { EventTargetLookup } from '../../application/learner-model/ports.js';
import { EVENT_TARGET_KEYS } from './learner-model-projection.sql.js';

// 정정 대상 event_id → card_id·concept_id (lr_event STORED 열, 읽기 전용).

export function createEventTargetLookup(): EventTargetLookup {
  const cache = new WeakMap<SqlitePort, Stmt>();
  return {
    keysOf(db: SqlitePort, eventIds: readonly string[]) {
      if (eventIds.length === 0) {
        return { card_ids: [], concept_ids: [] };
      }
      let stmt = cache.get(db);
      if (stmt === undefined) {
        stmt = db.prepare(EVENT_TARGET_KEYS);
        cache.set(db, stmt);
      }
      const cards = new Set<string>();
      const concepts = new Set<string>();
      for (const row of stmt.all({ ids: JSON.stringify(eventIds) })) {
        if (typeof row.card_id === 'string') {
          cards.add(row.card_id);
        }
        if (typeof row.concept_id === 'string') {
          concepts.add(row.concept_id);
        }
      }
      return { card_ids: [...cards].sort(), concept_ids: [...concepts].sort() };
    },
  };
}
