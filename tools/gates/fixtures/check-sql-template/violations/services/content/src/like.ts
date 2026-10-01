import type { DatabaseSync } from 'node:sqlite';

export function find(db: DatabaseSync) {
  return db.prepare('SELECT id FROM ct_concept WHERE title LIKE ?').all('%x%'); // EXPECT[sql/like]
}
export function ok(db: DatabaseSync) {
  return db.prepare('SELECT id FROM ct_search_doc WHERE ct_search_doc MATCH ?').all('x');
}
