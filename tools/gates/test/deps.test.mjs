// UT-GATE-050~059 — check:deps(config/deps.json, ARC-01 §18 허용표) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-deps.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-deps');
const CLEAN = path.join(FIX, 'clean');
const VIOL = path.join(FIX, 'violations');

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json, stderr: r.stderr };
}

const rulesOf = (res, file) =>
  res.json.violations
    .filter((v) => v.severity === 'error' && (file === undefined || v.file === file))
    .map((v) => v.rule)
    .sort();

/** 임시 저장소: 기대 단위(services/a, packages/contracts)를 갖추고 files({상대경로: 문자열|객체})를 쓴다. */
function makeRepo(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-deps-'));
  for (const rel of ['services/a', 'packages/contracts']) {
    mkdirSync(path.join(dir, rel), { recursive: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

function withRepo(files, fn) {
  const dir = makeRepo(files);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('UT-GATE-050 check:deps selftest(clean 0·violations 1 + 기대 집합 일치·빈 root 2·없는 root 2)가 통과한다 [NFR-MAINT-001][AP-07][AP-08]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:deps'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('UT-GATE-051 위반 fixture는 11규칙 전부를 기대 집합대로 보고하고 clean은 0건이다 [NFR-MAINT-001][AP-07]', () => {
  const clean = run(CLEAN);
  assert.equal(clean.status, 0);
  assert.equal(clean.json.errors, 0);
  const viol = run(VIOL);
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(VIOL), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const seen = new Set(viol.json.violations.map((v) => v.rule));
  for (const rule of [
    'deps/forbidden',
    'deps/not-allowed',
    'deps/unit-not-allowed',
    'deps/version-mismatch',
    'deps/range-spec',
    'deps/typescript-local',
    'deps/workspace-spec',
    'deps/workspace-unit',
    'deps/testkit-runtime',
    'deps/dev-only-runtime',
    'deps/import-location',
  ]) {
    assert.ok(seen.has(rule), `rule ${rule} must have a positive fixture`);
  }
});

test('UT-GATE-052 @fathom/*는 workspace:* 만 허용하고 testkit은 devDependencies일 때만 통과한다 [NFR-MAINT-001][AP-07]', () => {
  const pkg = (deps, dev) => ({ name: '@fathom/svc-a', dependencies: deps, devDependencies: dev });
  withRepo(
    { 'services/a/package.json': pkg({ '@fathom/contracts': 'workspace:*' }, { '@fathom/testkit': 'workspace:*' }) },
    (dir) => assert.equal(run(dir).status, 0),
  );
  withRepo({ 'services/a/package.json': pkg({ '@fathom/contracts': '^1.0.0' }, {}) }, (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['deps/workspace-spec']),
  );
  withRepo({ 'services/a/package.json': pkg({ '@fathom/testkit': 'workspace:*' }, {}) }, (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['deps/testkit-runtime']),
  );
  // 테스트킷은 어떤 단위의 devDependencies에도 허용(packages/contracts 포함)
  withRepo(
    {
      'packages/contracts/package.json': {
        name: '@fathom/contracts',
        devDependencies: { '@fathom/testkit': 'workspace:*' },
      },
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
  // 허용표(boundaries.json) 밖 단위 의존
  withRepo(
    { 'services/a/package.json': pkg({ '@fathom/svc-b': 'workspace:*', '@fathom/ui': 'workspace:*' }, {}) },
    (dir) => assert.deepEqual(rulesOf(run(dir)), ['deps/workspace-unit', 'deps/workspace-unit']),
  );
});

test('UT-GATE-053 ^7.0.2 는 range-spec과 version-mismatch를 함께 보고한다 [NFR-MAINT-001][AP-08]', () => {
  withRepo({ 'package.json': { name: 'w', devDependencies: { typescript: '^7.0.2' } } }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(rulesOf(res), ['deps/range-spec', 'deps/version-mismatch']);
    assert.equal(res.json.violations[0].line, 4, '줄 번호 = 의존 키가 있는 줄');
  });
  for (const spec of ['~7.0.2', '>=7.0.2', '*', '7.x', 'latest', '7.0.2 || 7.0.3']) {
    withRepo({ 'package.json': { name: 'w', devDependencies: { typescript: spec } } }, (dir) =>
      assert.ok(rulesOf(run(dir)).includes('deps/range-spec'), `${spec} is a range`),
    );
  }
  withRepo({ 'package.json': { name: 'w', devDependencies: { typescript: '7.0.2' } } }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
});

test('UT-GATE-054 npm:@typescript/typescript6 별칭·금지 이름·금지 패턴은 forbidden이다 [NFR-MAINT-001][AP-08]', () => {
  withRepo(
    {
      'services/a/package.json': {
        name: '@fathom/svc-a',
        devDependencies: { typescript: 'npm:@typescript/typescript6@6.0.3' },
      },
    },
    (dir) => assert.deepEqual(rulesOf(run(dir)), ['deps/forbidden']),
  );
  withRepo(
    {
      'package.json': {
        name: 'w',
        devDependencies: {
          prettier: '3.0.0',
          'typescript-eslint': '8.0.0',
          '@typescript-eslint/parser': '8.0.0',
          'eslint-plugin-x': '1.0.0',
        },
      },
    },
    (dir) =>
      assert.deepEqual(rulesOf(run(dir)), ['deps/forbidden', 'deps/forbidden', 'deps/forbidden', 'deps/forbidden']),
  );
});

test('UT-GATE-055 import_paths가 있는 SDK는 지정 glob 안에서만 import할 수 있다 [NFR-MAINT-001][AP-07]', () => {
  const pkg = {
    name: '@fathom/svc-ai-gateway',
    dependencies: { '@typesafe-ai/sdk': '0.6.0', '@anthropic-ai/sdk': '0.129.0' },
  };
  withRepo(
    {
      'services/ai-gateway/package.json': pkg,
      'services/ai-gateway/src/jev/a.ts': "import { jev } from '@typesafe-ai/sdk';\nexport const x = jev;\n",
      'services/ai-gateway/src/infra/providers/p.ts': "import A from '@anthropic-ai/sdk';\nexport const y = A;\n",
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
  withRepo(
    {
      'services/ai-gateway/package.json': pkg,
      'services/ai-gateway/src/http/x.ts': "import { jev } from '@typesafe-ai/sdk';\nexport const x = jev;\n",
      'services/ai-gateway/src/jev/b.ts': "const m = await import('@anthropic-ai/sdk/resources');\nexport { m };\n",
    },
    (dir) => {
      const res = run(dir);
      assert.deepEqual(rulesOf(res), ['deps/import-location', 'deps/import-location']);
      assert.deepEqual(
        res.json.violations.map((v) => `${v.file}:${v.line}`),
        ['services/ai-gateway/src/http/x.ts:1', 'services/ai-gateway/src/jev/b.ts:1'],
      );
    },
  );
});

test('UT-GATE-056 deps.json의 version이 1이 아니거나 설정이 없거나 깨지면 exit 2다 [NFR-MAINT-001]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-deps-cfg-'));
  try {
    const base = JSON.parse(readFileSync(path.join(GATES_DIR, 'config', 'deps.json'), 'utf8'));
    writeFileSync(path.join(dir, 'v2.json'), JSON.stringify({ ...base, version: 2 }));
    writeFileSync(path.join(dir, 'broken.json'), '{ not json');
    writeFileSync(path.join(dir, 'nokeys.json'), JSON.stringify({ version: 1, packages: [] }));
    for (const name of ['v2.json', 'broken.json', 'nokeys.json']) {
      const res = run(CLEAN, '--config', path.join(dir, name));
      assert.equal(res.status, 2, name);
      assert.match(res.json.error, /^engine\/config: /);
    }
    assert.equal(run(CLEAN, '--config', path.join(dir, 'missing.json')).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-GATE-057 package.json이 하나도 없으면 exit 2(engine/input-missing)다 [NFR-MAINT-001]', () => {
  withRepo({}, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: /);
  });
  const none = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-deps-none-'));
  try {
    assert.equal(run(none).status, 2, '기대 단위가 없으면 engine/missing-units');
  } finally {
    rmSync(none, { recursive: true, force: true });
  }
});

test('UT-GATE-058 units 와일드카드(`*`·`services/*`·`(root)`)와 표 밖 의존(not-allowed)을 구분한다 [NFR-MAINT-001][AP-07]', () => {
  // zod는 모든 단위, fastify는 services/* , vitest는 모든 단위(dev), pino는 shared-kernel만
  withRepo(
    {
      'services/a/package.json': {
        name: '@fathom/svc-a',
        dependencies: { zod: '4.6.5', fastify: '5.12.5' },
        devDependencies: { vitest: '5.0.2' },
      },
      'packages/contracts/package.json': { name: '@fathom/contracts', dependencies: { zod: '4.6.5' } },
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
  withRepo(
    { 'packages/contracts/package.json': { name: '@fathom/contracts', dependencies: { fastify: '5.12.5' } } },
    (dir) => assert.deepEqual(rulesOf(run(dir)), ['deps/unit-not-allowed']),
  );
  withRepo({ 'package.json': { name: 'w', devDependencies: { typescript: '7.0.2', 'left-pad': '1.0.0' } } }, (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['deps/not-allowed']),
  );
  withRepo({ 'services/a/package.json': { name: '@fathom/svc-a', peerDependencies: { 'left-pad': '1.0.0' } } }, (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['deps/not-allowed'], 'peerDependencies도 검사한다'),
  );
});

test('UT-GATE-059 선언 줄 번호와 정렬·텍스트 출력 형식이 계약대로다 [NFR-MAINT-001]', () => {
  const dir = makeRepo({
    'package.json':
      '{\n  "name": "w",\n  "dependencies": {\n    "zod": "4.6.5"\n  },\n  "devDependencies": {\n    "zod": "4.6.4"\n  }\n}\n',
  });
  try {
    const res = run(dir);
    assert.equal(res.json.violations.length, 1);
    assert.equal(res.json.violations[0].line, 7, 'devDependencies 안의 zod 줄');
    const text = spawnSync(process.execPath, [GATE, '--root', dir], { encoding: 'utf8' });
    assert.equal(text.status, 1);
    assert.match(text.stdout, /^package\.json:7 {2}error {2}deps\/version-mismatch {2}/m);
    assert.match(text.stdout, /\[check:deps\] 1 error\(s\), 0 warning\(s\), 1 file\(s\)\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
