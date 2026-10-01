// lint:hooks 위반 입력
export const DB_NAME_HOOKS = [
  {
    hook: 'gone',
    table: 'lr_gone',
    columns: ['a'],
    file: 'services/learning/migrations/ledger/0099_gone.sql', // EXPECT[hooks/file-missing]
  },
  {
    hook: 'notable',
    table: 'lr_nope',
    columns: ['a'],
    file: 'services/learning/migrations/ledger/0001_ledger_core.sql',
  },
  {
    hook: 'noname',
    table: 'lr_event',
    columns: ['event_id', 'no_such_col', 'alter_col', 'late_col'],
    file: 'services/learning/migrations/ledger/0001_ledger_core.sql',
  },
] as const;

export const DB_EXT_HOOKS = [
  { hook: 'graph_ref', tables: ['lr_event'], keys: ['graph.ref'], deferred: 'DEF-01' },
] as const;

export const DB_EXT_TABLES = [
  { db: 'learning.db', table: 'lr_event' },
  { db: 'learning.db', table: 'lr_noext' },
  { db: 'learning.db', table: 'lr_nodefault' },
  { db: 'learning.db', table: 'lr_nocheck' },
  { db: 'learning.db', table: 'lr_badextv' },
  { db: 'learning.db', table: 'lr_ghost' }, // EXPECT[hooks/table-missing]
  { db: 'insight.db', table: 'in_note' },
  { db: 'ai-cache.db', table: 'lr_event' }, // EXPECT[hooks/table-missing]
] as const;
