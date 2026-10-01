import { ServiceName } from '@fathom/contracts/common/ids';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { REWIND_DELIVERY } from './relay.sql.js';

/**
 * DB-01 §12.3 복원 되감기 — durable 목적지의 커서를 `map` 값으로 옮긴다(**뒤로도**). notify 행·없는 목적지는 무시한다.
 * 한 tx. 바뀐 행 수를 돌려준다.
 */
export function rewindCursors(
  db: SqlitePort,
  map: Readonly<Partial<Record<ServiceName, number>>>,
  clock: Clock,
): number {
  const entries: { dest: ServiceName; seq: number }[] = [];
  for (const [name, seq] of Object.entries(map)) {
    if (seq === undefined) {
      continue;
    }
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new Error('invariant: rewind seq must be a non-negative safe integer');
    }
    entries.push({ dest: ServiceName.parse(name), seq });
  }
  return db.tx(() => {
    let changed = 0;
    for (const { dest, seq } of entries) {
      changed += db.prepare(REWIND_DELIVERY).run({ dest, rewind_seq: seq, now: clock.now() }).changes;
    }
    return changed;
  });
}
