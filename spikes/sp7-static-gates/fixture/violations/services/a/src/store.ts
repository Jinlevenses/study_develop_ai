import { DatabaseSync } from "node:sqlite";
import { ident } from "@fathom/shared-kernel";

const INSERT_SQL = "INSERT INTO cards (id, due) VALUES (?, ?)";
const RE = /(\d+)-(\d+)/;

export function openStore(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, due INTEGER) STRICT`);
  db.exec("CREATE INDEX IF NOT EXISTS ix_due ON cards(due)");
  db.exec("DELETE " + "FROM cards WHERE 0"); // literal + literal is fine
}

export function insert(db: DatabaseSync, id: string, due: number): void {
  db.prepare(INSERT_SQL).run(id, due);
}

export function byId(db: DatabaseSync, id: string) {
  return db.prepare("SELECT * FROM cards WHERE id = ?").get(id);
}

export function named(db: DatabaseSync, id: string) {
  return db.prepare("SELECT * FROM cards WHERE id = :id").get({ id });
}

export function multiline(db: DatabaseSync, before: number) {
  return db
    .prepare(`
      SELECT id
      FROM cards
      WHERE due < ?
      ORDER BY due
    `)
    .all(before);
}

export function count(db: DatabaseSync, table: string) {
  // sanctioned: identifiers only via ident()
  return db.prepare(`SELECT count(*) AS n FROM ${ident(table)}`).get();
}

export function runOnce(db: DatabaseSync, sql: string) {
  // sql-ok: migration runner, callers pass module-level constants only
  // biome-ignore lint/plugin: migration runner (same reason as sql-ok)
  return db.exec(sql);
}

// not SQL: RegExp#exec must not be flagged
export function parse(line: string) {
  const a = RE.exec(line);
  const b = /(\d+)/.exec(line);
  return [a, b];
}

// db.prepare(`SELECT ${notReal}`)  <- inside a comment
export const DOC = "db.prepare(`SELECT ${x}`) inside a string literal";

export const LOCAL = 2;
