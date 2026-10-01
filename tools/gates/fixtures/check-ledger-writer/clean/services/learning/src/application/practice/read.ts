import type { DatabaseSync } from 'node:sqlite';

export function read(db: DatabaseSync) {
  db.prepare('SELECT * FROM lr_event WHERE event_id = ?').get('e');
  db.prepare('INSERT INTO lr_event_archive (event_id) VALUES (?)').run('e'); // 다른 테이블(접두 일치만)
  db.prepare('UPDATE lr_card_state SET due = ? WHERE card_id = ?').run(1, 'c');
  db.prepare('DELETE FROM lr_session WHERE session_id = ?').run('s');
}
