// UT-GATE-188~193 — check:rtm(rtm.json 판정, TST §18 ①~④) 단위 테스트.
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
const GATE = path.join(GATES_DIR, 'check-rtm.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-rtm');

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

const req = (id, status, priority = 'Must', tests = []) => ({
  id,
  kind: id.split('-')[0],
  priority,
  slice: 'R0',
  v: 'B+V-live',
  v_build: true,
  first_int: 'INT-1a',
  deferred: status === 'deferred',
  status,
  tests,
});
const rtmJson = (int, extra = {}) => ({
  version: 1,
  int,
  generated_at: 1790000000000,
  commit: 'unknown',
  summary: {},
  requirements: [req('FR-AI-001', 'met')],
  unknown_refs: [],
  title_errors: [],
  v_mismatch: [],
  ...extra,
});

/** 임시 root + .reports/<int>/rtm.json(기본 위치). */
function withRtm(json, int, fn, rel = `.reports/${int}/rtm.json`) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-rtm-'));
  try {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof json === 'string' ? json : JSON.stringify(json));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sev = (res) => res.json.violations.map((v) => `${v.rule}:${v.severity}`);

test('UT-GATE-188 check:rtm selftest(--int INT-3 --in <CASE>/rtm-in)가 통과하고 위반 fixture가 기대 집합과 일치한다 [PR-018][NFR-MAINT-011]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:rtm'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const dir = path.join(FIX, 'violations');
  const args = JSON.parse(readFileSync(path.join(dir, 'selftest.args.json'), 'utf8')).map((a) =>
    a.split(`\${CASE}`).join(dir),
  );
  const viol = run(dir, ...args);
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(
    loadExpectations(dir),
    viol.json.violations.filter((v) => v.severity === 'error'),
  );
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const cleanDir = path.join(FIX, 'clean');
  const cleanArgs = JSON.parse(readFileSync(path.join(cleanDir, 'selftest.args.json'), 'utf8')).map((a) =>
    a.split(`\${CASE}`).join(cleanDir),
  );
  assert.equal(run(cleanDir, ...cleanArgs).status, 0);
});

test('UT-GATE-189 6규칙(orphan·unmet·untested·unknown-ref·title·v-mismatch)의 양성과 진단 형식(요구 단위 = (repo):0, 메시지 앞머리 = 요구 ID)이다 [PR-018][NFR-MAINT-011]', () => {
  const t = (id, status) => ({ id, status, suite: 'ut', file: 'x.spec.ts' });
  const json = rtmJson('INT-3', {
    requirements: [
      req('FR-AI-001', 'orphan'),
      req('FR-AI-002', 'unmet', 'Must', [t('UT-1', 'fail'), t('UT-2', 'skip'), t('UT-3', 'pass')]),
      req('FR-AI-003', 'untested', 'Must', [t('UT-4', 'unknown')]),
      req('FR-AI-004', 'met'),
    ],
    unknown_refs: [{ test: 'UT-X-001', ref: 'FR-FOO-999', file: 'a.spec.ts', line: 7 }],
    title_errors: [{ file: 'b.spec.ts', line: 3, title: 'UT-A-001 x', reason: 'no-req' }],
    v_mismatch: [{ id: 'FR-AI-004', rtm: 'V-build', manifest: 'B+V-live' }],
  });
  withRtm(json, 'INT-3', (dir) => {
    const res = run(dir, '--int', 'INT-3');
    assert.equal(res.status, 1);
    assert.deepEqual(sev(res).sort(), [
      'rtm/orphan:error',
      'rtm/title:error',
      'rtm/unknown-ref:error',
      'rtm/unmet:error',
      'rtm/untested:error',
      'rtm/v-mismatch:warn',
    ]);
    assert.equal(res.json.files, 4);
    const byRule = Object.fromEntries(res.json.violations.map((v) => [v.rule, v]));
    assert.equal(byRule['rtm/orphan'].file, '(repo)');
    assert.equal(byRule['rtm/orphan'].line, 0);
    assert.match(byRule['rtm/orphan'].message, /^FR-AI-001: /);
    assert.match(byRule['rtm/unmet'].message, /^FR-AI-002: .*UT-1=fail, UT-2=skip/);
    assert.equal(byRule['rtm/unknown-ref'].file, 'a.spec.ts');
    assert.equal(byRule['rtm/unknown-ref'].line, 7);
    assert.equal(byRule['rtm/title'].file, 'b.spec.ts');
    assert.equal(byRule['rtm/title'].line, 3);
  });
  // met·future·deferred 는 진단이 없다
  withRtm(
    rtmJson('INT-3', { requirements: [req('FR-A-1', 'met'), req('FR-A-2', 'future'), req('FR-A-3', 'deferred')] }),
    'INT-3',
    (dir) => assert.equal(run(dir, '--int', 'INT-3').status, 0),
  );
});

