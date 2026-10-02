// UT-GATE-240~256 — T-01-01(S0 이월 흡수): 게이트 오탐 정정·허용표 가산(CR-69~72·76)·루트 설정 회귀.
// 각 게이트의 clean/violations fixture 선택 규칙은 STD-TST-11: `fixtures/<check>/{clean,violations}`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateImport } from '../check-boundaries.mjs';
import { checkFile as checkDbPaths } from '../check-db-paths.mjs';
import { loadNgConfig, checkSource as ngSource } from '../check-ng-g.mjs';
import { scanSource } from '../check-security-scan.mjs';
import { checkFile as checkSql, loadSqlConfig } from '../check-sql-template.mjs';
import { checkSource as typoSource } from '../check-typo-ko.mjs';
import { loadBoundaries } from '../lib/units.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const ROOT = path.join(GATES_DIR, '..', '..');
const FIX = (check) => path.join(GATES_DIR, 'fixtures', check);
const sqlCfg = loadSqlConfig();
const ngCfg = loadNgConfig();
const bnd = loadBoundaries();

function run(gate, root, ...args) {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, gate), '--root', root, '--json', ...args], {
    encoding: 'utf8',
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json, stderr: r.stderr };
}

function tmpdir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), `fathom-gates-${prefix}-`));
}

