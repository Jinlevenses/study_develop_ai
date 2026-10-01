import type { DatabaseSync } from 'node:sqlite';

export function apply(db: DatabaseSync) {
  db.prepare('UPDATE ct_overlay_head SET head = ?').run('h');
  db.prepare('UPDATE ct_concept SET title = ?').run('t'); // EXPECT[ingest/write-location]
  db.prepare('INSERT OR REPLACE INTO ib_item (id) VALUES (?)').run('i'); // EXPECT[ingest/replace]
}