test('UT-GATE-190 INT-3 미만에서는 모든 진단이 warn(exit 0)이고 INT-3부터 error(exit 1)다(v-mismatch는 항상 warn) [PR-018][NFR-MAINT-011]', () => {
  const body = (int) =>
    rtmJson(int, {
      requirements: [req('FR-AI-001', 'orphan'), req('FR-AI-002', 'unmet', 'Must', [{ id: 'UT-1', status: 'fail' }])],
      unknown_refs: [{ test: 'UT-X-001', ref: 'FR-FOO-999', file: 'a.spec.ts', line: 7 }],
      v_mismatch: [{ id: 'FR-AI-002', rtm: 'a', manifest: 'b' }],
    });
  for (const int of ['INT-1a', 'INT-1b', 'INT-2']) {
    withRtm(body(int), int, (dir) => {
      const res = run(dir, '--int', int);
      assert.equal(res.status, 0, int);
      assert.equal(res.json.errors, 0);
      assert.equal(res.json.warnings, 4);
    });
  }
  for (const int of ['INT-3', 'INT-4', 'INT-7']) {
    withRtm(body(int), int, (dir) => {
      const res = run(dir, '--int', int);
      assert.equal(res.status, 1, int);
      assert.equal(res.json.errors, 3);
      assert.equal(res.json.warnings, 1);
    });
  }
});

test('UT-GATE-191 rtm/orphan은 Must만 대상이고 PG-3에서는 Should 고아도 error다 [PR-018][NFR-MAINT-011]', () => {
  const body = (int) =>
    rtmJson(int, {
      requirements: [
        req('FR-AI-001', 'met'),
        req('FR-AI-002', 'orphan', 'Should'),
        req('FR-AI-003', 'orphan', 'Could'),
      ],
    });
  withRtm(body('INT-4'), 'INT-4', (dir) =>
    assert.equal(run(dir, '--int', 'INT-4').status, 0, 'Should 고아는 INT-4까지 통과'),
  );
  withRtm(body('PG-3'), 'PG-3', (dir) => {
    const res = run(dir, '--int', 'PG-3');
    assert.equal(res.status, 1);
    assert.deepEqual(
      res.json.violations.map((v) => `${v.rule}:${v.message.split(':')[0]}`),
      ['rtm/orphan:FR-AI-002'],
      'Could 는 PG-3에서도 대상 아님',
    );
  });
});

test('UT-GATE-192 rtm.json 부재·version 오류·int 불일치·requirements 0개·--int 누락/오류는 exit 2다 [PR-018][NFR-MAINT-011]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-rtm-'));
  try {
    assert.equal(run(dir, '--int', 'INT-3').status, 2, 'rtm.json 부재');
    assert.match(run(dir, '--int', 'INT-3').json.error, /^engine\/input-missing: rtm\.json not found/);
    assert.equal(run(dir).status, 2, '--int 필수');
    assert.match(run(dir).json.error, /^engine\/usage: /);
    assert.equal(run(dir, '--int', 'INT-9').status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  withRtm({ ...rtmJson('INT-3'), version: 2 }, 'INT-3', (d) => {
    const res = run(d, '--int', 'INT-3');
    assert.equal(res.status, 2);
    assert.match(res.json.error, /version must be 1/);
  });
  withRtm(rtmJson('INT-2'), 'INT-3', (d) => {
    const res = run(d, '--int', 'INT-3');
    assert.equal(res.status, 2);
    assert.match(res.json.error, /int mismatch/);
  });
  withRtm(rtmJson('INT-3', { requirements: [] }), 'INT-3', (d) => {
    const res = run(d, '--int', 'INT-3');
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/no-files: /);
  });
  withRtm('{ not json', 'INT-3', (d) => assert.equal(run(d, '--int', 'INT-3').status, 2));
});

test('UT-GATE-193 --in 으로 입력 디렉터리를 바꿀 수 있고 텍스트 출력 형식이 계약대로다 [PR-018][NFR-MAINT-011]', () => {
  withRtm(rtmJson('INT-3', { requirements: [req('FR-AI-001', 'orphan')] }), 'INT-3', (dir) => {
    assert.equal(run(dir, '--int', 'INT-3', '--in', 'custom').status, 2, '기본 위치가 아니라 --in 위치를 본다');
  });
  withRtm(
    rtmJson('INT-3', { requirements: [req('FR-AI-001', 'orphan')] }),
    'INT-3',
    (dir) => {
      const text = spawnSync(process.execPath, [GATE, '--root', dir, '--int', 'INT-3', '--in', '.reports/INT-3'], {
        encoding: 'utf8',
      });
      assert.equal(text.status, 1);
      assert.match(text.stdout, /^\(repo\):0 {2}error {2}rtm\/orphan {2}FR-AI-001: /m);
      assert.match(text.stdout, /\[check:rtm\] 1 error\(s\), 0 warning\(s\), 1 file\(s\)\n$/);
    },
    '.reports/INT-3/rtm.json',
  );
  withRtm(rtmJson('INT-3'), 'INT-3', (dir) => {
    const abs = path.join(dir, '.reports', 'INT-3');
    assert.equal(run(dir, '--int', 'INT-3', '--in', abs).status, 0, '절대 경로 --in');
  });
});
