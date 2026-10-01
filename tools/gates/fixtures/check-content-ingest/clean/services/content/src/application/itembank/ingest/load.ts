import type { DatabaseSync } from 'node:sqlite';

export function load(db: DatabaseSync) {
  db.prepare('INSERT OR IGNORE INTO ib_item (id) VALUES (?)').run('i');
  db.prepare('INSERT INTO ib_item_model (id) VALUES (?)').run('i');
}
