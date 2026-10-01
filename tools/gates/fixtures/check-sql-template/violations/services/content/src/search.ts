import type { DatabaseSync } from 'node:sqlite';

export function byId(db: DatabaseSync, id: string) {
  return db.prepare('SELECT id FROM ct_concept WHERE id = ?').get(id);
}
