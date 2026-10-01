// UT-GATE-172~179 — check:consumers(소비자 매니페스트 ↔ 이벤트 스냅샷, IF-01 §9.5) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pathExists, validateManifest } from '../check-consumers.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-consumers.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-consumers');
const MAN = 'packages/contracts/src/events/__consumers__';
const SNAP = 'packages/contracts/.snapshots/events';
const ROUTING = 'packages/contracts/src/events/routing.gen.ts';

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

const sub = (over = {}) => ({
  type: 'a.b.c',
  schema_versions: [1],
  mode: 'durable',
  on_poison: 'halt',
  reads: ['id'],
  ...over,
});
const SCHEMA = { type: 'object', properties: { id: { type: 'string' } } };

/** manifests {name: obj|text}, snapshots {fileName: obj}, routing text|null. */
function withRepo({ manifests = {}, snapshots = {}, routing = 'a.b.c' }, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-cons-'));
  const put = (rel, v) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  };
  try {
    mkdirSync(path.join(dir, 'services/a'), { recursive: true });
    mkdirSync(path.join(dir, 'packages/contracts'), { recursive: true });
    for (const [n, v] of Object.entries(manifests)) {
      put(`${MAN}/${n}`, v);
    }
    for (const [n, v] of Object.entries(snapshots)) {
      put(`${SNAP}/${n}`, v);
    }
    if (routing !== null) {
      put(ROUTING, `// generated\n${routing}\n`);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ruleLines = (res) => res.json.violations.map((v) => `${v.line}:${v.rule}`);

test('UT-GATE-172 check:consumers selftest가 통과하고 위반 fixture 6규칙이 기대 집합과 일치한다 [NFR-MAINT-003][IF-EV §9.5]', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:consumers'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // fixture는 생성물 이름(*.gen.ts)을 피해 routing.fixture.ts 를 쓰고 selftest.args.json 의 --routing 으로 가리킨다
  const caseArgs = (c) => JSON.parse(readFileSync(path.join(FIX, c, 'selftest.args.json'), 'utf8'));
  const viol = run(path.join(FIX, 'violations'), ...caseArgs('violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const seen = new Set(viol.json.violations.map((v) => v.rule));
  for (const rule of [
    'consumers/schema',
    'consumers/file-name',
    'consumers/drop-not-notify',
    'consumers/no-producer-schema',
    'consumers/reads-missing',
    'consumers/routing-stale',
  ]) {
    assert.ok(seen.has(rule), rule);
  }
  assert.equal(run(path.join(FIX, 'clean'), ...caseArgs('clean')).status, 0);
});

test('UT-GATE-173 스키마 위반 — 미지 키·소비자 이름·reads 대문자·type 형식·schema_versions·mode·on_poison·구독 40개 초과 [NFR-MAINT-003][IF-EV §9.5]', () => {
  const msgs = (json) => validateManifest(json).map((p) => p.message);
  assert.deepEqual(msgs({ consumer: 'learning', subscriptions: [sub()] }), []);
  assert.match(msgs({ consumer: 'learning', extra: 1, subscriptions: [] })[0], /unknown key "extra"/);
  assert.match(msgs({ consumer: 'nope', subscriptions: [] })[0], /consumer must be one of/);
  assert.match(
    msgs({ consumer: 'learning', subscriptions: [sub({ reads: ['Pack_Id'] })] })[0],
    /reads must be a non-empty array/,
  );
  assert.match(
    msgs({ consumer: 'learning', subscriptions: [sub({ reads: [] })] })[0],
    /reads must be a non-empty array/,
  );
  assert.match(msgs({ consumer: 'learning', subscriptions: [sub({ type: 'A.b.c' })] })[0], /type must match/);
  assert.match(msgs({ consumer: 'learning', subscriptions: [sub({ type: 'a.b' })] })[0], /type must match/);
  assert.match(msgs({ consumer: 'learning', subscriptions: [sub({ schema_versions: [] })] })[0], /schema_versions/);
  assert.match(msgs({ consumer: 'learning', subscriptions: [sub({ schema_versions: [0] })] })[0], /schema_versions/);
  assert.match(msgs({ consumer: 'learning', subscriptions: [sub({ mode: 'push' })] })[0], /mode must be one of/);
  assert.match(
    msgs({ consumer: 'learning', subscriptions: [sub({ on_poison: 'ignore' })] })[0],
    /on_poison must be one of/,
  );
  assert.match(msgs({ consumer: 'learning', subscriptions: [{ ...sub(), extra: 1 }] })[0], /unknown key "extra"/);
  const { reads: _r, ...noReads } = sub();
  assert.match(msgs({ consumer: 'learning', subscriptions: [noReads] })[0], /missing key "reads"/);
  assert.match(msgs({ consumer: 'learning', subscriptions: Array.from({ length: 41 }, () => sub()) })[0], /max 40/);
  assert.deepEqual(msgs({ consumer: 'learning', subscriptions: Array.from({ length: 40 }, () => sub()) }), []);
  assert.deepEqual(msgs({ consumer: 'learning', subscriptions: [sub({ reads: ['*', 'a.b_c.d'] })] }), []);
  withRepo(
    {
      manifests: { 'learning.json': { consumer: 'learning', subscriptions: [sub({ reads: ['Pack_Id'] })] } },
      snapshots: { 'a.b.c.v1.json': SCHEMA },
    },
    (dir) => {
      const res = run(dir);
      assert.equal(res.status, 1);
      assert.deepEqual(
        res.json.violations.map((v) => v.rule),
        ['consumers/schema'],
      );
    },
  );
});

test('UT-GATE-174 파일 이름은 <consumer>.json 이어야 한다 [NFR-MAINT-003][IF-EV §9.5]', () => {
  const m = { consumer: 'learning', subscriptions: [sub()] };
  withRepo({ manifests: { 'learning.json': m }, snapshots: { 'a.b.c.v1.json': SCHEMA } }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
  withRepo({ manifests: { 'learning-v2.json': m }, snapshots: { 'a.b.c.v1.json': SCHEMA } }, (dir) => {
    const res = run(dir);
    assert.deepEqual(
      res.json.violations.map((v) => v.rule),
      ['consumers/file-name'],
    );
  });
});

test('UT-GATE-175 on_poison: drop 은 notify 전용이다(durable + drop = 위반) [NFR-MAINT-003][IF-EV §9.5]', () => {
  const snaps = { 'a.b.c.v1.json': SCHEMA };
  withRepo(
    {
      manifests: {
        'gateway.json': { consumer: 'gateway', subscriptions: [sub({ mode: 'notify', on_poison: 'drop' })] },
      },
      snapshots: snaps,
    },
    (dir) => assert.equal(run(dir).status, 0),
  );
  withRepo(
    {
      manifests: {
        'gateway.json': { consumer: 'gateway', subscriptions: [sub({ mode: 'durable', on_poison: 'drop' })] },
      },
      snapshots: snaps,
    },
    (dir) => {
      assert.deepEqual(
        run(dir).json.violations.map((v) => v.rule),
        ['consumers/drop-not-notify'],
      );
    },
  );
});

test('UT-GATE-176 구독 type·schema_versions 마다 스냅샷 <type>.v<n>.json 이 없으면 consumers/no-producer-schema이다 [NFR-MAINT-003][IF-EV §9.5]', () => {
  const manifests = { 'learning.json': { consumer: 'learning', subscriptions: [sub({ schema_versions: [1, 2] })] } };
  withRepo({ manifests, snapshots: { 'a.b.c.v1.json': SCHEMA, 'a.b.c.v2.json': SCHEMA } }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
  withRepo({ manifests, snapshots: { 'a.b.c.v1.json': SCHEMA } }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(
      res.json.violations.map((v) => v.rule),
      ['consumers/no-producer-schema'],
    );
    assert.match(res.json.violations[0].message, /a\.b\.c v2/);
  });
  withRepo({ manifests, snapshots: {} }, (dir) =>
    assert.deepEqual(ruleLines(run(dir)).length, 1, '같은 type 줄의 위반은 (file,line,rule)로 병합'),
  );
});

test('UT-GATE-177 reads 점 경로 — properties·$ref·anyOf·배열 items를 따라 존재/부재를 판정한다 [NFR-MAINT-003][IF-EV §9.5]', () => {
  const schema = {
    type: 'object',
    properties: {
      verdict: { $ref: '#/$defs/Verdict' },
      result: { anyOf: [{ type: 'object', properties: { band: { type: 'string' } } }, { type: 'null' }] },
      items: {
        type: 'array',
        items: { type: 'object', properties: { score: { type: 'number' }, deep: { $ref: '#/$defs/Verdict' } } },
      },
    },
    $defs: { Verdict: { type: 'object', properties: { band: { type: 'string' } } } },
  };
  for (const ok of ['verdict', 'verdict.band', 'result.band', 'items', 'items.score', 'items.deep.band']) {
    assert.ok(pathExists(schema, ok.split('.')), ok);
  }
  for (const bad of ['verdict.nope', 'result.nope', 'items.nope', 'nope', 'verdict.band.x']) {
    assert.ok(!pathExists(schema, bad.split('.')), bad);
  }
  assert.ok(!pathExists({ $ref: '#/$defs/Missing' }, ['a']), '해석 불가 $ref');
  const loop = { $defs: { L: { $ref: '#/$defs/L' } }, $ref: '#/$defs/L' };
  assert.ok(!pathExists(loop, ['a']), '순환 $ref 는 무한 루프가 아니다');
  const manifests = {
    'learning.json': {
      consumer: 'learning',
      subscriptions: [sub({ type: 'a.b.c', reads: ['verdict.band', 'items.score'] })],
    },
  };
  withRepo({ manifests, snapshots: { 'a.b.c.v1.json': schema } }, (dir) => assert.equal(run(dir).status, 0));
  const bad = {
    'learning.json': { consumer: 'learning', subscriptions: [sub({ type: 'a.b.c', reads: ['verdict.nope'] })] },
  };
  withRepo({ manifests: bad, snapshots: { 'a.b.c.v1.json': schema } }, (dir) => {
    const res = run(dir);
    assert.deepEqual(
      res.json.violations.map((v) => v.rule),
      ['consumers/reads-missing'],
    );
    assert.match(res.json.violations[0].message, /verdict\.nope/);
  });
});

test('UT-GATE-178 reads "*"는 스키마 검사를 통과한다(gateway SSE 중계) [NFR-MAINT-003][IF-EV §9.5]', () => {
  const manifests = {
    'gateway.json': { consumer: 'gateway', subscriptions: [sub({ mode: 'notify', on_poison: 'drop', reads: ['*'] })] },
  };
  withRepo({ manifests, snapshots: { 'a.b.c.v1.json': { type: 'object', properties: {} } } }, (dir) =>
    assert.equal(run(dir).status, 0),
  );
  assert.ok(pathExists({ type: 'object' }, []), '빈 경로');
});

test('UT-GATE-179 routing.gen.ts에 구독 type이 없으면 consumers/routing-stale이고 --routing 파일이 없으면 이 검사를 건너뛴다 [NFR-MAINT-003][IF-EV §9.5]', () => {
  const manifests = { 'learning.json': { consumer: 'learning', subscriptions: [sub()] } };
  const snapshots = { 'a.b.c.v1.json': SCHEMA };
  withRepo({ manifests, snapshots, routing: 'export const R = ["x.y.z"];' }, (dir) => {
    const res = run(dir);
    assert.deepEqual(
      res.json.violations.map((v) => v.rule),
      ['consumers/routing-stale'],
    );
  });
  withRepo({ manifests, snapshots, routing: null }, (dir) => assert.equal(run(dir).status, 0));
  withRepo({ manifests, snapshots, routing: 'export const R = ["a.b.c"];' }, (dir) =>
    assert.equal(run(dir, '--routing', ROUTING).status, 0),
  );
  // 옵션 디렉터리 재지정
  withRepo({ manifests, snapshots }, (dir) => {
    assert.equal(run(dir, '--manifests', MAN, '--snapshots', SNAP).status, 0);
    const res = run(dir, '--manifests', 'nowhere');
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: no consumer manifests/);
  });
  // 매니페스트 0개 → exit 2
  withRepo({ snapshots }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: no consumer manifests/);
  });
});
