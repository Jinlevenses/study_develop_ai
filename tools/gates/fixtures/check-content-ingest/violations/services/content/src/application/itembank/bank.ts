import type { DatabaseSync } from 'node:sqlite';

export function bank(db: DatabaseSync) {
  db.prepare('REPLACE INTO ib_item (id) VALUES (?)').run('i'); // EXPECT[ingest/write-location] EXPECT[ingest/replace]
  db.prepare('INSERT INTO ib_item_model (id) VALUES (?)').run('i'); // EXPECT[ingest/write-location]
  db.prepare('INSERT INTO aq_staging_diff (id) VALUES (?)').run('d');
}
