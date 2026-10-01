// ported-from: spikes/sp7-static-gates/src/lib/common.mjs (audit-fixed: 엔진 예외 → exit 2, 스캔 0파일 → exit 2, isMain Windows 대응, process.exit 단일 지점, severity 필드)
import { statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GateEngineError } from './errors.mjs';
import { readJsonc as readJsoncImpl } from './jsonc.mjs';
import { formatJson, formatText } from './report.mjs';
import { assertExpectedUnits } from './units.mjs';

export const SRC_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * 인자 파서. spec = { flags: [...], options: [...] }. `json`·`quiet`(플래그)와 `root`(옵션)는 항상 허용.
 * `--x=v`·`--x v` 둘 다. spec에 없는 인자 → GateEngineError('engine/usage').
 */
export function parseArgs(argv = process.argv.slice(2), spec = {}) {
  const flags = new Set(['json', 'quiet', ...(spec.flags ?? [])]);
  const options = new Set(['root', ...(spec.options ?? [])]);
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      throw new GateEngineError('engine/usage', `unexpected argument: ${a}`);
    }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (flags.has(name)) {
      if (eq >= 0) {
        throw new GateEngineError('engine/usage', `flag --${name} takes no value`);
      }
      values.set(name, true);
    } else if (options.has(name)) {
      if (eq >= 0) {
        values.set(name, a.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new GateEngineError('engine/usage', `option --${name} needs a value`);
        }
        values.set(name, next);
        i++;
      }
    } else {
      throw new GateEngineError('engine/usage', `unknown option: --${name}`);
    }
  }
  const root = path.resolve(values.has('root') ? String(values.get('root')) : process.cwd());
  return {
    root,
    json: values.get('json') === true,
    quiet: values.get('quiet') === true,
    get: (name) => values.get(name),
    has: (name) => values.has(name),
  };
}

/** 진단 정규화: severity 기본 error, 같은 (file,line,rule) 1건, file→line→rule 정렬. */
function normalize(violations) {
  const seen = new Set();
  const out = [];
  for (const v of violations) {
    const k = `${v.file}\u0000${v.line}\u0000${v.rule}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push({ file: v.file, line: v.line, rule: v.rule, message: v.message, severity: v.severity ?? 'error' });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  out.sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.rule, b.rule));
  return out;
}

/** (내부) 결과를 출력하고 종료 코드를 설정한다. process.exit 호출은 이 한 곳(STD-ERR-20). */
function finish(id, { json, quiet }, result) {
  if (json) {
    process.stdout.write(`${formatJson(id, result)}\n`);
  } else if (result.exit === 2) {
    process.stderr.write(`${formatText(id, result)}\n`);
  } else {
    process.stdout.write(`${formatText(id, result, { quiet })}\n`);
  }
  process.exitCode = result.exit;
  process.exit(result.exit);
}

function lenientOutput(argv) {
  const rootIdx = argv.findIndex((a) => a === '--root' || a.startsWith('--root='));
  let root = process.cwd();
  if (rootIdx >= 0) {
    const a = argv[rootIdx];
    const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[rootIdx + 1];
    if (v) {
      root = v;
    }
  }
  return { json: argv.includes('--json'), quiet: argv.includes('--quiet'), root: path.resolve(root) };
}

/**
 * 모든 게이트의 실행 틀. meta = {id, requireUnits, spec}. fn(opts) → {files, violations, extra?}.
 * 엔진 예외·스캔 0파일·root 없음 → exit 2, 위반(error) ≥ 1 → exit 1, 그 밖 0.
 */
export async function runGate(meta, fn, argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv, meta.spec);
  } catch (e) {
    const lenient = lenientOutput(argv);
    return finish(meta.id, lenient, { root: lenient.root, exit: 2, error: describe(e) });
  }
  try {
    let st;
    try {
      st = statSync(opts.root);
    } catch (e) {
      throw new GateEngineError('engine/no-root', `root not found: ${opts.root} (${e.code ?? e.message})`);
    }
    if (!st.isDirectory()) {
      throw new GateEngineError('engine/no-root', `root is not a directory: ${opts.root}`);
    }
    if (meta.requireUnits) {
      assertExpectedUnits(opts.root);
    }
    const res = await fn(opts);
    if (!res || !Number.isInteger(res.files) || res.files <= 0) {
      throw new GateEngineError('engine/no-files', `scanned 0 files under ${opts.root} — refusing a vacuous pass`);
    }
    const violations = normalize(res.violations);
    const exit = violations.some((v) => v.severity === 'error') ? 1 : 0;
    return finish(meta.id, opts, { root: opts.root, exit, files: res.files, violations, extra: res.extra });
  } catch (e) {
    return finish(meta.id, opts, { root: opts.root, exit: 2, error: describe(e) });
  }
}

function describe(e) {
  if (e instanceof GateEngineError) {
    return `${e.code}: ${e.message}`;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return `engine/exception: ${msg.split('\n')[0]}`;
}

/** JSON(주석·끝 쉼표 허용) 읽기. 부재·파싱 실패 → GateEngineError('engine/config'). 구현은 jsonc.mjs(units.mjs와의 순환 방지). */
export const readJsonc = readJsoncImpl;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 탈출구 주석 검사. 같은 줄 또는 바로 윗줄에 `// <tag>: <사유>`(사유 = 공백 제외 1자 이상)가 있으면 true.
 * @param {string[]|string} lines 소스 줄(0-based 배열 또는 전체 문자열)
 * @param {number} line 1-based 줄 번호
 * @param {string} tag 예: 'boundary-ok', 'sql-ok', 'biome-ignore lint/plugin'
 */
export function hasEscape(lines, line, tag) {
  const arr = typeof lines === 'string' ? lines.split('\n') : lines;
  const re = new RegExp(`//\\s*${escapeRe(tag)}:\\s*\\S`);
  for (const idx of [line - 1, line - 2]) {
    if (idx >= 0 && idx < arr.length && re.test(arr[idx])) {
      return true;
    }
  }
  return false;
}

/** camelCase / PascalCase / kebab / snake / SCREAMING → 소문자 snake. */
export function snake(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

/** 이 모듈이 진입점으로 실행됐는가(Windows 경로·심볼릭 링크 안전). */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  return typeof entry === 'string' && importMetaUrl === pathToFileURL(path.resolve(entry)).href;
}
