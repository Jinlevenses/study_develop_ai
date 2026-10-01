import type { DatabaseSync } from 'node:sqlite';

export function load(db: DatabaseSync) {
  db.prepare('INSERT OR REPLACE INTO ct_ku (id) VALUES (?)').run('k'); // EXPECT[ingest/replace]
  db.prepare('INSERT OR IGNORE INTO ct_concept (id) VALUES (?)').run('c');
}
