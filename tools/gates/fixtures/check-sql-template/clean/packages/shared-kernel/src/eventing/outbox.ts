import type { DatabaseSync } from 'node:sqlite';

export function appendEvent(db: DatabaseSync, id: string) {
  return db.prepare('INSERT INTO outbox (event_id) VALUES (?)').run(id);
}
