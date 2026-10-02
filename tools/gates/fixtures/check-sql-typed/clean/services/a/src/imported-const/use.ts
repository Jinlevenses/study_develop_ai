import { DatabaseSync } from 'node:sqlite';
import { SELECT_ONE, SELECT_TWO as TWO } from './a.sql.js';
import { RE_ONE, SELECT_TWO as CHAIN_TWO } from './reexport.sql.js';

export function use(db: DatabaseSync) {
  db.prepare(SELECT_ONE);
  db.prepare(TWO);
  db.exec(RE_ONE);
  db.exec(CHAIN_TWO);
}
