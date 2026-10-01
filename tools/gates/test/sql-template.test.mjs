// UT-GATE-080~089 — check:sql(SP-7 이식 + CR-60 4규칙) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFile, loadSqlConfig, normalizeSql, sqlLiterals } from '../check-sql-template.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';
import { tokenize } from '../lib/lex.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-sql-template.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-sql-template');
const cfg = loadSqlConfig();

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const rulesOf = (src, rel = 'services/a/src/x.ts') => checkFile(rel, src, cfg).map((v) => v.rule);
const dbPrepare = (arg) => `export const f = (db) => db.prepare(${arg});`;

test('UT-GATE-080 check:sql selftest가 통과하고 SP-7 11건(템플릿·연결·오염 변수·동적 인자)이 기대 집합과 일치한다 [NFR-SEC-016]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:sql'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const sp7 = viol.json.violations.filter((v) => v.file === 'services/a/src/store-bad.ts');
  assert.equal(sp7.length, 11, 'SP-7 store-bad.ts 11건');
  const byRule = (rule) => sp7.filter((v) => v.rule === rule).length;
  assert.deepEqual(
    ['sql/template-interp', 'sql/concat', 'sql/tainted-var', 'sql/dynamic-arg'].map(byRule),
    [2, 3, 2, 4],
  );
});

test('UT-GATE-081 clean 대조군(RegExp#exec·리터럴+리터럴·${ident}·${placeholders}·${sqlInt}·*.sql.ts 상수)은 위반이 아니다 [NFR-SEC-016]', () => {
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
  assert.deepEqual(rulesOf("const RE = /a/; RE.exec(s); /b/.exec(s); regexp.exec(s); const m = pattern.exec(s);"), []);
  assert.deepEqual(rulesOf(dbPrepare("'SELECT ' + 'id FROM t'")), []);
  assert.deepEqual(rulesOf(dbPrepare('`SELECT * FROM ${ident(t)} WHERE id IN (${placeholders(n)}) LIMIT ${sqlInt(k)}`')), []);
  assert.deepEqual(rulesOf(dbPrepare('`SELECT * FROM ${sqlIdent(t)}`')), []);
  assert.deepEqual(rulesOf(dbPrepare("asc ? 'SELECT 1 ORDER BY 1 ASC' : 'SELECT 1 ORDER BY 1 DESC'")), []);
  assert.deepEqual(rulesOf("import { INSERT_KU } from './x.sql.ts';\nexport const f = (db) => db.prepare(INSERT_KU);"), []);
  assert.deepEqual(rulesOf("export const f = (db) => db.exec('x'.concat('y'));"), []);
  // 비 UPPER_SNAKE import 이름은 증명 불가
  assert.deepEqual(rulesOf("import { sql } from './x.ts';\nexport const f = (db) => db.prepare(sql);"), ['sql/dynamic-arg']);
});

test('UT-GATE-082 위반 형태 4규칙(template-interp·concat·tainted-var·dynamic-arg)이 토큰 줄 번호와 함께 분류된다 [NFR-SEC-016]', () => {
  assert.deepEqual(rulesOf(dbPrepare('`SELECT ${x}`')), ['sql/template-interp']);
  assert.deepEqual(rulesOf(dbPrepare("'a' + x")), ['sql/concat']);
  assert.deepEqual(rulesOf(dbPrepare("'a'.concat(x)")), ['sql/concat']);
  assert.deepEqual(rulesOf("const q = `SELECT ${c}`;\nexport const f = (db) => db.prepare(q);"), ['sql/tainted-var']);
  assert.deepEqual(rulesOf("let q = 'a';\nq += ' b' + x;\nexport const f = (db) => db.exec(q);"), ['sql/tainted-var']);
  assert.deepEqual(rulesOf(dbPrepare('sql')), ['sql/dynamic-arg']);
  assert.deepEqual(rulesOf(dbPrepare('o.sql')), ['sql/dynamic-arg']);
  assert.deepEqual(rulesOf(dbPrepare('parts.join(" ")')), ['sql/dynamic-arg']);
  const v = checkFile('services/a/src/x.ts', "\n\nexport const f = (db) => db.exec('a' +\n  x);", cfg);
  assert.equal(v[0].line, 3, 'concat 줄 = 인자 식이 시작하는 줄');
});

