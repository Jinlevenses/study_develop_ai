import type { DatabaseSync } from 'node:sqlite';

export function bad(db: DatabaseSync) {
  db.prepare('INSERT OR IGNORE INTO lr_event (event_id) VALUES (?)').run('e'); // EXPECT[ledger/writer-location]
  db.prepare('INSERT INTO lr_event (event_id) VALUES (?)').run('e'); // EXPECT[ledger/writer-location] EXPECT[ledger/insert-form]
  db.prepare('DELETE FROM "lr_event" WHERE 1').run(); // EXPECT[ledger/writer-location] EXPECT[ledger/mutation]
  db.prepare('REPLACE INTO lr_event (event_id) VALUES (?)').run('e'); // EXPECT[ledger/writer-location] EXPECT[ledger/replace]
  db.prepare(` -- EXPECT[ledger/writer-location] EXPECT[ledger/replace]
    INSERT OR REPLACE INTO
      lr_event (event_id)
    VALUES (?)
  `).run('e');
  db.exec('DROP TRIGGER trg_other'); // EXPECT[ledger/drop-trigger]
  db.prepare('SELECT * FROM lr_event').all();
}
