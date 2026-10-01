// UT-GATE-090~097 — check:sql-typed(tsgo 타입 기반 수신자 판정) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-sql-typed.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-sql-typed');
const VIOL = path.join(FIX, 'violations');

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

const keys = (res) => res.json.violations.map((v) => `${v.line}:${v.rule}`);

/** clean fixture 복사본에 ok.ts 대신 src를 놓고 실행한다(tsgo 프로젝트 = 복사본 전체). */
function withSource(src, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-typed-'));
  try {
    cpSync(path.join(FIX, 'clean'), dir, { recursive: true });
    unlinkSync(path.join(dir, 'services/a/src/ok.ts'));
    writeFileSync(path.join(dir, 'services/a/src/t.ts'), src);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HEAD =
  "import { DatabaseSync } from 'node:sqlite';\ninterface SqlitePort { prepare(sql: string): unknown; exec(sql: string): void }\n";

test('UT-GATE-090 check:sql-typed selftest(clean 0·violations 1 + 기대 집합 일치·빈 root 2·없는 root 2)가 통과한다 [NFR-SEC-016]', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:sql-typed'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(VIOL);
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(VIOL), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-091 db["prepare"](x)·db.prepare.call(db, x)·bind 별칭은 수신자 타입으로 탐지한다 [NFR-SEC-016]', () => {
  const src = `${HEAD}export function f(db: DatabaseSync, x: string) {
  db['prepare'](\`SELECT \${x}\`);
  db.prepare.call(db, \`SELECT \${x}\`);
  db.prepare.apply(db, [\`SELECT \${x}\`]);
  const p = db.prepare.bind(db);
  p(\`SELECT \${x}\`);
}
`;
  withSource(src, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    const k = keys(res);
    assert.ok(k.includes('4:sql/template-interp'), `element access: ${k}`);
    assert.ok(k.includes('5:sql/template-interp'), `.call: ${k}`);
    assert.ok(k.includes('6:sql/dynamic-arg'), `.apply (array literal argument is not provable): ${k}`);
    assert.ok(k.includes('8:sql/template-interp'), `.bind alias: ${k}`);
  });
});

test('UT-GATE-092 SqlitePort 인터페이스 수신자(prepare·exec)를 탐지하고 설정 밖 타입은 수신자가 아니다 [NFR-SEC-016]', () => {
  const src = `${HEAD}type Other = { prepare(sql: string): unknown };
export function f(port: SqlitePort, other: Other, x: string) {
  port.prepare(\`SELECT \${x}\`);
  port.exec('DELETE FROM t WHERE id = ' + x);
  other.prepare(\`SELECT \${x}\`);
}
`;
  withSource(src, (dir) => {
    assert.deepEqual(keys(run(dir)), ['5:sql/template-interp', '6:sql/concat']);
  });
});

test('UT-GATE-093 RegExp#exec와 SQL 무관 prepare/exec 이름은 타입으로 구조적 배제한다 [NFR-SEC-016]', () => {
  const src = `${HEAD}const RE = /(\\d+)/;
class Unrelated { exec(s: string) { return s; } prepare(s: string) { return s; } }
export function f(line: string, u: Unrelated, x: string) {
  RE.exec(line);
  /(\\d+)/.exec(line);
  u.exec(x);
  u.prepare(\`\${x}\`);
}
`;
  withSource(src, (dir) => assert.equal(run(dir).status, 0));
});

test('UT-GATE-094 `+`·`.concat` 연결은 sql/concat이고 줄 번호는 인자 식이 시작하는 줄이다(감사 A.2-4) [NFR-SEC-016]', () => {
  const src = `${HEAD}export function f(db: DatabaseSync, id: string, col: string) {
  db.exec("DELETE FROM t WHERE id = '" + id + "'");
  db.prepare("SELECT * FROM t WHERE id = ".concat(id));
  db.prepare("SELECT " +
    col +
    " FROM t");
  db.prepare('a' + 'b');
}
`;
  withSource(src, (dir) => {
    assert.deepEqual(keys(run(dir)), ['4:sql/concat', '5:sql/concat', '6:sql/concat']);
  });
});

test('UT-GATE-095 const 템플릿 오염·동적 인자·삼항·사유 있는 sql-ok 면제의 분류가 check:sql과 같은 sql/* 규칙 ID다 [NFR-SEC-016]', () => {
  const src = `${HEAD}const Q = 'SELECT 1';
export function f(db: DatabaseSync, c: string, s: string, asc: boolean) {
  const q = \`SELECT \${c}\`;
  db.prepare(q);
  db.prepare(s);
  db.prepare(Q);
  db.prepare(asc ? 'SELECT 1 ORDER BY 1 ASC' : 'SELECT 1 ORDER BY 1 DESC');
  // sql-ok: 러너 — 모듈 상수만 전달
  db.exec(s);
  // sql-ok:
  db.exec(s);
}
`;
  withSource(src, (dir) => {
    const res = run(dir);
    assert.deepEqual(keys(res), ['5:sql/tainted-var', '7:sql/dynamic-arg', '13:sql/dynamic-arg']);
    assert.ok(res.json.violations.every((v) => v.rule.startsWith('sql/')));
  });
});

test('UT-GATE-096 tsconfig가 없으면 exit 2(engine/tsgo)다 [NFR-SEC-016]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-typed-'));
  try {
    cpSync(VIOL, dir, { recursive: true });
    unlinkSync(path.join(dir, 'tsconfig.json'));
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/tsgo: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-GATE-097 프로젝트 파일이 0개면 exit 2이고 sql.json 오류도 exit 2다 [NFR-SEC-016]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-typed-'));
  try {
    cpSync(path.join(FIX, 'clean'), dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { types: [], noEmit: true }, include: ['nothing'] }),
    );
    const none = run(dir);
    assert.equal(none.status, 2);
    assert.match(none.json.error, /^engine\/tsgo: /);
    const missingCfg = run(path.join(FIX, 'clean'), '--config', path.join(dir, 'absent.json'));
    assert.equal(missingCfg.status, 2);
    assert.match(missingCfg.json.error, /^engine\/config: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