test('UT-GATE-083 `// sql-ok: 사유`·`// biome-ignore lint/plugin: 사유`는 같은 줄·윗줄 면제이고 사유가 없으면 무효다 [NFR-SEC-016]', () => {
  assert.deepEqual(rulesOf('// sql-ok: 마이그레이션 러너\nexport const f = (db, s) => db.exec(s);'), []);
  assert.deepEqual(rulesOf('export const f = (db, s) => db.exec(s); // sql-ok: 상수만 전달'), []);
  assert.deepEqual(rulesOf('// biome-ignore lint/plugin: 같은 사유\nexport const f = (db, s) => db.exec(s);'), []);
  assert.deepEqual(rulesOf('// sql-ok:\nexport const f = (db, s) => db.exec(s);'), ['sql/dynamic-arg']);
  assert.deepEqual(rulesOf('// sql-ok:   \nexport const f = (db, s) => db.exec(s);'), ['sql/dynamic-arg']);
  assert.deepEqual(rulesOf('// sql-ok: 사유\n\nexport const f = (db, s) => db.exec(s);'), ['sql/dynamic-arg'], '두 줄 위는 무효');
  assert.deepEqual(rulesOf("// sql-ok: pragma 점검\ndb.exec('PRAGMA user_version');"), []);
});

test('UT-GATE-084 sql/pragma — PRAGMA 리터럴은 pragma_allow(shared-kernel/sqlite) 밖에서 위반이다 [NFR-SEC-016]', () => {
  const src = "db.exec('PRAGMA journal_mode = WAL');";
  assert.deepEqual(rulesOf(src, 'services/a/src/x.ts'), ['sql/pragma']);
  assert.deepEqual(rulesOf(src, 'packages/shared-kernel/src/sqlite/open.ts'), []);
  assert.deepEqual(rulesOf("db.exec('  pragma   foreign_keys = ON');", 'services/a/src/x.ts'), ['sql/pragma']);
  assert.deepEqual(rulesOf("const s = 'not a PRAGMA statement';", 'services/a/src/x.ts'), []);
  assert.deepEqual(rulesOf("db.exec('PRAGMA ' + 'user_version');", 'services/a/src/x.ts'), ['sql/pragma']);
});

test('UT-GATE-085 sql/deferred-begin — BEGIN IMMEDIATE는 통과, BEGIN·BEGIN DEFERRED는 begin_allow 밖에서 위반이다 [NFR-SEC-016]', () => {
  assert.deepEqual(rulesOf("db.exec('BEGIN IMMEDIATE');"), []);
  assert.deepEqual(rulesOf("db.exec('BEGIN');"), ['sql/deferred-begin']);
  assert.deepEqual(rulesOf("db.exec('BEGIN TRANSACTION;');"), ['sql/deferred-begin']);
  assert.deepEqual(rulesOf("db.exec('begin deferred transaction');"), ['sql/deferred-begin']);
  assert.deepEqual(rulesOf("db.exec('BEGIN DEFERRED');", 'packages/shared-kernel/src/sqlite/tx.ts'), []);
  assert.deepEqual(rulesOf("const msg = 'BEGIN the lesson';"), []);
});

