// UT-GATE-151~159 — lint:hooks(db-hooks.ts ↔ 마이그레이션 DDL, DR-020) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseDdl, parseHooks, stripSqlComments } from '../check-hooks.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-hooks.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-hooks');
const HOOKS = 'packages/contracts/src/db-hooks.ts';
const LEDGER_SQL = 'services/learning/migrations/ledger/0001_ledger_core.sql';

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

const EXT = "ext TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),\n  ext_v INTEGER NOT NULL DEFAULT 1";
const nameHook = (table, columns, file = LEDGER_SQL) =>
  `{ hook: 'h', table: '${table}', columns: [${columns.map((c) => `'${c}'`).join(', ')}], file: '${file}' }`;

/** db-hooks.ts 본문 생성. */
function hooksTs({ name = [], ext = [] } = {}) {
  return `export const DB_NAME_HOOKS = [${name.join(',\n')}] as const;
export const DB_EXT_HOOKS = [{ hook: 'g', tables: ['t'], keys: ['k'], deferred: 'DEF-01' }] as const;
export const DB_EXT_TABLES = [${ext.map(([db, t]) => `{ db: '${db}', table: '${t}' }`).join(',\n')}] as const;
`;
}

function withRepo(files, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-hooks-'));
  try {
    for (const rel of ['services/a/src', 'packages/contracts/src']) {
      mkdirSync(path.join(dir, rel), { recursive: true });
    }
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rulesOf = (res) => res.json.violations.map((v) => `${v.rule}`).sort();

test('UT-GATE-151 lint:hooks selftest가 통과하고 위반 fixture 5규칙이 기대 집합과 일치한다 [DR-020]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'lint:hooks'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const seen = new Set(viol.json.violations.map((v) => v.rule));
  for (const rule of [
    'hooks/file-missing',
    'hooks/table-missing',
    'hooks/name-missing',
    'hooks/ext-missing',
    'hooks/ext-shape',
  ]) {
    assert.ok(seen.has(rule), rule);
  }
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-152 이름 훅의 열 누락은 열마다 1건(hooks/name-missing)이고 진단 줄은 CREATE TABLE 줄이다 [DR-020]', () => {
  const files = {
    [HOOKS]: hooksTs({ name: [nameHook('t_a', ['id', 'gone1', 'gone2'])] }),
    [LEDGER_SQL]: `\n\nCREATE TABLE t_a (\n  id TEXT PRIMARY KEY\n) STRICT;\n`,
  };
  withRepo(files, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(rulesOf(res), ['hooks/name-missing'], '같은 (file,line,rule)은 보고 시 병합');
    assert.deepEqual(
      res.json.violations.map((v) => `${v.file}:${v.line}`),
      [`${LEDGER_SQL}:3`],
    );
  });
  withRepo({ ...files, [HOOKS]: hooksTs({ name: [nameHook('t_a', ['id'])] }) }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
});

test('UT-GATE-153 이름 훅의 테이블이 그 file에 없으면 hooks/table-missing, file이 없으면 hooks/file-missing이다 [DR-020]', () => {
  withRepo(
    { [HOOKS]: hooksTs({ name: [nameHook('t_zzz', ['id'])] }), [LEDGER_SQL]: 'CREATE TABLE t_a (id TEXT) STRICT;\n' },
    (dir) => {
      const res = run(dir);
      assert.deepEqual(
        res.json.violations.map((v) => `${v.file}:${v.line}:${v.rule}`),
        [`${LEDGER_SQL}:1:hooks/table-missing`],
      );
    },
  );
  withRepo(
    {
      [HOOKS]: hooksTs({ name: [nameHook('t_a', ['id'], 'services/learning/migrations/ledger/9999_gone.sql')] }),
      [LEDGER_SQL]: 'CREATE TABLE t_a (id TEXT) STRICT;\n',
    },
    (dir) => {
      const res = run(dir);
      assert.deepEqual(
        res.json.violations.map((v) => `${v.file}:${v.rule}`),
        [`${HOOKS}:hooks/file-missing`],
      );
    },
  );
});

test('UT-GATE-154 ALTER TABLE … ADD COLUMN(같은 서비스 마이그레이션의 다른 파일)이 열로 반영된다 [DR-020]', () => {
  withRepo(
    {
      [HOOKS]: hooksTs({ name: [nameHook('t_a', ['id', 'late'])], ext: [] }),
      [LEDGER_SQL]: 'CREATE TABLE t_a (id TEXT) STRICT;\n',
      'services/learning/migrations/ledger/0002_alter.sql': '-- 추가 열\nALTER TABLE t_a ADD COLUMN late TEXT;\n',
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
  // 다른 DB 디렉터리의 ALTER 는 반영되지 않는다
  withRepo(
    {
      [HOOKS]: hooksTs({ name: [nameHook('t_a', ['id', 'late'])] }),
      [LEDGER_SQL]: 'CREATE TABLE t_a (id TEXT) STRICT;\n',
      'services/content/migrations/catalog/0002_alter.sql': 'ALTER TABLE t_a ADD COLUMN late TEXT;\n',
    },
    (dir) => assert.deepEqual(rulesOf(run(dir)), ['hooks/name-missing']),
  );
  const ddl = parseDdl(
    'CREATE TABLE IF NOT EXISTS "x" (a INT, "b" TEXT, PRIMARY KEY (a), CONSTRAINT c CHECK (a > 0), UNIQUE (b));\nALTER TABLE x ADD d TEXT DEFAULT \'1\';',
  );
  assert.deepEqual([...ddl.tables.get('x').cols.keys()], ['a', 'b']);
  assert.equal(ddl.tables.get('x').constraints.length, 3);
  assert.deepEqual(
    ddl.alters.map((a) => `${a.table}.${a.col}`),
    ['x.d'],
  );
});

test('UT-GATE-155 ext 형태 — DEFAULT 누락·json_valid 누락·테이블 수준 CHECK·컬럼 수준 CHECK를 각각 판정한다 [DR-020]', () => {
  const ext = [['learning.db', 't_e']];
  const hooks = hooksTs({ ext });
  const sql = (body) => ({
    [HOOKS]: hooks,
    [LEDGER_SQL]: `CREATE TABLE t_e (\n  id TEXT PRIMARY KEY,\n  ${body}\n) STRICT;\n`,
  });
  const shapes = (body) => withRepo(sql(body), (dir) => rulesOf(run(dir)));
  assert.deepEqual(shapes(EXT), []);
  assert.deepEqual(
    shapes(`ext TEXT NOT NULL DEFAULT '{}',\n  ext_v INTEGER NOT NULL DEFAULT 1,\n  CHECK (json_valid(ext))`),
    [],
    '테이블 수준 CHECK',
  );
  assert.deepEqual(
    shapes(
      `ext TEXT NOT NULL DEFAULT '{}',\n  ext_v INTEGER NOT NULL DEFAULT 1,\n  CONSTRAINT ext_json CHECK (json_valid(ext))`,
    ),
    [],
    '이름 있는 CONSTRAINT',
  );
  assert.deepEqual(
    shapes('ext TEXT NOT NULL CHECK (json_valid(ext)),\n  ext_v INTEGER NOT NULL DEFAULT 1'),
    ['hooks/ext-shape'],
    'DEFAULT 누락',
  );
  assert.deepEqual(
    shapes("ext TEXT NOT NULL DEFAULT '{}',\n  ext_v INTEGER NOT NULL DEFAULT 1"),
    ['hooks/ext-shape'],
    'json_valid 누락',
  );
  assert.deepEqual(
    shapes("ext TEXT DEFAULT '{}' CHECK (json_valid(ext)),\n  ext_v INTEGER NOT NULL DEFAULT 1"),
    ['hooks/ext-shape'],
    'NOT NULL 누락',
  );
  assert.deepEqual(
    shapes("ext  text  not  null  default  '{}'  check (JSON_VALID(ext)),\n  ext_v integer not null default 1"),
    [],
    '공백·대소문자 정규화',
  );
});

test('UT-GATE-156 ext_v 형태 — INTEGER NOT NULL DEFAULT 1 이 아니면 hooks/ext-shape, 열이 없으면 hooks/ext-missing이다 [DR-020]', () => {
  const hooks = hooksTs({ ext: [['learning.db', 't_e']] });
  const sql = (body) => ({ [HOOKS]: hooks, [LEDGER_SQL]: `CREATE TABLE t_e (\n  id TEXT,\n  ${body}\n) STRICT;\n` });
  const base = "ext TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ext))";
  withRepo(sql(`${base},\n  ext_v INTEGER NOT NULL DEFAULT 0`), (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['hooks/ext-shape']),
  );
  withRepo(sql(`${base},\n  ext_v TEXT NOT NULL DEFAULT 1`), (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['hooks/ext-shape']),
  );
  withRepo(sql(base), (dir) => assert.deepEqual(rulesOf(run(dir)), ['hooks/ext-missing']));
  withRepo(sql('ext_v INTEGER NOT NULL DEFAULT 1'), (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['hooks/ext-missing']),
  );
});

test('UT-GATE-157 DB → 디렉터리 고정 표(insight → migrations-insight, ai-cache → migrations-cache)와 공통 infra-migrations를 따른다 [DR-020]', () => {
  const ok = `CREATE TABLE t_e (id TEXT, ${EXT}) STRICT;\n`;
  const cases = [
    ['insight.db', 'services/learning/migrations-insight/0001.sql', true],
    ['insight.db', 'services/learning/migrations/0001.sql', false],
    ['ai-cache.db', 'services/ai-gateway/migrations-cache/0001.sql', true],
    ['ai-cache.db', 'services/ai-gateway/migrations/0001.sql', false],
    ['ai.db', 'services/ai-gateway/migrations/0001.sql', true],
    ['ops.db', 'services/ops/migrations/0001.sql', true],
    ['content.db', 'services/content/migrations/0001.sql', true],
    ['learning.db', 'packages/shared-kernel/infra-migrations/0001.sql', true],
  ];
  for (const [db, sqlPath, expectOk] of cases) {
    withRepo(
      {
        [HOOKS]: hooksTs({ ext: [[db, 't_e']] }),
        [sqlPath]: ok,
        'services/learning/migrations/ledger/0000_pad.sql': 'SELECT 1;\n',
      },
      (dir) => {
        const res = run(dir);
        assert.equal(res.status, expectOk ? 0 : 1, `${db} @ ${sqlPath}: ${JSON.stringify(res.json.violations)}`);
        if (!expectOk) {
          assert.deepEqual(rulesOf(res), ['hooks/table-missing']);
        }
      },
    );
  }
});

test('UT-GATE-158 db-hooks.ts에 식별자 참조·spread·호출·템플릿 보간이 있으면 exit 2(engine/input-missing)다 [DR-020]', () => {
  const literalOnlyFail = (ts) =>
    withRepo({ [HOOKS]: ts, [LEDGER_SQL]: 'CREATE TABLE t_a (id TEXT) STRICT;\n' }, (dir) => {
      const res = run(dir);
      assert.equal(res.status, 2, ts);
      assert.match(res.json.error, /^engine\/input-missing: .*literal-only/);
    });
  const base = (name) =>
    `export const DB_NAME_HOOKS = ${name} as const;\nexport const DB_EXT_HOOKS = [] as const;\nexport const DB_EXT_TABLES = [] as const;\n`;
  literalOnlyFail(base(`[{ hook: 'a', table: T, columns: [], file: 'x' }]`));
  literalOnlyFail(base(`[...OTHER]`));
  literalOnlyFail(base(`[{ hook: 'a', table: 't', columns: cols(), file: 'x' }]`));
  literalOnlyFail(base(`[{ hook: \`a-\${n}\`, table: 't', columns: [], file: 'x' }]`));
  literalOnlyFail(base('buildHooks()'));
  // 상수 누락도 exit 2
  withRepo({ [HOOKS]: 'export const DB_NAME_HOOKS = [] as const;\n', [LEDGER_SQL]: 'SELECT 1;\n' }, (dir) => {
    assert.equal(run(dir).status, 2);
  });
  // 정상: `as const satisfies readonly T[]` 와 `${}` 없는 템플릿은 리터럴로 본다
  const parsed = parseHooks(
    "export const DB_NAME_HOOKS = [{ hook: `a`, table: 't', columns: ['c'] as const, file: 'f' }] as const satisfies readonly X[];\nexport const DB_EXT_HOOKS = [] as const;\nexport const DB_EXT_TABLES = [{ db: 'content.db', table: 't' }] as const;\n",
  );
  assert.equal(parsed.nameHooks[0].table.v, 't');
  assert.equal(parsed.extTables[0].db, 'content.db');
});

test('UT-GATE-159 마이그레이션 .sql이 하나도 없으면 exit 2이고 db-hooks.ts가 없어도 exit 2다 [DR-020]', () => {
  withRepo({ [HOOKS]: hooksTs() }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: no migration \.sql files/);
  });
  withRepo({ [LEDGER_SQL]: 'SELECT 1;\n' }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: packages\/contracts\/src\/db-hooks\.ts not found/);
  });
  assert.equal(stripSqlComments("a -- c1\n/* c2\nc3 */ b 'x -- y'").replace(/\s+/g, ' ').trim(), "a b 'x -- y'");
});
