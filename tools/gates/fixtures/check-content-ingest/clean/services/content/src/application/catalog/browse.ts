import type { DatabaseSync } from 'node:sqlite';

export function browse(db: DatabaseSync) {
  return db.prepare('SELECT id FROM ct_concept WHERE id IN (SELECT id FROM ct_ku)').all();
}