test('UT-GATE-086 sql/like — SELECT·WHERE 의 LIKE는 like_scope(services/content/src)에서만 위반이다 [NFR-SEC-016]', () => {
  const src = "db.prepare('SELECT id FROM ct_concept WHERE title LIKE ?');";
  assert.deepEqual(rulesOf(src, 'services/content/src/application/catalog/x.ts'), ['sql/like']);
  assert.deepEqual(rulesOf(src, 'services/learning/src/application/x.ts'), []);
  assert.deepEqual(rulesOf("db.prepare('UPDATE t SET note = ?');", 'services/content/src/x.ts'), []);
  assert.deepEqual(rulesOf("const t = 'I like this';", 'services/content/src/x.ts'), []);
});

test('UT-GATE-087 sql/outbox-insert — INSERT INTO outbox는 shared-kernel/eventing 안에서만 통과한다 [NFR-SEC-016]', () => {
  const src = "db.prepare('INSERT INTO outbox (event_id) VALUES (?)');";
  assert.deepEqual(rulesOf(src, 'services/learning/src/x.ts'), ['sql/outbox-insert']);
  assert.deepEqual(rulesOf(src, 'packages/shared-kernel/src/eventing/outbox.ts'), []);
  assert.deepEqual(rulesOf("db.prepare('INSERT OR IGNORE INTO \"outbox\" (event_id) VALUES (?)');"), ['sql/outbox-insert']);
  assert.deepEqual(rulesOf("db.prepare('SELECT * FROM outbox');"), []);
  assert.deepEqual(rulesOf("db.prepare('INSERT INTO outbox_archive (event_id) VALUES (?)');"), []);
});

test('UT-GATE-088 sqlLiterals는 문자열·템플릿·`+` 사슬을 모으고 normalizeSql은 공백 1칸·대문자로 정규화한다 [NFR-SEC-016]', () => {
  const lits = (src) => sqlLiterals(tokenize(src).tokens);
  const a = lits("db.exec('DELETE ' + 'FROM ' + `cards`);");
  assert.ok(a.some((l) => l.text === 'DELETE FROM cards'), '사슬을 이어 붙인다');
  assert.ok(a.some((l) => l.text === 'DELETE ') && a.some((l) => l.text === 'cards'), '각 조각도 포함');
  assert.deepEqual(lits('x(`a ${b} c`)').map((l) => l.text), ['a ? c'], '템플릿 보간은 ? 자리표시자');
  assert.deepEqual(lits("x('a' + y + 'b')").map((l) => l.text), ['a', 'b'], '리터럴이 아닌 항이 끼면 사슬이 아니다');
  assert.equal(normalizeSql('  select  *\n\tfrom   t  '), 'SELECT * FROM T');
  assert.equal(lits('\n\nx("q");')[0].line, 3);
});

test('UT-GATE-089 sql.json 부재·version 오류·필수 키 누락은 exit 2이고 srcs 0개·위반 있음은 각각 2·1이다 [NFR-SEC-016]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-sql-'));
  try {
    for (const rel of ['services/a/src', 'packages/contracts/src']) {
      mkdirSync(path.join(dir, rel), { recursive: true });
    }
    writeFileSync(path.join(dir, 'services/a/src/x.ts'), "export const f = (db, s) => db.exec(s);\n");
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(res.json.violations.map((v) => v.rule), ['sql/dynamic-arg']);
    const good = JSON.parse(JSON.stringify(cfg));
    writeFileSync(path.join(dir, 'v2.json'), JSON.stringify({ ...good, version: 2 }));
    const { ledger: _l, ...noLedger } = good;
    writeFileSync(path.join(dir, 'noledger.json'), JSON.stringify(noLedger));
    writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    for (const f of ['v2.json', 'noledger.json', 'broken.json', 'absent.json']) {
      const r = run(dir, '--config', path.join(dir, f));
      assert.equal(r.status, 2, f);
      assert.match(r.json.error, /^engine\/config: /);
    }
    rmSync(path.join(dir, 'services/a/src/x.ts'));
    const none = run(dir);
    assert.equal(none.status, 2);
    assert.match(none.json.error, /^engine\/no-files: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