/** fixture clean 복사본에 files를 덧쓰고 fn(dir)을 실행한다. */
function withClean(check, files, fn) {
  const dir = tmpdir('s0');
  try {
    cpSync(path.join(FIX(check), 'clean'), dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const typedKeys = (res) => res.json.violations.map((v) => `${v.file}:${v.line}:${v.rule}`);
const SQL_A = "export const SELECT_ONE = 'SELECT 1';\nexport const SELECT_TWO = `SELECT 2`;\n";
const SRC = 'services/a/src/s0';

// ---- UT-GATE-240~243 check:sql-typed — import 별칭 해석(CO-06) ----
test('UT-GATE-240 sql-typed: import { X }로 들여온 다른 파일의 const SQL 상수는 증명 가능한 상수라 통과한다 [NFR-SEC-016]', () => {
  const files = {
    [`${SRC}/a.sql.ts`]: SQL_A,
    [`${SRC}/use.ts`]: `import { DatabaseSync } from 'node:sqlite';\nimport { SELECT_ONE } from './a.sql.js';\nexport const f = (db: DatabaseSync) => db.prepare(SELECT_ONE);\n`,
  };
  withClean('check-sql-typed', files, (dir) => {
    const res = run('check-sql-typed.mjs', dir);
    assert.equal(res.status, 0, JSON.stringify(res.json));
  });
  assert.equal(run('check-sql-typed.mjs', path.join(FIX('check-sql-typed'), 'clean')).status, 0, 'clean fixture');
});

test('UT-GATE-241 sql-typed: import { X as Y } 별칭도 원 선언까지 해석해 통과한다 [NFR-SEC-016]', () => {
  const files = {
    [`${SRC}/a.sql.ts`]: SQL_A,
    [`${SRC}/use.ts`]: `import { DatabaseSync } from 'node:sqlite';\nimport { SELECT_TWO as TWO } from './a.sql.js';\nexport const f = (db: DatabaseSync) => db.exec(TWO);\n`,
  };
  withClean('check-sql-typed', files, (dir) => {
    const res = run('check-sql-typed.mjs', dir);
    assert.equal(res.status, 0, JSON.stringify(res.json));
  });
});

test('UT-GATE-242 sql-typed: export { X } from 재수출 체인도 끝까지 해석해 통과한다 [NFR-SEC-016]', () => {
  const files = {
    [`${SRC}/a.sql.ts`]: SQL_A,
    [`${SRC}/b.sql.ts`]: "export { SELECT_ONE as MID_ONE } from './a.sql.js';\n",
    [`${SRC}/c.sql.ts`]: "export { MID_ONE as END_ONE } from './b.sql.js';\n",
    [`${SRC}/use.ts`]: `import { DatabaseSync } from 'node:sqlite';\nimport { END_ONE } from './c.sql.js';\nexport const f = (db: DatabaseSync) => db.prepare(END_ONE);\n`,
  };
  withClean('check-sql-typed', files, (dir) => {
    const res = run('check-sql-typed.mjs', dir);
    assert.equal(res.status, 0, JSON.stringify(res.json));
  });
});

test('UT-GATE-243 sql-typed: import된 let·보간 const는 여전히 sql/dynamic-arg·sql/tainted-var 위반이다(완화 0) [NFR-SEC-016]', () => {
  const files = {
    [`${SRC}/a.sql.ts`]:
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 검사 대상 소스 문자열(fixture) — 템플릿 보간 자체가 입력이다
      "export let MUTABLE_SQL = 'SELECT 1';\nconst col = 'id';\nexport const BUILT = `SELECT ${col}`;\n",
    [`${SRC}/use.ts`]: `import { DatabaseSync } from 'node:sqlite';\nimport { MUTABLE_SQL as Q, BUILT } from './a.sql.js';\nexport function f(db: DatabaseSync) {\n  db.prepare(Q);\n  db.prepare(BUILT);\n}\n`,
  };
  withClean('check-sql-typed', files, (dir) => {
    const res = run('check-sql-typed.mjs', dir);
    assert.equal(res.status, 1);
    const k = typedKeys(res);
    assert.ok(k.includes(`${SRC}/use.ts:4:sql/dynamic-arg`), k.join('\n'));
    assert.ok(
      k.some((x) => x.endsWith(':sql/tainted-var')),
      k.join('\n'),
    );
  });
  const viol = run('check-sql-typed.mjs', `${FIX('check-sql-typed')}/violations`);
  assert.ok(typedKeys(viol).includes('services/a/src/imported-let/use.ts:5:sql/dynamic-arg'));
});

// ---- UT-GATE-244~245 check:sql — contracts RegExp.exec 오탐(CR-70) ----
test('UT-GATE-244 check:sql: contracts/src의 PATTERNS[type].exec(key)는 sql/dynamic-arg를 내지 않고 서비스 파일의 같은 패턴은 위반이다 [NFR-SEC-016]', () => {
  const src =
    'const P: Record<string, { exec(s: string): unknown }> = {};\nexport const m = (t: string, k: string) => P[t]?.exec(k);\n';
  assert.deepEqual(
    checkSql('packages/contracts/src/ledger/types.ts', src, sqlCfg).map((v) => v.rule),
    [],
  );
  assert.deepEqual(
    checkSql('services/a/src/x.ts', src, sqlCfg).map((v) => v.rule),
    ['sql/dynamic-arg'],
  );
  // 면제는 sql/dynamic-arg 한정 — contracts에서도 보간·연결은 계속 잡는다.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 검사 대상 소스 문자열(fixture) — 템플릿 보간 자체가 입력이다
  const interp = 'export const f = (db: { prepare(s: string): unknown }, x: string) => db.prepare(`SELECT ${x}`);\n';
  assert.deepEqual(
    checkSql('packages/contracts/src/x.ts', interp, sqlCfg).map((v) => v.rule),
    ['sql/template-interp'],
  );
  assert.equal(run('check-sql-template.mjs', path.join(FIX('check-sql-template'), 'clean')).status, 0);
  const viol = run('check-sql-template.mjs', path.join(FIX('check-sql-template'), 'violations'));
  assert.ok(typedKeys(viol).includes('services/a/src/exec-key.ts:3:sql/dynamic-arg'));
});

test('UT-GATE-245 check:sql: dynamic_arg_exempt가 배열이 아니면 engine/config exit 2이고 키 누락은 빈 배열(하위 호환)이다 [NFR-SEC-016]', () => {
  const base = JSON.parse(readFileSync(path.join(GATES_DIR, 'config', 'sql.json'), 'utf8'));
  const dir = tmpdir('sqlcfg');
  try {
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ ...base, dynamic_arg_exempt: 'packages/contracts/src/**' }));
    const res = run('check-sql-template.mjs', path.join(FIX('check-sql-template'), 'clean'), '--config', bad);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/config: .*dynamic_arg_exempt must be a string array/);
    const { dynamic_arg_exempt: _drop, ...without } = base;
    const missing = path.join(dir, 'missing.json');
    writeFileSync(missing, JSON.stringify(without));
    assert.deepEqual(loadSqlConfig(missing).dynamic_arg_exempt, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- UT-GATE-246~247 pragma_allow · db_paths_exempt(CR-70·71) ----
test('UT-GATE-246 check:sql: maintenance.sql.ts의 PRAGMA는 통과하고 같은 디렉터리의 다른 파일은 sql/pragma 위반이다 [NFR-MAINT-002]', () => {
  const src = "export const Q = 'PRAGMA wal_checkpoint(TRUNCATE)';\n";
  assert.deepEqual(checkSql('packages/shared-kernel/src/service/maintenance.sql.ts', src, sqlCfg), []);
  assert.deepEqual(
    checkSql('packages/shared-kernel/src/service/other.ts', src, sqlCfg).map((v) => v.rule),
    ['sql/pragma'],
  );
  assert.equal(run('check-sql-template.mjs', path.join(FIX('check-sql-template'), 'clean')).status, 0);
});

test('UT-GATE-247 check:db-paths: 면제 3파일은 통과하고 다른 contracts 파일의 DB 파일명은 db/foreign-path 위반이다 [NFR-MAINT-002]', () => {
  const src = "export const D = ['ai.db', 'ops.db'];\n";
  for (const f of [
    'packages/contracts/src/db-hooks.ts',
    'packages/contracts/src/admin/epoch-manifest.ts',
    'packages/contracts/src/admin/admin-routes.ts',
  ]) {
    assert.deepEqual(sqlCfg.db_paths_exempt.includes(f), true, f);
  }
  assert.deepEqual(
    checkDbPaths('packages/contracts/src/other.ts', src, sqlCfg).map((v) => v.rule),
    ['db/foreign-path', 'db/foreign-path'],
  );
  assert.equal(run('check-db-paths.mjs', path.join(FIX('check-db-paths'), 'clean')).status, 0);
  const viol = run('check-db-paths.mjs', path.join(FIX('check-db-paths'), 'violations'));
  assert.ok(typedKeys(viol).includes('packages/contracts/src/other-contract.ts:2:db/foreign-path'));
  // 디렉터리 glob 금지: 면제 항목은 모두 파일 경로(**·* 없음)다.
  for (const f of sqlCfg.db_paths_exempt.filter((x) => x.startsWith('packages/contracts'))) {
    assert.doesNotMatch(f, /[*?]/, f);
  }
});

// ---- UT-GATE-248 boundaries — testkit preload child_process(CR-72) ----
test('UT-GATE-248 boundaries: packages/testkit/src/preload/x.mjs의 node:child_process는 통과하고 testkit의 다른 파일은 위반이다 [NFR-MAINT-001]', () => {
  const rules = (fromRel) =>
    evaluateImport({ fromRel, spec: 'node:child_process', kind: 'static', typeOnly: false, line: 1 }, bnd).map(
      (v) => v.rule,
    );
  assert.deepEqual(rules('packages/testkit/src/preload/x.mjs'), []);
  assert.deepEqual(rules('packages/testkit/src/other.ts'), ['boundary/builtin-restricted']);
  assert.deepEqual(rules('packages/testkit/src/preload-not/x.mjs'), ['boundary/builtin-restricted']);
  const clean = run('check-boundaries.mjs', path.join(FIX('check-boundaries'), 'clean'), '--engine=tokens');
  assert.equal(clean.status, 0, JSON.stringify(clean.json));
});

// ---- UT-GATE-249~250 deps — CR-69 ----
test('UT-GATE-249 deps: CR-69 가산 5종(react-is·@testing-library/dom·@types/react·@types/react-dom·@types/d3-force)과 vite의 (root) 단위가 통과한다 [NFR-MAINT-001]', () => {
  assert.equal(run('check-deps.mjs', path.join(FIX('check-deps'), 'clean')).status, 0);
  const cfg = JSON.parse(readFileSync(path.join(GATES_DIR, 'config', 'deps.json'), 'utf8'));
  const by = new Map(cfg.packages.map((p) => [p.name, p]));
  assert.deepEqual(by.get('react-is'), { name: 'react-is', version: '19.3.0', units: ['apps/web'] });
  assert.equal(by.get('@testing-library/dom').version, '10.4.2');
  assert.equal(by.get('@types/d3-force').version, '3.0.10');
  assert.deepEqual(by.get('@types/react').units, ['apps/web', 'packages/ui']);
  assert.ok(by.get('vite').units.includes('(root)') && by.get('vite').units.includes('packages/testkit'));
  for (const n of ['@testing-library/dom', '@types/react', '@types/react-dom', '@types/d3-force']) {
    assert.ok(cfg.dev_only.includes(n), `dev_only ${n}`);
  }
  assert.equal(cfg.forbidden.length > 0, true);
});

test('UT-GATE-250 deps: 허용표 밖 신규 이름·허용 단위 밖 사용은 계속 위반이다 [NFR-MAINT-001]', () => {
  const web = (deps) => ({
    'apps/web/package.json': JSON.stringify({ name: '@fathom/app-web', private: true, ...deps }, null, 2),
  });
  withClean('check-deps', web({ dependencies: { 'left-pad': '1.3.0' } }), (dir) => {
    const res = run('check-deps.mjs', dir);
    assert.equal(res.status, 1);
    assert.deepEqual(
      res.json.violations.map((v) => `${v.rule}|${v.message.split(' ')[0]}`),
      ['deps/not-allowed|left-pad'],
    );
  });
  // CR-69 가산 단위 밖(services/a)에서 @types/react는 위반, 정확 버전 불일치도 위반
  withClean(
    'check-deps',
    {
      'services/a/package.json': JSON.stringify({
        name: '@fathom/svc-a',
        dependencies: { '@fathom/contracts': 'workspace:*', fastify: '5.12.5' },
        devDependencies: { '@types/react': '19.3.0', vitest: '5.0.2' },
      }),
    },
    (dir) => {
      const res = run('check-deps.mjs', dir);
      assert.equal(res.status, 1);
      assert.ok(res.json.violations.some((v) => v.message.includes('@types/react')));
    },
  );
});

// ---- UT-GATE-251~252 ng-g — 별칭 import 원 이름(CO-10) ----
test('UT-GATE-251 ng-g: import { Sparkles as AiMark }·export { A as B } from의 원 이름은 통과한다 [FR-UX-008]', () => {
  const rules = (text) => ngSource('apps/web/src/x.tsx', text, ngCfg).map((v) => v.rule);
  assert.deepEqual(rules("import { Sparkles as AiMark } from 'lucide-react';\nexport const M = AiMark;\n"), []);
  assert.deepEqual(
    rules("import { WandSparkles as AiEstimateMark, Gauge } from 'lucide-react';\nvoid AiEstimateMark;\n"),
    [],
  );
  assert.deepEqual(rules("export { Sparkles as AiBadgeMark } from 'lucide-react';\n"), []);
  assert.deepEqual(rules("import type { Sparkles as AiMark } from 'lucide-react';\nvoid 0;\n"), []);
  assert.equal(run('check-ng-g.mjs', path.join(FIX('check-ng-g'), 'clean')).status, 0);
});

test('UT-GATE-252 ng-g: 지역 이름·별칭이 보상 어휘이거나 as 없는 import 원 이름이면 위반이 유지된다 [FR-UX-008]', () => {
  const rules = (text) => ngSource('apps/web/src/x.tsx', text, ngCfg).map((v) => v.rule);
  assert.deepEqual(rules("import { Star as SparklesMark } from 'lucide-react';\n"), ['ng-g1/reward-vocab']);
  assert.deepEqual(rules("import { Sparkles } from 'lucide-react';\nvoid Sparkles;\n"), [
    'ng-g1/reward-vocab',
    'ng-g1/reward-vocab',
  ]);
  assert.deepEqual(rules('const coinBadge = 1;\nvoid coinBadge;\n'), ['ng-g1/reward-vocab', 'ng-g1/reward-vocab']);
  // 표현식의 `x as T`는 import 별칭이 아니다
  assert.deepEqual(rules('const v = { k: xp as number };\n'), ['ng-g1/reward-vocab']);
  const viol = run('check-ng-g.mjs', path.join(FIX('check-ng-g'), 'violations'));
  assert.ok(typedKeys(viol).includes('apps/web/src/local-reward.tsx:4:ng-g1/reward-vocab'));
});

// ---- UT-GATE-253~254 typo-ko — K11 캡션 하한(CO-10) ----
test('UT-GATE-253 typo-ko: <p class="text-sm">·text-xs는 캡션 크기(≥ 12.5px)라 통과한다 [NFR-UX-009]', () => {
  const rules = (text) => typoSource('apps/web/src/features/x/X.tsx', text).map((v) => v.rule);
  assert.deepEqual(rules('export const A = <p className="text-sm">x</p>;'), []);
  assert.deepEqual(rules('export const A = <p className="mt-2 text-xs">x</p>;'), []);
  assert.equal(run('check-typo-ko.mjs', path.join(FIX('check-typo-ko'), 'clean')).status, 0);
});

test('UT-GATE-254 typo-ko: <p class="text-2xs">(11px)는 12.5px 캡션 하한 미만 위반 문구로 계속 잡힌다 [NFR-UX-009]', () => {
  const out = typoSource('apps/web/src/features/x/X.tsx', 'export const A = <p className="text-2xs">x</p>;');
  assert.deepEqual(
    out.map((v) => [v.rule, v.message]),
    [['typo-ko/body-min', '<p> text below the 12.5px caption minimum: text-2xs (K11)']],
  );
});

// ---- UT-GATE-255 security — redact 테스트 경로(CR-76) ----
test('UT-GATE-255 security: redact 단위 테스트 경로의 비밀 리터럴은 통과하고 다른 테스트 경로는 위반이 유지된다 [NFR-SEC-004]', () => {
  const secret = `export const K = 'sk-ant-${'x'.repeat(24)}';\n`;
  const files = (rel) => ({ [rel]: secret });
  for (const [rel, expected] of [
    ['packages/shared-kernel/test/unit/redact/redact.spec.ts', 0],
    ['packages/shared-kernel/test/unit/other/redact.spec.ts', 1],
    ['packages/shared-kernel/test/unit/redact-extra.spec.ts', 1],
    ['services/a/test/unit/redact/redact.spec.ts', 1],
  ]) {
    withClean('check-security-scan', files(rel), (dir) => {
      const res = run('check-security-scan.mjs', dir);
      assert.equal(res.status, expected, `${rel}: ${JSON.stringify(res.json.violations)}`);
    });
  }
  assert.deepEqual(
    scanSource('services/a/src/x.ts', secret).map((v) => v.rule),
    ['security/secret-literal'],
  );
});

// ---- UT-GATE-256 workspace — 루트 설정(CO-01~04) ----
test('UT-GATE-256 workspace: biome css.parser.tailwindDirectives·포매터 제외 3파일·.snapshots 무시·루트 version semver·engines.node >=22.18.0 [NFR-MAINT-005]', () => {
  const biome = JSON.parse(readFileSync(path.join(ROOT, 'biome.json'), 'utf8'));
  assert.equal(biome.css.parser.tailwindDirectives, true);
  const noFmt = biome.overrides.find((o) => o.formatter?.enabled === false);
  assert.deepEqual(noFmt.includes, [
    'packages/design-tokens/src/tokens.css',
    'packages/design-tokens/src/typography.css',
    'apps/web/src/styles/app.css',
  ]);
  assert.ok(biome.files.includes.includes('!packages/contracts/.snapshots'));
  const preload = biome.overrides.find(
    (o) => o.linter?.rules?.style?.noProcessEnv === 'off' && o.includes.includes('tools/**'),
  );
  assert.ok(preload.includes.includes('packages/testkit/src/preload/**'), 'CR-72 noProcessEnv override');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.engines.node, '>=22.18.0');
  const boundaries = JSON.parse(readFileSync(path.join(GATES_DIR, 'config', 'boundaries.json'), 'utf8'));
  assert.ok(boundaries.intra.builtin_restricted.child_process.includes('packages/testkit/src/preload/**'));
});
