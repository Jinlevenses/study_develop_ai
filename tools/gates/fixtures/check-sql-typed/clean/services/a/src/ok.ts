import { DatabaseSync } from 'node:sqlite';

interface SqlitePort {
  prepare(sql: string): unknown;
  exec(sql: string): void;
}

const RE = /(\d+)/;
const Q = 'SELECT 1';

export function ok(db: DatabaseSync, port: SqlitePort, line: string, asc: boolean) {
  db.prepare('SELECT 1');
  db.exec(`CREATE TABLE t (id TEXT)`);
  db.prepare(Q);
  port.prepare(asc ? 'SELECT 1 ORDER BY 1 ASC' : 'SELECT 1 ORDER BY 1 DESC');
  port.exec('SELECT ' + 'x'.concat('y'));
  // RegExp#exec 는 SQL 수신자가 아니다(타입으로 구조적 배제)
  RE.exec(line);
  /(\d+)/.exec(line);
  // sql-ok: 마이그레이션 러너 — 호출자는 모듈 상수만 넘긴다
  db.exec(line);
}
