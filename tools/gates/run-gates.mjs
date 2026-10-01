#!/usr/bin/env node
// ported-from: spikes/sp7-static-gates/src/run-gates.mjs (audit-fixed: tsconfig 부재 시 강등 금지 → exit 2(--allow-tokens-only 명시 때만 강등), 레지스트리·단계(g1~g3 누적)·종료 코드 집계, 자식 JSON 파싱 실패 = 2)
// check:gates (PR-005, ADR-010 §2·§10) — 정적 게이트 일괄 실행(CI 진입점).
// 사용: node tools/gates/run-gates.mjs [--stage=g1|g2|g3] [--warn-only] [--allow-tokens-only] [--allow-missing]
//        [--task <T-nn-mm>] [--int <INT-id>] [--base <ref>] [--json] [--root <dir>]
//        (테스트 전용: --registry <json> --gates-dir <dir>)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, parseArgs } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { isIntId } from './lib/int.mjs';
import { GATES, gatesForStage } from './lib/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC = {
  flags: ['warn-only', 'allow-tokens-only', 'allow-missing'],
  options: ['stage', 'task', 'int', 'base', 'registry', 'gates-dir'],
};
const NO_INT = new Set(['INT-7', 'PG-3']);
const SELFTEST_SCRIPT = 'check-gate-selftest.mjs';

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

function withEngineTokens(args) {
  return [...args.filter((a) => !a.startsWith('--engine')), '--engine=tokens'];
}

/** 게이트별 추가 인자(--task·--base·--int·--schedule). */
function extraArgs(gate, o) {
  const extra = [];
  if (gate.id === 'check:scope' || gate.id === 'check:frozen') {
    if (o.task) {
      extra.push('--task', o.task);
    }
    if (o.base) {
      extra.push('--base', o.base);
    }
  }
  if (gate.id === 'check:manifest' || gate.id === 'check:rtm') {
    if (o.int) {
      extra.push('--int', o.int);
    }
    if (gate.id === 'check:manifest' && o.int && !NO_INT.has(o.int)) {
      extra.push('--schedule', 'tests/e2e/mode-schedule.json');
    }
  }
  return extra;
}

function runChild(script, root, args) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [script, '--root', root, '--json', '--quiet', ...args], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  const base = { ms, errors: 0, warnings: 0, files: 0 };
  if (r.error) {
    return {
      ...base,
      exit: 2,
      error: `engine/exception: ${r.error.code === 'ETIMEDOUT' ? 'timeout (120s)' : r.error.message}`,
    };
  }
  let json = null;
  const last = (r.stdout ?? '').trim().split('\n').pop();
  try {
    json = JSON.parse(last);
  } catch {
    json = null;
  }
  if (r.status !== 0 && r.status !== 1 && r.status !== 2) {
    return { ...base, exit: 2, error: `engine/exception: exited with ${r.status ?? r.signal}` };
  }
  if (json === null || typeof json !== 'object') {
    return { ...base, exit: 2, error: 'engine/exception: child stdout is not JSON' };
  }
  if (r.status === 2) {
    return { ...base, exit: 2, error: String(json.error ?? (r.stderr ?? '').trim().split('\n')[0] ?? 'engine error') };
  }
  return { ...base, exit: r.status, errors: json.errors ?? 0, warnings: json.warnings ?? 0, files: json.files ?? 0 };
}

