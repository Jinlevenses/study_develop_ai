import { DatabaseSync } from "node:sqlite";

export function bracket(db: DatabaseSync, x: string) {
  return db["prepare"](`SELECT ${x}`); // EVADES[sql/template-interp] bracket property access
}
export function bound(db: DatabaseSync, x: string) {
  const p = db.prepare.bind(db);
  return p(`SELECT ${x}`); // EVADES[sql/template-interp] method aliased/bound before the call
}
export function called(db: DatabaseSync, x: string) {
  return db.prepare.call(db, `SELECT ${x}`); // EVADES[sql/template-interp] Function.prototype.call
}
export function tagged(db: DatabaseSync, x: string) {
  return db.prepare(String.raw`SELECT ${x}`); // DETECTS[sql/dynamic-arg] tagged template
}
export function ternary(db: DatabaseSync, asc: boolean) {
  return db.prepare(asc ? "SELECT 1 ORDER BY 1 ASC" : "SELECT 1 ORDER BY 1 DESC"); // SAFE: must not be flagged
}
