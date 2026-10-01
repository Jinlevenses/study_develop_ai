import type { DatabaseSync } from 'node:sqlite';

export function bad(db: DatabaseSync) {
  db.exec('PRAGMA journal_mode = WAL'); // EXPECT[sql/pragma]
  db.exec(`  pragma   foreign_keys = ON`); // EXPECT[sql/pragma]
  db.exec('BEGIN'); // EXPECT[sql/deferred-begin]
  db.exec('BEGIN DEFERRED TRANSACTION;'); // EXPECT[sql/deferred-begin]
  db.exec('BEGIN IMMEDIATE'); // 허용
  db.prepare('INSERT INTO outbox (event_id) VALUES (?)').run('x'); // EXPECT[sql/outbox-insert]
  db.prepare('insert or ignore into "outbox" (event_id) values (?)').run('x'); // EXPECT[sql/outbox-insert]
  db.exec('PRAGMA ' + 'user_version'); // EXPECT[sql/pragma]
  // sql-ok:
  db.exec('PRAGMA synchronous = FULL'); // EXPECT[sql/pragma]
}
