#!/usr/bin/env node
// check:gate-selftest (AP-15, ADR-010 §3, STD-TST-11) — 모든 게이트를 fixture로 자기 검증한다(fail-open 구조적 배제).
//   ① clean → exit 0  ② violations → exit 1 (+ EXPECT 마커 집합 정확 일치)  ③ 빈 root → exit 2  ④ 없는 root → exit 2
//   ⑤ evasions(있으면) → 실행만, EVADES 행을 "한계"로 보고(통과 기준 아님)
// 사용: node tools/gates/check-gate-selftest.mjs [--only <id>] [--allow-missing] [--json] [--quiet] [--root <dir>]
//        (테스트 전용: --registry <json> --gates-dir <dir> --fixtures-dir <dir>)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { compare, loadEvasions, loadExpectations } from './lib/expect.mjs';
import { GATES } from './lib/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PREFIX = 'tools/gates/fixtures';
const CASE_TOKEN = ['$', '{CASE}'].join('');

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** selftest.args.json(문자열 배열, "${CASE}" → 케이스 경로)을 읽는다. 없으면 []. */
function caseArgs(caseDir, replacement) {
  const file = path.join(caseDir, 'selftest.args.json');
  if (!existsSync(file)) {
    return [];
  }
  let arr;
  try {
    arr = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new GateEngineError('engine/config', `invalid ${file}: ${e.message}`);
  }
  if (!Array.isArray(arr) || arr.some((a) => typeof a !== 'string')) {
    throw new GateEngineError('engine/config', `${file} must be an array of strings`);
  }
  return arr.map((a) => a.split(CASE_TOKEN).join(replacement));
}

