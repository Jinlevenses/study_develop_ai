import { AdminEventsView } from '@fathom/contracts/admin/admin-routes';
import { ServiceName } from '@fathom/contracts/common/ids';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { rowInt, rowStr, rowStrOrNull } from './row.js';
import { TIMELINE_DEAD, TIMELINE_DELIVERY, TIMELINE_OUTBOX } from './timeline.sql.js';

/**
 * IF-COM-009 `AdminEventsView`. `delivered`는 ServiceName 5키 전부(없는 목적지 = false).
 * [Brief 결정] `inbox`는 `[]` — `inbox_dedupe`에 correlation 열이 없다(CR 후보: 열 가산 또는 `event_ids` 질의 파라미터).
 */
export function readEventTimeline(db: SqlitePort, svc: ServiceName, correlationId: string): AdminEventsView {
  const cursors = new Map<string, number>();
  for (const row of db.prepare(TIMELINE_DELIVERY).all()) {
    cursors.set(rowStr(row, 'dest'), rowInt(row, 'last_acked_seq'));
  }
  const outbox = db
    .prepare(TIMELINE_OUTBOX)
    .all({ cid: correlationId })
    .map((row) => {
      const seq = rowInt(row, 'seq');
      const delivered: Record<string, boolean> = {};
      for (const name of ServiceName.options) {
        const acked = cursors.get(name);
        delivered[name] = acked !== undefined && seq <= acked;
      }
      return {
        seq,
        event_id: rowStr(row, 'event_id'),
        type: rowStr(row, 'type'),
        occurred_at: rowInt(row, 'occurred_at'),
        causation_id: rowStrOrNull(row, 'causation_id'),
        delivered,
      };
    });
  const dead = db
    .prepare(TIMELINE_DEAD)
    .all({ cid: correlationId })
    .map((row) => ({
      event_id: rowStr(row, 'event_id'),
      producer: rowStr(row, 'producer'),
      type: rowStr(row, 'type'),
      error_code: rowStr(row, 'error_code'),
      failed_at: rowInt(row, 'failed_at'),
      resolution: rowStrOrNull(row, 'resolution'),
    }));
  return AdminEventsView.parse({ svc, outbox, inbox: [], dead });
}
