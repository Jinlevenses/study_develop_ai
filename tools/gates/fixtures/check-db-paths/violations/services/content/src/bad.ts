import type { DatabaseSync } from 'node:sqlite';

export const FOREIGN = 'learning.db'; // EXPECT[db/foreign-path]
export const WAL = (dir: string) => `${dir}/ops.db-wal`; // EXPECT[db/foreign-path]
export const SHM = 'insight.db-shm'; // EXPECT[db/foreign-path]
export const CACHE = '/data/ai-cache.db'; // EXPECT[db/foreign-path]
export const OWN = 'content.db';

export function attach(db: DatabaseSync, p: string) {
  db.exec('ATTACH DATABASE ? AS other'); // EXPECT[db/attach]
  db.exec("DETACH 'other'"); // EXPECT[db/attach]
  db.exec(`ATTACH DATABASE ${p} AS x`); // EXPECT[db/attach]
  db.exec("attach database '/tmp/x.db' as y"); // EXPECT[db/attach]
}
