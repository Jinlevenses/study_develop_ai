#!/usr/bin/env node
// check:rtm (PR-018, NFR-MAINT-011, TST §18 ①~④, D-TST-10) — `.reports/<INT>/rtm.json`(tools/si-docs 산출)을 판정한다.
//   rtm/orphan(Must; PG-3에서는 Should도) · rtm/unmet · rtm/untested · rtm/unknown-ref · rtm/title · rtm/v-mismatch(항상 warn)
//   차단 시점: INT-3 미만이면 모든 진단을 warn으로 낮춘다(C-11 "check:rtm INT-3부터 차단").
// 사용: node tools/gates/check-rtm.mjs --int <INT-id> [--in <dir>] [--root <dir>] [--json] [--quiet]   (기본 --in = .reports/<int>)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { compareInt, isIntId } from './lib/int.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function analyze(root, opts) {
  const int = opts.int;
  if (int === undefined) {
    throw new GateEngineError('engine/usage', '--int <INT-id> is required');
  }
  if (!isIntId(int)) {
    throw new GateEngineError('engine/usage', `--int must be one of INT-1a..INT-7, PG-3 (got ${int})`);
  }
  const inDir = path.resolve(root, opts.in ?? path.join('.reports', int));
  const file = path.join(inDir, 'rtm.json');
  if (!existsSync(file)) {
    throw new GateEngineError('engine/input-missing', `rtm.json not found: ${file}`);
  }
  let rtm;
  try {
    rtm = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new GateEngineError('engine/input-missing', `rtm.json is not valid JSON: ${e.message}`);
  }
  if (!isObject(rtm) || rtm.version !== 1) {
    throw new GateEngineError(
      'engine/input-missing',
      `rtm.json version must be 1 (got ${JSON.stringify(rtm?.version)})`,
    );
  }
  if (rtm.int !== int) {
    throw new GateEngineError(
      'engine/input-missing',
      `rtm.json int mismatch: file has ${JSON.stringify(rtm.int)}, --int is ${int}`,
    );
  }
  if (!Array.isArray(rtm.requirements)) {
    throw new GateEngineError('engine/input-missing', 'rtm.json requirements must be an array');
  }
  const blocking = compareInt(int, 'INT-3') >= 0;
  const shouldBlock = int === 'PG-3';
  const violations = [];
  const add = (v, severity = 'error') => violations.push({ ...v, severity: blocking ? severity : 'warn' });
  const req = (r, rule, message, severity) =>
    add({ file: '(repo)', line: 0, rule, message: `${r.id}: ${message}` }, severity);
  for (const r of rtm.requirements) {
    if (!isObject(r)) {
      continue;
    }
    if (r.status === 'orphan' && (r.priority === 'Must' || (shouldBlock && r.priority === 'Should'))) {
      req(
        r,
        'rtm/orphan',
        `${r.priority} requirement has no mapped test (${r.kind ?? 'FR'}, first_int ${r.first_int ?? '?'})`,
      );
    } else if (r.status === 'unmet') {
      const bad = (Array.isArray(r.tests) ? r.tests : []).filter((t) => t?.status === 'fail' || t?.status === 'skip');
      req(
        r,
        'rtm/unmet',
        `mapped tests failed or skipped: ${bad.map((t) => `${t.id}=${t.status}`).join(', ') || '(none listed)'}`,
      );
    } else if (r.status === 'untested') {
      req(r, 'rtm/untested', 'V-build requirement has no result in the ci-build run (tests exist in source only)');
    }
  }
  for (const u of Array.isArray(rtm.unknown_refs) ? rtm.unknown_refs : []) {
    add({
      file: String(u.file ?? '(repo)'),
      line: Number.isInteger(u.line) ? u.line : 0,
      rule: 'rtm/unknown-ref',
      message: `test ${u.test ?? '?'} references unknown requirement ${u.ref ?? '?'}`,
    });
  }
  for (const t of Array.isArray(rtm.title_errors) ? rtm.title_errors : []) {
    add({
      file: String(t.file ?? '(repo)'),
      line: Number.isInteger(t.line) ? t.line : 0,
      rule: 'rtm/title',
      message: `test title error (${t.reason ?? '?'}): ${t.title ?? ''}`,
    });
  }
  for (const m of Array.isArray(rtm.v_mismatch) ? rtm.v_mismatch : []) {
    violations.push({
      file: '(repo)',
      line: 0,
      rule: 'rtm/v-mismatch',
      message: `${m.id}: RTM V "${m.rtm}" differs from verification-class manifest "${m.manifest}"`,
      severity: 'warn',
    });
  }
  return { files: rtm.requirements.length, violations, extra: { int, blocking } };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:rtm', requireUnits: false, spec: { options: ['int', 'in'] } }, (o) =>
    analyze(o.root, { int: o.get('int'), in: o.get('in') }),
  );
}
