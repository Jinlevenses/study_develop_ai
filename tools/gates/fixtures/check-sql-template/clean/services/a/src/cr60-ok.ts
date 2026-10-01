import type { DatabaseSync } from 'node:sqlite';
import { ident } from '@fathom/shared-kernel/sql';

const COLS = ['id', 'due'];
declare function placeholders(n: number): string;
declare function sqlInt(n: number): string;

export function ok(db: DatabaseSync, table: string, n: number) {
  db.exec('BEGIN IMMEDIATE');
  db.prepare('SELECT id FROM cards WHERE title LIKE ?').all('%x%'); // LIKE는 content 밖이면 허용
  db.prepare(`SELECT * FROM ${ident(table)} WHERE id IN (${placeholders(n)}) LIMIT ${sqlInt(n)}`).all();
  db.exec('SELECT ' + 'id FROM cards'); // 리터럴 + 리터럴
  // sql-ok: 테스트 전용 진단 쿼리 — 사유가 있으면 면제
  db.exec('PRAGMA user_version');
  // PRAGMA 와 INSERT INTO outbox 는 주석 안에서는 무시한다
  return COLS;
}
