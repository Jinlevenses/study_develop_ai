import type { DatabaseSync } from 'node:sqlite';

export function stage(db: DatabaseSync) {
  db.prepare('INSERT INTO aq_staging_diff (id) VALUES (?)').run('d');
  db.prepare('DELETE FROM aq_staging_item WHERE 1').run();
}
