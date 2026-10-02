import { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { LEDGER_PAYLOADS } from '@fathom/contracts/ledger/types';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { z } from 'zod';
import type { LedgerReplayReader } from '../../application/ledger/ports.js';
import { upcast } from '../../domain/ledger/upcasters/registry.js';
import {
  LEDGER_MAX_ROWID,
  LEDGER_REPLAY,
  LEDGER_REPLAY_BY_CARD,
  LEDGER_REPLAY_BY_CONCEPT,
  LEDGER_REPLAY_CORRECTIONS,
  LEDGER_SINCE_ROWID,
} from './ledger.sql.js';

// ADR-011 §2·§8 · NFR-DATA-011 — 리플레이 리더. 행 → JSON.parse → upcast(최신 schema_version) → LEDGER_PAYLOADS 검증 → LedgerEventEnvelope.parse.
// 실패 = invariant throw(원장 손상 — 상위 job이 경보한다). 오류 문장에는 event_id·타입·경로만 담고 payload 값은 담지 않는다(STD-LOG-22).

function invalidRow(row: Record<string, unknown>, reason: string): never {
  throw new Error(
    `invariant: ledger row unreadable (event_id=${String(row.event_id)}, type=${String(row.type)}): ${reason}`,
  );
}

function issueSummary(error: z.ZodError): string {
  const issue = error.issues[0];
  const where = issue === undefined ? '(root)' : issue.path.map(String).join('.') || '(root)';
  return `invalid at ${where}: ${issue?.code ?? 'unknown'}`;
}

function toEnvelope(row: Record<string, unknown>): LedgerEventEnvelope {
  const type = LedgerEventEnvelope.shape.type.safeParse(row.type);
  if (!type.success) {
    return invalidRow(row, 'unknown type');
  }
  let stored: unknown;
  try {
    stored = parseJsonStrict(String(row.payload));
  } catch {
    return invalidRow(row, 'payload is not valid json');
  }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return invalidRow(row, 'payload is not an object');
  }
  const stampedVersion = Number(row.schema_version);
  const up = upcast(type.data, stampedVersion, Object.fromEntries(Object.entries(stored)));
  if (!up.ok) {
    return invalidRow(row, up.error.detail);
  }
  const byVersion: Readonly<Record<number, z.ZodType>> = LEDGER_PAYLOADS[type.data];
  const schema = byVersion[up.value.schema_version];
  if (schema === undefined) {
    return invalidRow(row, `no payload schema v${up.value.schema_version}`);
  }
  const payload = schema.safeParse(up.value.payload);
  if (!payload.success) {
    return invalidRow(row, issueSummary(payload.error));
  }
  const envelope = LedgerEventEnvelope.safeParse({
    event_id: row.event_id,
    device_id: row.device_id,
    device_seq: row.device_seq,
    client_ts: row.client_ts,
    type: type.data,
    schema_version: up.value.schema_version,
    idempotency_key: row.idempotency_key,
    payload: payload.data,
    prev_hash: row.prev_hash,
    hash: row.hash,
    experiment_arm: row.experiment_arm,
    recorded_at: row.recorded_at,
  });
  if (!envelope.success) {
    return invalidRow(row, issueSummary(envelope.error));
  }
  return envelope.data;
}

function* envelopes(rows: IterableIterator<Record<string, unknown>>): IterableIterator<LedgerEventEnvelope> {
  for (const row of rows) {
    yield toEnvelope(row);
  }
}

export function createLedgerReplayReader(): LedgerReplayReader {
  return {
    replay: (db: SqlitePort) => envelopes(db.prepare(LEDGER_REPLAY).iterate()),
    byCard: (db: SqlitePort, cardId: string) =>
      envelopes(db.prepare(LEDGER_REPLAY_BY_CARD).iterate({ card_id: cardId })),
    byConcept: (db: SqlitePort, conceptId: string) =>
      envelopes(db.prepare(LEDGER_REPLAY_BY_CONCEPT).iterate({ concept_id: conceptId })),
    corrections: (db: SqlitePort) => envelopes(db.prepare(LEDGER_REPLAY_CORRECTIONS).iterate()),
    maxRowid(db: SqlitePort): number {
      const row = db.prepare(LEDGER_MAX_ROWID).get();
      return row === undefined ? 0 : Number(row.n);
    },
    sinceRowid: (db: SqlitePort, after: number) => envelopes(db.prepare(LEDGER_SINCE_ROWID).iterate({ after })),
  };
}
