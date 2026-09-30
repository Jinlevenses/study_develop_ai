import { DatabaseSync } from "node:sqlite";

export function tpl(db: DatabaseSync, id: string) {
  return db.prepare(`SELECT * FROM cards WHERE id = '${id}'`).get(); // EXPECT[sql/template-interp]
}
export function concat(db: DatabaseSync, id: string) {
  db.exec("DELETE FROM cards WHERE id = '" + id + "'"); // EXPECT[sql/concat]
}
export function concatMultiline(db: DatabaseSync, col: string) {
  return db.prepare("SELECT " + // EXPECT[sql/concat]
    col +
    " FROM cards").all();
}
export function dotConcat(db: DatabaseSync, id: string) {
  return db.prepare("SELECT * FROM cards WHERE id = ".concat(id)).get(); // EXPECT[sql/concat]
}
export function taintedVar(db: DatabaseSync, col: string) {
  const q = `SELECT ${col} FROM cards`; // EXPECT[sql/tainted-var]
  return db.prepare(q).all();
}
export function builder(db: DatabaseSync, id: string) {
  let q = "SELECT * FROM cards WHERE 1 = 1";
  q += " AND id = '" + id + "'"; // EXPECT[sql/tainted-var]
  return db.prepare(q).all();
}
export function joined(db: DatabaseSync, cols: string[]) {
  return db.prepare(["SELECT", cols.join(","), "FROM cards"].join(" ")).all(); // EXPECT[sql/dynamic-arg]
}
export function unresolved(db: DatabaseSync, sql: string) {
  return db.prepare(sql).all(); // EXPECT[sql/dynamic-arg]
}
export function member(db: DatabaseSync, o: { sql: string }) {
  return db.exec(o.sql); // EXPECT[sql/dynamic-arg]
}
export function pragmaNoReason(db: DatabaseSync, sql: string) {
  // sql-ok:
  return db.exec(sql); // EXPECT[sql/dynamic-arg]
}
export function chained(db: DatabaseSync, id: string) {
  return db
    .prepare(` // EXPECT[sql/template-interp]
      SELECT *
      FROM cards
      WHERE id = ${id}
    `)
    .get();
}
