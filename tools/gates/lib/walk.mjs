import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { GateEngineError } from './errors.mjs';
import { matchAny } from './glob.mjs';

/** 이름으로 건너뛰는 디렉터리(STD-GATE-04 + Brief 결정). */
export const DEFAULT_EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  'graphify-out',
  '.fathom-dev',
  'playwright-report',
  'test-results',
  '.reports',
];

/** 경로 glob으로 건너뛰는 범위. tools/gates/**(엔진·fixture·테스트)의 자기 검증은 selftest가 맡는다. */
export const DEFAULT_EXCLUDE_GLOBS = [
  'spikes/**',
  'docs/**',
  'tools/gates/**',
  'tools/packc/fixtures/**',
  '**/test/fixtures/**',
];

/** 게이트가 스캔하지 않는 selftest 보조 파일(이름 비교). */
export const SELFTEST_FILES = ['selftest.args.json', 'expect.json'];

const EXCLUDE_DIR_SET = new Set(DEFAULT_EXCLUDE_DIRS);

/** root 기준 posix 상대 경로 `rel`이 스캔 제외 대상인가(파일 경로 기준). */
export function isExcludedPath(rel, extraGlobs = []) {
  const parts = rel.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (EXCLUDE_DIR_SET.has(parts[i])) {
      return true;
    }
  }
  if (SELFTEST_FILES.includes(parts[parts.length - 1])) {
    return true;
  }
  return matchAny(rel, [...DEFAULT_EXCLUDE_GLOBS, ...extraGlobs]);
}

/**
 * root 아래 파일을 정렬된 posix 상대 경로 배열로 돌려준다.
 * @param {string} root
 * @param {{exts?: Set<string>|string[], include?: string[], exclude?: string[]}} [opts]
 */
export function walk(root, opts = {}) {
  const exts = opts.exts ? new Set(opts.exts) : null;
  const include = opts.include ?? null;
  const exclude = opts.exclude ?? [];
  const globs = [...DEFAULT_EXCLUDE_GLOBS, ...exclude];
  let st;
  try {
    st = statSync(root);
  } catch (e) {
    throw new GateEngineError('engine/no-root', `root not found: ${root} (${e.code ?? e.message})`);
  }
  if (!st.isDirectory()) {
    throw new GateEngineError('engine/no-root', `root is not a directory: ${root}`);
  }
  const out = [];
  const rec = (dirAbs, dirRel) => {
    for (const ent of readdirSync(dirAbs, { withFileTypes: true })) {
      const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (EXCLUDE_DIR_SET.has(ent.name) || matchAny(`${rel}/_`, globs)) {
          continue;
        }
        rec(path.join(dirAbs, ent.name), rel);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      if (SELFTEST_FILES.includes(ent.name) || matchAny(rel, globs)) {
        continue;
      }
      if (exts && !exts.has(path.extname(ent.name))) {
        continue;
      }
      if (include && !matchAny(rel, include)) {
        continue;
      }
      out.push(rel);
    }
  };
  rec(root, '');
  return out.sort();
}
