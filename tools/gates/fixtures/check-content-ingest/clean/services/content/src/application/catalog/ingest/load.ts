import type { DatabaseSync } from 'node:sqlite';

export function load(db: DatabaseSync) {
  db.prepare('INSERT OR IGNORE INTO ct_concept (id) VALUES (?)').run('c');
  db.prepare('UPDATE ct_pack_active SET pack_id = ?').run('p');
  db.prepare('DELETE FROM "ct_pack_delta" WHERE 1').run();
}
