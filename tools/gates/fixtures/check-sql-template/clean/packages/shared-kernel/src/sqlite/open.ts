import type { DatabaseSync } from 'node:sqlite';

export function configure(db: DatabaseSync) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('BEGIN DEFERRED');
}
