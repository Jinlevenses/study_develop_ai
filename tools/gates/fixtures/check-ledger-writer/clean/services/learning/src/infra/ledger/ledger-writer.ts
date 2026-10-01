import type { DatabaseSync } from 'node:sqlite';

declare function placeholders(n: number): string;

export function write(db: DatabaseSync, n: number) {
  db.prepare('INSERT OR IGNORE INTO lr_event (event_id, device_id) VALUES (?, ?)').run('e', 'd');
  db.prepare(`
    INSERT OR IGNORE INTO "lr_event" (event_id, device_id, device_seq)
    VALUES (${placeholders(n)})
  `).run('e', 'd', 1);
}
