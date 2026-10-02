import { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { LedgerReplaySource } from '../../../../src/application/learner-model/ports.js';

// 테스트 지원: 실제 lr_event를 읽는 LedgerReplaySource(T-01-02 `createLedgerReplayReader`의 대역 — 병렬 Task라 import하지 않는다).
// 순서 = DB-01 LEDGER_REPLAY(client_ts, device_id, device_seq). 모든 이벤트는 schema_version 1이므로 upcast 없음.

const COLUMNS =
  'event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at';
const ORDER = 'ORDER BY client_ts, device_id, device_seq';

const REPLAY = `SELECT ${COLUMNS} FROM lr_event ${ORDER}`;
const BY_CARD = `SELECT ${COLUMNS} FROM lr_event WHERE card_id = :id ${ORDER}`;
const BY_CONCEPT = `SELECT ${COLUMNS} FROM lr_event WHERE concept_id = :id ${ORDER}`;
const CORRECTIONS = `SELECT ${COLUMNS} FROM lr_event WHERE type IN ('evidence.voided', 'evidence.weight_adjusted') ${ORDER}`;
const MAX_ROWID = 'SELECT coalesce(max(rowid), 0) AS n FROM lr_event';
const SINCE = `SELECT ${COLUMNS} FROM lr_event WHERE rowid > :after ORDER BY rowid`;

function toEnvelope(row: Record<string, unknown>): LedgerEventEnvelope {
  const payload = row.payload;
  if (typeof payload !== 'string') {
    throw new Error('invariant: lr_event.payload is not text');
  }
  return LedgerEventEnvelope.parse({ ...row, payload: parseJsonStrict(payload) });
}

function* mapRows(rows: IterableIterator<Record<string, unknown>>): IterableIterator<LedgerEventEnvelope> {
  for (const row of rows) {
    yield toEnvelope(row);
  }
}

export function createSqlReplaySource(): LedgerReplaySource {
  return {
    replay: (db: SqlitePort) => mapRows(db.prepare(REPLAY).iterate()),
    byCard: (db: SqlitePort, id: string) => mapRows(db.prepare(BY_CARD).iterate({ id })),
    byConcept: (db: SqlitePort, id: string) => mapRows(db.prepare(BY_CONCEPT).iterate({ id })),
    corrections: (db: SqlitePort) => mapRows(db.prepare(CORRECTIONS).iterate()),
    maxRowid: (db: SqlitePort) => Number(db.prepare(MAX_ROWID).get()?.n ?? 0),
    sinceRowid: (db: SqlitePort, after: number) => mapRows(db.prepare(SINCE).iterate({ after })),
  };
}
