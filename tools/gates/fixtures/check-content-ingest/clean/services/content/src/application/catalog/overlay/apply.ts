import type { DatabaseSync } from 'node:sqlite';

export function apply(db: DatabaseSync) {
  db.prepare('UPDATE ct_overlay_head SET head = ?').run('h');
  db.prepare('UPDATE ct_search_doc SET body = ?').run('b');
  db.prepare('UPDATE ib_item SET deprecated = 1 WHERE id = ?').run('i');
}
