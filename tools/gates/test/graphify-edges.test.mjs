// UT-GATE-194~199 — audit:graph(graphify 코드 그래프의 단위 간 직접 엣지, boundaries.json 기준) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeGraph } from '../check-graphify-edges.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';
import { loadBoundaries } from '../lib/units.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-graphify-edges.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-graphify-edges');
const cfg = loadBoundaries();

function run(root, args = [], env) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], {
    encoding: 'utf8',
    ...(env ? { env } : {}),
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

const node = (id, source_file) => ({ id, label: id, source_file });
const edge = (source, target, relation = 'imports_from', source_location = 'L1') => ({
  source,
  target,
  relation,
  confidence: 'EXTRACTED',
  source_location,
});
const graph = (nodes, edges) => ({ nodes, edges });
const NODES = [
  node('a', 'services/a/src/x.ts'),
  node('b', 'services/b/src/x.ts'),
  node('c', 'packages/contracts/src/index.ts'),
  node('sk', 'packages/shared-kernel/src/index.ts'),
  node('ui', 'packages/ui/src/button.ts'),
  node('dt', 'packages/design-tokens/src/index.ts'),
  node('web', 'apps/web/src/main.ts'),
  node('pkg', 'services/a/package.json'),
  { id: 'ref_zod', label: 'zod' },
];
const rulesOf = (edges, nodes = NODES) =>
  analyzeGraph(graph(nodes, edges), cfg, '/r').violations.map((v) => `${v.file}:${v.line}`);

function withRepo(files, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-graph-'));
  try {
    for (const rel of ['services/a', 'packages/contracts']) {
      mkdirSync(path.join(dir, rel), { recursive: true });
    }
    for (const [rel, v] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), typeof v === 'string' ? v : JSON.stringify(v));
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('UT-GATE-194 audit:graph selftest(--graph <CASE>/graph.json)가 통과하고 위반 fixture가 기대 집합과 일치한다 [NFR-MAINT-001][UR-09][IF-EXT-13]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'audit:graph'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = path.join(FIX, 'violations');
  const res = run(viol, ['--graph', path.join(viol, 'graph.json')]);
  assert.equal(res.status, 1);
  const { fp, fn } = compare(loadExpectations(viol), res.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const clean = path.join(FIX, 'clean');
  assert.equal(run(clean, ['--graph', path.join(clean, 'graph.json')]).status, 0);
});

test('UT-GATE-195 판정은 boundaries.json 기준이다 — ui → shared-kernel 엣지는 위반, services → contracts·shared-kernel 은 통과한다 [NFR-MAINT-001][UR-09]', () => {
  assert.deepEqual(rulesOf([edge('ui', 'sk', 'imports_from', 'L4')]), ['packages/ui/src/button.ts:4']);
  assert.deepEqual(rulesOf([edge('a', 'c'), edge('a', 'sk')]), []);
  assert.deepEqual(rulesOf([edge('ui', 'dt')]), [], 'ui 는 design-tokens 허용');
  assert.deepEqual(rulesOf([edge('web', 'c'), edge('web', 'ui'), edge('web', 'dt')]), []);
  assert.deepEqual(rulesOf([edge('a', 'b')]), ['services/a/src/x.ts:1']);
  assert.deepEqual(rulesOf([edge('web', 'a')]), ['apps/web/src/main.ts:1']);
  assert.deepEqual(
    rulesOf([edge('c', 'a')]),
    ['packages/contracts/src/index.ts:1'],
    'contracts 는 아무것도 import 하지 않는다',
  );
  // 진단 메시지에 단위와 대상 파일이 있다
  const v = analyzeGraph(graph(NODES, [edge('a', 'b', 'dynamic_import')]), cfg, '/r').violations[0];
  assert.equal(v.rule, 'boundary/graphify-edge');
  assert.match(v.message, /services\/a -> services\/b \(dynamic_import, EXTRACTED\) target services\/b\/src\/x\.ts/);
});

test('UT-GATE-196 `ref_` 대상 노드·package.json 출발점·같은 단위·다른 relation은 제외한다 [NFR-MAINT-001][UR-09]', () => {
  assert.deepEqual(rulesOf([edge('a', 'ref_zod'), edge('ui', 'ref_zod')]), []);
  assert.deepEqual(rulesOf([edge('pkg', 'b')]), [], 'package.json 의존 목록');
  assert.deepEqual(rulesOf([edge('a', 'a')]), []);
  assert.deepEqual(rulesOf([edge('a', 'b', 'calls'), edge('a', 'b', 'contains')]), [], 'import 계열 relation 4종만');
  for (const rel of ['imports_from', 're_exports', 'dynamic_import', 'imports']) {
    assert.deepEqual(rulesOf([edge('a', 'b', rel)]), ['services/a/src/x.ts:1'], rel);
  }
  assert.deepEqual(rulesOf([edge('a', 'missing-node')]), [], '없는 노드 엣지는 무시');
  assert.deepEqual(
    rulesOf([edge('a', 'b', 'imports_from', 'L12:5')]),
    ['services/a/src/x.ts:12'],
    'source_location(L12:5)의 첫 숫자열 = 줄',
  );
});

test('UT-GATE-197 절대 경로 source_file은 root 기준으로 정규화하고 links 키도 읽는다 [NFR-MAINT-001][UR-09]', () => {
  const abs = [node('a', '/r/services/a/src/x.ts'), node('b', '/r/services/b/src/x.ts')];
  assert.deepEqual(
    analyzeGraph(graph(abs, [edge('a', 'b')]), cfg, '/r').violations.map((v) => v.file),
    ['services/a/src/x.ts'],
  );
  const links = analyzeGraph({ nodes: NODES, links: [edge('a', 'b')] }, cfg, '/r');
  assert.equal(links.violations.length, 1);
  assert.equal(links.files, 8, 'files = source_file이 있는 노드 수(ref_ 노드 제외)');
});

test('UT-GATE-198 --extract: graphify 실행 파일이 없으면(PATH 비움) exit 0 + {"skipped":true,"reason":"graphify-unavailable"}이다 [NFR-MAINT-001][UR-09][IF-EXT-13]', () => {
  withRepo({}, (dir) => {
    const res = run(dir, ['--extract'], { PATH: '' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(res.json, { check: 'audit:graph', exit: 0, skipped: true, reason: 'graphify-unavailable' });
    const text = spawnSync(process.execPath, [GATE, '--root', dir, '--extract'], {
      encoding: 'utf8',
      env: { PATH: '' },
    });
    assert.equal(text.status, 0);
    assert.match(text.stdout, /skipped: graphify-unavailable/);
  });
  // root 가 없으면 extract 를 시도하지 않고 exit 2
  const missing = run(path.join(os.tmpdir(), 'fathom-no-such-root-xyz'), ['--extract'], { PATH: '' });
  assert.equal(missing.status, 2);
  assert.match(missing.json.error, /^engine\/no-root: /);
});

test('UT-GATE-199 노드가 0개면 exit 2이고 graph.json 부재·잘못된 JSON·기본 위치(graphify-out/graph.json)를 구분한다 [NFR-MAINT-001][UR-09]', () => {
  withRepo({ 'g.json': { nodes: [], edges: [] } }, (dir) => {
    const res = run(dir, ['--graph', 'g.json']);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/no-files: /);
  });
  withRepo({ 'g.json': { nodes: [{ id: 'ref_x' }], edges: [] } }, (dir) =>
    assert.equal(run(dir, ['--graph', 'g.json']).status, 2, 'source_file 있는 노드가 0개'),
  );
  withRepo({}, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: graph\.json not found/);
  });
  withRepo({ 'g.json': '{ nope' }, (dir) => assert.equal(run(dir, ['--graph', 'g.json']).status, 2));
  withRepo({ 'graphify-out/graph.json': graph(NODES, [edge('a', 'b')]) }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1, '기본 위치');
    assert.equal(res.json.violations.length, 1);
  });
  withRepo({ 'g.json': graph(NODES, []) }, (dir) =>
    assert.equal(run(dir, ['--graph', 'g.json', '--bogus']).status, 2, '알 수 없는 옵션'),
  );
});
