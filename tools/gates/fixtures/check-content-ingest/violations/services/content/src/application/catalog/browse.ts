import type { DatabaseSync } from 'node:sqlite';

export function browse(db: DatabaseSync) {
  db.prepare('INSERT INTO ct_concept (id) VALUES (?)').run('c'); // EXPECT[ingest/write-location]
  db.prepare('DELETE FROM "ct_pack" WHERE 1').run(); // EXPECT[ingest/write-location]
  db.prepare('UPDATE ct_concept SET title = ?').run('t'); // EXPECT[ingest/write-location]
  return db.prepare('SELECT id FROM ct_concept').all();
}