function runGateScript(script, root, args) {
  const r = spawnSync(process.execPath, [script, '--root', root, '--json', '--quiet', ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  let json = null;
  try {
    json = JSON.parse((r.stdout ?? '').trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { exit: r.error ? 2 : (r.status ?? 2), json, stderr: r.stderr ?? '' };
}

function loadRegistry(file) {
  if (!file) {
    return GATES;
  }
  let arr;
  try {
    arr = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  } catch (e) {
    throw new GateEngineError('engine/config', `cannot load registry ${file}: ${e.message}`);
  }
  if (!Array.isArray(arr)) {
    throw new GateEngineError('engine/config', `registry ${file} must be an array`);
  }
  return arr;
}

/** 게이트 하나를 검사한다. 반환 {violations, evasions}. */
function checkOne(gate, scriptPath, fixturesDir) {
  const violations = [];
  const fixtureRoot = path.join(fixturesDir, gate.fixture);
  const fileOf = (c) => `${FIXTURE_PREFIX}/${gate.fixture}/${c}`;
  const add = (c, rule, message) => violations.push({ file: fileOf(c), line: 0, rule, message, severity: 'error' });
  const baseArgs = gate.args ?? [];
  if (!isDir(fixtureRoot)) {
    violations.push({
      file: `${FIXTURE_PREFIX}/${gate.fixture}`,
      line: 0,
      rule: 'selftest/fixture-missing',
      message: `${gate.id}: fixture directory is missing (STD-TST-11: every gate needs clean/violations/evasions fixtures)`,
      severity: 'error',
    });
    return { violations, evasions: [] };
  }
  const cleanDir = path.join(fixtureRoot, 'clean');
  const violDir = path.join(fixtureRoot, 'violations');
  const evaDir = path.join(fixtureRoot, 'evasions');
  if (!isDir(cleanDir) || !isDir(violDir)) {
    violations.push({
      file: `${FIXTURE_PREFIX}/${gate.fixture}`,
      line: 0,
      rule: 'selftest/fixture-missing',
      message: `${gate.id}: needs both clean/ and violations/ cases`,
      severity: 'error',
    });
    return { violations, evasions: [] };
  }

  // ① clean → 0
  const clean = runGateScript(scriptPath, cleanDir, [...baseArgs, ...caseArgs(cleanDir, cleanDir)]);
  if (clean.exit !== 0) {
    add(
      'clean',
      'selftest/clean-not-zero',
      `${gate.id} on clean fixture exited ${clean.exit}, expected 0${clean.json?.error ? ` (${clean.json.error})` : ''}`,
    );
  }

  // ② violations → 1 + 기대 집합
  const viol = runGateScript(scriptPath, violDir, [...baseArgs, ...caseArgs(violDir, violDir)]);
  if (viol.exit !== 1) {
    add(
      'violations',
      'selftest/violations-not-one',
      `${gate.id} on violations fixture exited ${viol.exit}, expected 1${viol.json?.error ? ` (${viol.json.error})` : ''}`,
    );
  } else {
    const expected = loadExpectations(violDir);
    if (expected.size > 0) {
      const reported = (viol.json?.violations ?? []).filter((v) => v.severity === 'error');
      const { fp, fn } = compare(expected, reported);
      if (fp.length > 0 || fn.length > 0) {
        add(
          'violations',
          'selftest/expect-mismatch',
          `${gate.id}: ${fp.length} unexpected [${fp.join(', ')}], ${fn.length} missing [${fn.join(', ')}]`,
        );
      }
    }
  }

  // ③ 빈 root → 2, ④ 없는 root → 2
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fathom-selftest-'));
  try {
    const empty = runGateScript(scriptPath, tmp, [...baseArgs, ...caseArgs(cleanDir, tmp)]);
    if (empty.exit !== 2) {
      add(
        'clean',
        'selftest/empty-root-not-two',
        `${gate.id} on an empty root exited ${empty.exit}, expected 2 (vacuous pass?)`,
      );
    }
    const missingRoot = path.join(tmp, 'does-not-exist');
    const missing = runGateScript(scriptPath, missingRoot, [...baseArgs, ...caseArgs(cleanDir, missingRoot)]);
    if (missing.exit !== 2) {
      add('clean', 'selftest/missing-root-not-two', `${gate.id} on a missing root exited ${missing.exit}, expected 2`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // ⑤ evasions: 실행만, EVADES 행을 한계로 기록
  let evasions = [];
  if (isDir(evaDir)) {
    runGateScript(scriptPath, evaDir, [...baseArgs, ...caseArgs(evaDir, evaDir)]);
    evasions = loadEvasions(evaDir).map((e) => ({ gate: gate.id, ...e }));
  }
  return { violations, evasions };
}

/** selftest 본체(테스트가 import해 쓸 수 있도록 export). */
export function selftest({ registry, gatesDir, fixturesDir, only, allowMissing }) {
  const violations = [];
  const checked = [];
  const skipped = [];
  const limitations = [];
  const targets = only ? registry.filter((g) => g.id === only) : registry;
  if (only && targets.length === 0) {
    throw new GateEngineError('engine/usage', `--only ${only}: no such gate in the registry`);
  }
  for (const gate of targets) {
    const scriptPath = path.join(gatesDir, gate.script);
    if (!existsSync(scriptPath)) {
      if (allowMissing) {
        skipped.push(gate.id);
        continue;
      }
      throw new GateEngineError('engine/input-missing', `${gate.id}: script ${gate.script} not found in ${gatesDir}`);
    }
    const r = checkOne(gate, scriptPath, fixturesDir);
    violations.push(...r.violations);
    limitations.push(...r.evasions);
    checked.push(gate.id);
  }
  return { files: checked.length, violations, extra: { checked, skipped, limitations } };
}

if (isMain(import.meta.url)) {
  await runGate(
    {
      id: 'check:gate-selftest',
      requireUnits: false,
      spec: { flags: ['allow-missing'], options: ['only', 'registry', 'gates-dir', 'fixtures-dir'] },
    },
    (opts) =>
      selftest({
        registry: loadRegistry(opts.get('registry')),
        gatesDir: path.resolve(opts.get('gates-dir') ?? HERE),
        fixturesDir: path.resolve(opts.get('fixtures-dir') ?? path.join(HERE, 'fixtures')),
        only: opts.get('only'),
        allowMissing: opts.has('allow-missing'),
      }),
  );
}
