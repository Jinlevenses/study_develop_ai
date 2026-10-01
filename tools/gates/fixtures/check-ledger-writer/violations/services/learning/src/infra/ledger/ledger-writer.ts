import type { DatabaseSync } from 'node:sqlite';

export function bad(db: DatabaseSync) {
  db.prepare('INSERT INTO lr_event (event_id) VALUES (?)').run('e'); // EXPECT[ledger/insert-form]
  db.prepare('INSERT OR ABORT INTO lr_event (event_id) VALUES (?)').run('e'); // EXPECT[ledger/insert-form]
  db.prepare('INSERT OR REPLACE INTO lr_event (event_id) VALUES (?)').run('e'); // EXPECT[ledger/replace]
  db.prepare('REPLACE INTO lr_event (event_id) VALUES (?)').run('e'); // EXPECT[ledger/replace]
  db.prepare('INSERT OR IGNORE INTO lr_event (event_id) VALUES (?) ON CONFLICT(event_id) DO UPDATE SET device_id = 1').run('e'); // EXPECT[ledger/upsert]
  db.prepare('UPDATE lr_event SET device_id = ?').run('d'); // EXPECT[ledger/mutation]
  db.prepare('DELETE FROM lr_event').run(); // EXPECT[ledger/mutation]
  db.exec('DROP TRIGGER IF EXISTS trg_lr_event_no_update'); // EXPECT[ledger/drop-trigger]
  db.prepare('INSERT OR IGNORE INTO lr_event (event_id) VALUES (?)').run('e'); // 정상형
}
