// UT-GATE-060~064 — check:tsconfig-paths(STD-TS-01~03, STD-NAM-01~05) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-tsconfig-paths.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-tsconfig-paths');

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

const ROOT_OK = '{ "include": ["apps/*/src", "services/*/src", "packages/*/src"] }\n';

function withRepo(files, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-tsc-'));
  try {
    for (const rel of ['services/a', 'packages/contracts']) {
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

const rulesOf = (res) => res.json.violations.map((v) => `${v.file}:${v.line}:${v.rule}`);

test('UT-GATE-060 check:tsconfig-paths selftest(clean 0·violations 1·빈 root 2·없는 root 2)가 통과한다 [NFR-MAINT-001]', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:tsconfig-paths'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
});

test('UT-GATE-061 compilerOptions.paths·baseUrl은 줄 번호와 함께 위반이고 없는 설정은 통과한다 [NFR-MAINT-001]', () => {
  withRepo(
    {
      'tsconfig.json': ROOT_OK,
      'services/a/tsconfig.json': '{\n  "compilerOptions": {\n    "paths": {},\n    "baseUrl": "."\n  }\n}\n',
    },
    (dir) => {
      const res = run(dir);
      assert.equal(res.status, 1);
      assert.deepEqual(rulesOf(res), [
        'services/a/tsconfig.json:3:tsconfig/paths',
        'services/a/tsconfig.json:4:tsconfig/base-url',
      ]);
    },
  );
  withRepo({ 'tsconfig.json': ROOT_OK, 'services/a/tsconfig.json': '{ "compilerOptions": { "strict": true } }\n' }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
  // tsconfig.build.json 같은 변종 파일도 검사한다. 파일 이름이 tsconfig*.json이 아니면 무시한다.
  withRepo(
    {
      'tsconfig.json': ROOT_OK,
      'services/a/tsconfig.build.json': '{ "compilerOptions": { "baseUrl": "." } }\n',
      'services/a/other.json': '{ "compilerOptions": { "baseUrl": "." } }\n',
    },
    (dir) => assert.deepEqual(rulesOf(run(dir)), ['services/a/tsconfig.build.json:1:tsconfig/base-url']),
  );
});

test('UT-GATE-062 루트 tsconfig.json의 include는 apps·services·packages src 셋을 모두 가져야 한다 [NFR-MAINT-001]', () => {
  withRepo({ 'tsconfig.json': ROOT_OK }, (dir) => assert.equal(run(dir).status, 0));
  withRepo({ 'tsconfig.json': '{ "include": ["apps/*/src/**/*", "services/*/src", "packages/*/src"] }\n' }, (dir) =>
    assert.equal(run(dir).status, 0, '`apps/*/src/**/*` 형태도 허용'),
  );
  withRepo({ 'tsconfig.json': '{ "include": ["services/*/src"] }\n' }, (dir) => {
    const res = run(dir);
    assert.deepEqual(rulesOf(res), ['tsconfig.json:1:tsconfig/root-include']);
    assert.match(res.json.violations[0].message, /apps\/\*\/src, packages\/\*\/src/);
  });
  // 루트 tsconfig.json 없음(단위 tsconfig만 있음)
  withRepo({ 'services/a/tsconfig.json': '{}\n' }, (dir) =>
    assert.deepEqual(rulesOf(run(dir)), ['tsconfig.json:1:tsconfig/root-include']),
  );
});

test('UT-GATE-063 패키지 이름은 단위 형식(@fathom/svc-x·app-x·tool-x·x)과 같아야 한다 [NFR-MAINT-001]', () => {
  withRepo(
    {
      'tsconfig.json': ROOT_OK,
      'services/a/package.json': '{ "name": "@fathom/svc-a" }\n',
      'apps/web/package.json': '{ "name": "@fathom/app-web" }\n',
      'tools/gates/package.json': '{ "name": "@fathom/tool-gates" }\n',
      'packages/contracts/package.json': '{ "name": "@fathom/contracts" }\n',
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
  withRepo(
    {
      'tsconfig.json': ROOT_OK,
      'services/a/package.json': '{\n  "name": "@fathom/x"\n}\n',
      'apps/web/package.json': '{ "name": "@fathom/svc-web" }\n',
      'tools/gates/package.json': '{ "name": "@fathom/gates" }\n',
      'packages/contracts/package.json': '{ "name": "@fathom/svc-contracts" }\n',
    },
    (dir) => {
      const res = run(dir);
      assert.equal(res.status, 1);
      assert.deepEqual(rulesOf(res), [
        'apps/web/package.json:1:tsconfig/package-name',
        'packages/contracts/package.json:1:tsconfig/package-name',
        'services/a/package.json:2:tsconfig/package-name',
        'tools/gates/package.json:1:tsconfig/package-name',
      ]);
    },
  );
});

test('UT-GATE-064 tsconfig는 JSONC(주석·끝 쉼표)로 파싱하고 tsconfig가 하나도 없거나 깨지면 exit 2다 [NFR-MAINT-001]', () => {
  withRepo(
    {
      'tsconfig.json': '{\n  // line comment\n  "compilerOptions": { /* block */ "strict": true, },\n  "include": ["apps/*/src", "services/*/src", "packages/*/src",],\n}\n',
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
  withRepo({ 'tsconfig.json': '{ "compilerOptions": { "baseUrl": ' }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/config: /);
  });
  withRepo({}, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: no tsconfig/);
  });
});
