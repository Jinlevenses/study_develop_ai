import { DatabaseSync } from 'node:sqlite';

interface SqlitePort {
  prepare(sql: string): unknown;
  exec(sql: string): void;
}
type PortAlias = { prepare(sql: string): unknown };

export function bad(db: DatabaseSync, port: SqlitePort, alias: PortAlias, x: string, col: string, sql: string) {
  db['prepare'](`SELECT ${x}`); // EXPECT[sql/template-interp]
  db.prepare.call(db, `SELECT ${x}`); // EXPECT[sql/template-interp]
  port.prepare(`SELECT ${x}`); // EXPECT[sql/template-interp]
  alias.prepare(`SELECT ${x}`); // 대조군: PortAlias는 receivers.types 밖이라 SQL 수신자가 아니다(설정 기준 판정)
  db.exec("DELETE FROM t WHERE id = '" + x + "'"); // EXPECT[sql/concat]
  db.prepare("SELECT * FROM t WHERE id = ".concat(x)); // EXPECT[sql/concat]
  db.prepare("SELECT " + // EXPECT[sql/concat]
    col +
    " FROM t");
  db.prepare(sql); // EXPECT[sql/dynamic-arg]
  const q = `SELECT ${col}`; // EXPECT[sql/tainted-var]
  db.prepare(q);
  // sql-ok:
  db.exec(sql); // EXPECT[sql/dynamic-arg]
}