/** 집계 실행. 반환 {stage, warn_only, exit, gates[]}. */
export function runGates(argv) {
  const opts = parseArgs(argv, SPEC);
  const stage = opts.get('stage') ?? 'g2';
  if (!['g1', 'g2', 'g3'].includes(stage)) {
    throw new GateEngineError('engine/usage', `--stage must be g1|g2|g3 (got ${stage})`);
  }
  const o = {
    task: opts.get('task'),
    int: opts.get('int'),
    base: opts.get('base'),
    warnOnly: opts.has('warn-only'),
    allowTokensOnly: opts.has('allow-tokens-only'),
    allowMissing: opts.has('allow-missing'),
  };
  if (o.int !== undefined && !isIntId(o.int)) {
    throw new GateEngineError('engine/usage', `--int must be one of INT-1a|INT-1b|INT-2..INT-7|PG-3 (got ${o.int})`);
  }
  if (stage === 'g3' && o.int === undefined) {
    throw new GateEngineError('engine/usage', '--stage=g3 requires --int <INT-id>');
  }
  let st;
  try {
    st = statSync(opts.root);
  } catch (e) {
    throw new GateEngineError('engine/no-root', `root not found: ${opts.root} (${e.code ?? e.message})`);
  }
  if (!st.isDirectory()) {
    throw new GateEngineError('engine/no-root', `root is not a directory: ${opts.root}`);
  }
  if (!existsSync(path.join(opts.root, 'tsconfig.json'))) {
    if (!o.allowTokensOnly) {
      throw new GateEngineError('engine/tsgo', 'tsconfig.json missing — use --allow-tokens-only for local diagnosis');
    }
  }
  if (o.allowTokensOnly) {
    process.stderr.write(
      '[check:gates] warning: --allow-tokens-only — check:boundaries runs --engine=tokens, check:sql-typed is skipped\n',
    );
  }
  const gatesDir = path.resolve(opts.get('gates-dir') ?? HERE);
  const registry = loadRegistry(opts.get('registry'));
  const list = [];
  list.push({ id: 'check:gate-selftest', script: SELFTEST_SCRIPT, args: o.allowMissing ? ['--allow-missing'] : [] });
  for (const g of gatesForStage(stage, registry)) {
    if (g.id === 'check:scope' && !o.task) {
      continue;
    }
    list.push({ id: g.id, script: g.script, args: [...(g.args ?? []), ...extraArgs(g, o)] });
  }
  const results = [];
  for (const g of list) {
    if (o.allowTokensOnly && g.id === 'check:sql-typed') {
      results.push({
        id: g.id,
        script: g.script,
        exit: 0,
        errors: 0,
        warnings: 0,
        files: 0,
        ms: 0,
        skipped: 'tokens-only',
      });
      continue;
    }
    const script = path.join(gatesDir, g.script);
    if (!existsSync(script)) {
      if (o.allowMissing) {
        process.stderr.write(`[check:gates] warning: ${g.id} skipped — ${g.script} is missing (--allow-missing)\n`);
        results.push({
          id: g.id,
          script: g.script,
          exit: 0,
          errors: 0,
          warnings: 0,
          files: 0,
          ms: 0,
          skipped: 'missing',
        });
      } else {
        results.push({
          id: g.id,
          script: g.script,
          exit: 2,
          errors: 0,
          warnings: 0,
          files: 0,
          ms: 0,
          error: `engine/input-missing: ${g.script} not found in ${gatesDir}`,
        });
      }
      continue;
    }
    const args = o.allowTokensOnly && g.id === 'check:boundaries' ? withEngineTokens(g.args) : g.args;
    results.push({ id: g.id, script: g.script, ...runChild(script, opts.root, args) });
  }
  let exit = 0;
  if (results.some((r) => r.exit === 2)) {
    exit = 2;
  } else if (results.some((r) => r.exit === 1) && !o.warnOnly) {
    exit = 1;
  }
  return { stage, warn_only: o.warnOnly, exit, gates: results, json: opts.json };
}

function rowStatus(r, warnOnly) {
  if (r.skipped) {
    return 'SKIP';
  }
  if (r.exit === 2) {
    return 'ERROR';
  }
  if (r.exit === 1) {
    return warnOnly ? 'WARN' : 'FAIL';
  }
  return 'PASS';
}

export function formatRun(res) {
  if (res.json) {
    return JSON.stringify({
      stage: res.stage,
      warn_only: res.warn_only,
      exit: res.exit,
      gates: res.gates.map((g) => {
        const row = {
          id: g.id,
          script: g.script,
          exit: g.exit,
          errors: g.errors,
          warnings: g.warnings,
          files: g.files,
          ms: g.ms,
        };
        if (g.skipped) {
          row.skipped = g.skipped;
        }
        if (g.error) {
          row.error = g.error;
        }
        return row;
      }),
    });
  }
  const lines = res.gates.map((g) => {
    const tail = g.error ? `  ${g.error}` : g.skipped ? `  (${g.skipped})` : '';
    return `${rowStatus(g, res.warn_only)}  ${g.id.padEnd(22)}  errors=${g.errors} warnings=${g.warnings} files=${g.files}  ${g.ms}ms${tail}`;
  });
  lines.push(`[check:gates] stage=${res.stage} exit=${res.exit}`);
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  let code;
  try {
    const res = runGates(argv);
    process.stdout.write(`${formatRun(res)}\n`);
    code = res.exit;
  } catch (e) {
    const msg =
      e instanceof GateEngineError
        ? `${e.code}: ${e.message}`
        : `engine/exception: ${String(e.message).split('\n')[0]}`;
    if (json) {
      process.stdout.write(`${JSON.stringify({ check: 'check:gates', exit: 2, error: msg })}\n`);
    } else {
      process.stderr.write(`[check:gates] engine error: ${msg}\n`);
    }
    code = 2;
  }
  process.exit(code);
}
