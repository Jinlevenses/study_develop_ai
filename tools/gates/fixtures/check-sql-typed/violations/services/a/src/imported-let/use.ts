import { DatabaseSync } from 'node:sqlite';
import { MUTABLE_SQL as Q } from './a.sql.js';

export function use(db: DatabaseSync) {
  db.prepare(Q); // EXPECT[sql/dynamic-arg]
}
