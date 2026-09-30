import assert from 'node:assert/strict';
import { checkSql } from './sql-tokenizer.mjs';
const ok = [
  'SELECT 1',
  "SELECT 'attach' AS w, 'pragma' AS p",
  'SELECT "attach" FROM t',
  'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<5) SELECT * FROM c',
  'CREATE TABLE t(a INTEGER, b TEXT); INSERT INTO t VALUES (1,\'x\'); UPDATE t SET a=2; DELETE FROM t; DROP TABLE t',
  'CREATE UNIQUE INDEX i ON t(a); CREATE VIEW v AS SELECT 1; CREATE TEMP TABLE z(a)',
  'SELECT a, row_number() OVER (PARTITION BY b ORDER BY a) FROM t -- comment ATTACH\n',
  '/* PRAGMA x; */ SELECT 1',
  'PRAGMA table_info(t)', "PRAGMA table_info('t')",
  'SELECT * FROM pragma_table_info(\'t\')',
];
const bad = [
  "ATTACH DATABASE '/tmp/x.db' AS x", "aTtAcH database 'x' as y", "SELECT 1; ATTACH 'a' AS b", 'DETACH DATABASE x',
  'PRAGMA journal_mode=WAL', 'PRAGMA writable_schema=1', 'PRAGMA table_info(t) ; PRAGMA foo', "PRAGMA table_info = 1",
  "SELECT load_extension('/x.so')", 'SELECT LOAD_EXTENSION ( 1 )', "VACUUM INTO '/tmp/v.db'", 'VACUUM',
  'SELECT 1;\0ATTACH \'a\' AS b', "SELECT readfile('/etc/passwd')", "SELECT '/etc/passwd'", "SELECT 'C:\\Windows\\x'", "SELECT 'a.db'",
  'CREATE VIRTUAL TABLE t USING fts5(a)', 'CREATE TRIGGER x AFTER INSERT ON t BEGIN SELECT 1; END', 'EXPLAIN SELECT 1', 'BEGIN', 'ALTER TABLE t ADD c',
  'SELECT :a', 'SELECT ?', 'SELECT [ATTACH]; ATTACH x', 'SELECT 1 /* x */ ; /**/ PRAGMA page_size',
  Array.from({ length: 21 }, () => 'SELECT 1').join(';'), '', '   ;  ', "SELECT 'unterminated",
  'DROP TRIGGER t', 'REINDEX', 'SELECT fts3_tokenizer(1)', 'SELECT "load_extension"(1)',
];
let f = 0;
for (const s of ok) { try { checkSql(s); } catch (e) { console.log('FALSE POSITIVE:', JSON.stringify(s), e.message); f++; } }
for (const s of bad) { try { checkSql(s); console.log('FALSE NEGATIVE:', JSON.stringify(s)); f++; } catch (e) { assert.equal(e.code, 'ERR_SQL_REJECTED'); } }
console.log(JSON.stringify({ ok: ok.length, bad: bad.length, failures: f }));
process.exit(f ? 1 : 0);
