import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

// PGM-LR-173 · DB-01 §12.1 — learning 전용 스냅샷 확장(ledger_head·projection_hash·fsrs_impl). 값은 사본 연결에서만 읽는다.
export type LearningSnapshotExtras = {
  readonly ledger_head: Readonly<Record<string, { readonly seq: number; readonly hash: string }>>;
  readonly projection_hash?: string;
  readonly fsrs_impl?: string;
};

// = DB-01 §6.3 LEDGER_HEADS — IT-01 infra/ledger/ledger.sql.ts 생성 후 그 상수로 교체
const LEDGER_HEADS =
  'SELECT e.device_id, e.device_seq AS seq, e.hash AS head_hash FROM lr_event e\nWHERE e.device_seq = (SELECT max(device_seq) FROM lr_event x WHERE x.device_id = e.device_id);';
const PROJECTION_META_LIVE = "SELECT projection_hash, fsrs_impl FROM lr_projection_meta WHERE name = 'live'";

function safeInt(v: unknown, what: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`invariant: ${what} is not a safe integer`);
  }
  return n;
}

export function learningSnapshotExtras(copy: SqlitePort): LearningSnapshotExtras {
  const heads: Record<string, { readonly seq: number; readonly hash: string }> = {};
  for (const row of copy.prepare(LEDGER_HEADS).all()) {
    heads[String(row.device_id)] = { seq: safeInt(row.seq, 'ledger head seq'), hash: String(row.head_hash) };
  }
  const meta = copy.prepare(PROJECTION_META_LIVE).get();
  if (meta === undefined) {
    return { ledger_head: heads };
  }
  return { ledger_head: heads, projection_hash: String(meta.projection_hash), fsrs_impl: String(meta.fsrs_impl) };
}
