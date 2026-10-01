// DB-01 §3.5·§3.6 — lint:hooks 입력(리터럴만)
export type DbNameHook = { readonly hook: string; readonly table: string; readonly columns: readonly string[]; readonly file: string };
export const DB_NAME_HOOKS = [
  {
    hook: 'event',
    table: 'lr_event',
    columns: ['event_id', 'device_id'],
    file: 'services/learning/migrations/ledger/0001_ledger_core.sql',
  },
  {
    hook: 'insight',
    table: 'in_note',
    columns: ['note_id'],
    file: 'services/learning/migrations-insight/0001_insight_core.sql',
  },
  {
    hook: 'cache',
    table: 'ac_entry',
    columns: ['entry_key', 'alt_col'],
    file: 'services/ai-gateway/migrations-cache/0001_cache_core.sql',
  },
] as const satisfies readonly DbNameHook[];

export type DbExtHook = { readonly hook: string; readonly tables: readonly string[]; readonly keys: readonly string[]; readonly deferred: string };
export const DB_EXT_HOOKS = [
  { hook: 'graph_ref', tables: ['lr_event'], keys: ['graph.ref'], deferred: 'DEF-01' },
] as const satisfies readonly DbExtHook[];

export const DB_EXT_TABLES = [
  { db: 'learning.db', table: 'lr_event' },
  { db: 'insight.db', table: 'in_note' },
  { db: 'ai-cache.db', table: 'ac_entry' },
  { db: 'content.db', table: 'ct_pack' },
] as const;
