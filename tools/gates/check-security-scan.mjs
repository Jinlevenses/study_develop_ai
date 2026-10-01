#!/usr/bin/env node
// check:security (NFR-SEC-010·011, STD-SEC-35, CR-60) — 위험 API·비밀 리터럴 어휘 스캔. 탈출구 없음(STD-AGT-14).
//   범위: {apps,services,packages,tools}/*/src/** (SRC_EXT). 비밀 리터럴 규칙만 test/**·tests/**·evals/**의 텍스트 파일도 본다.
//   판정은 lib/lex.mjs 토큰 기준 — 주석·문자열 안의 단어는 식별자로 보지 않는다(`secret-literal`·`weak-hash`만 문자열을 본다).
// 사용: node tools/gates/check-security-scan.mjs [--root <dir>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, runGate, SRC_EXT } from './lib/common.mjs';
import { callArgs, deepTokens, matchClose, tokenize } from './lib/lex.mjs';
import { walk } from './lib/walk.mjs';

const SRC_INCLUDE = ['apps/*/src/**', 'services/*/src/**', 'packages/*/src/**', 'tools/*/src/**'];
const SECRET_SCAN_INCLUDE = [
  '{apps,services,packages,tools}/*/test/**',
  'tests/**',
  'evals/**',
  '{apps,services,packages,tools}/*/src/**',
];
const SECRET_EXTS = ['.ts', '.tsx', '.mjs', '.json', '.yaml', '.yml', '.md', '.txt'];
const SECRET_EXCLUDE = ['evals/sets/secrets-50/**'];
const SECRET_PATTERNS = [
  /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /sk-(proj-)?[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /ghp_[A-Za-z0-9]{36}/,
  /AKIA[0-9A-Z]{16}/,
];
const CHILD_PROCESS = new Set(['child_process', 'node:child_process']);
const URL_MODULES = new Set(['url', 'node:url']);

// 소스 파일 목록(공유 헬퍼, Brief §4.1-3): apps·services·packages·tools 단위의 src 아래 파일 중 exts.
export function srcFiles(root, exts = SRC_EXT) {
  return walk(root, { exts, include: SRC_INCLUDE });
}

const isP = (t, v) => t !== undefined && t.t === 'p' && t.v === v;
const isId = (t, v) => t !== undefined && t.t === 'id' && (v === undefined || t.v === v);
const isMember = (prev) => prev !== undefined && prev.t === 'p' && (prev.v === '.' || prev.v === '?.');

/** `import … from '<mod>'` 구문의 절 토큰 수집: [{mod, line, named: [{imported, local, line}], binding: string|null}]. */
function importClauses(tokens, modules) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (!(isId(t, 'from') && tokens[i + 1]?.t === 'str' && modules.has(tokens[i + 1].v)) || isMember(tokens[i - 1])) {
      continue;
    }
    let k = i - 1;
    while (k >= 0 && !(isId(tokens[k], 'import') || isP(tokens[k], ';'))) {
      k--;
    }
    if (k < 0 || !isId(tokens[k], 'import')) {
      continue;
    }
    const clause = tokens.slice(k + 1, i);
    const named = [];
    let binding = null;
    for (let c = 0; c < clause.length; c++) {
      const x = clause[c];
      if (isP(x, '{')) {
        for (c++; c < clause.length && !isP(clause[c], '}'); c++) {
          if (clause[c].t !== 'id' || clause[c].v === 'type') {
            continue;
          }
          const imported = clause[c].v;
          let local = imported;
          if (isId(clause[c + 1], 'as') && clause[c + 2]?.t === 'id') {
            local = clause[c + 2].v;
            c += 2;
          }
          named.push({ imported, local, line: clause[c].line });
        }
      } else if (isP(x, '*') && isId(clause[c + 1], 'as') && clause[c + 2]?.t === 'id') {
        binding = clause[c + 2].v;
        c += 2;
      } else if (x.t === 'id' && x.v !== 'type' && binding === null && !isP(clause[c - 1], '{')) {
        binding = x.v;
      }
    }
    out.push({ mod: tokens[i + 1].v, line: tokens[i + 1].line, named, binding });
  }
  return out;
}

/** `name(` 호출처럼 보이는 위치가 메서드 정의·시그니처(`fetch(x) {`, `eval(x): void`)인지. */
function isMethodDefinition(tokens, openIdx) {
  const close = matchClose(tokens, openIdx);
  const after = tokens[close + 1];
  const before = tokens[openIdx - 2];
  return isP(after, '{') || (isP(after, ':') && before !== undefined && before.t === 'p' && ['{', ',', ';'].includes(before.v));
}

/** 소스 한 파일의 위험 API 판정. */
export function scanSource(rel, src) {
  const out = [];
  const add = (line, rule, message) => out.push({ file: rel, line, rule, message, severity: 'error' });
  const { tokens: top, lineOf } = tokenize(src);
  const all = [...deepTokens(top)];

  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    const prev = all[i - 1];
    const next = all[i + 1];
    if (t.t === 'id') {
      if (t.v === 'eval' && isP(next, '(')) {
        if ((!isMember(prev) || (isP(prev, '.') && isId(all[i - 2], 'globalThis'))) && !isMethodDefinition(all, i + 1)) {
          add(t.line, 'security/eval', 'eval() executes arbitrary code (STD-SEC-35)');
        }
      } else if (t.v === 'new' && isId(next, 'Function') && isP(all[i + 2], '(')) {
        add(t.line, 'security/new-function', 'new Function() executes arbitrary code (STD-SEC-35)');
      } else if (t.v === 'shell' && isP(next, ':') && isId(all[i + 2], 'true')) {
        add(t.line, 'security/shell-true', 'shell: true runs a shell; use safeSpawn(shell:false) (STD-SEC-35)');
      } else if (t.v === 'dangerouslySetInnerHTML') {
        add(t.line, 'security/dangerously-set-inner-html', 'dangerouslySetInnerHTML is forbidden (STD-SEC-35)');
      } else if (t.v === 'NODE_TLS_REJECT_UNAUTHORIZED') {
        add(t.line, 'security/tls-reject-env', 'NODE_TLS_REJECT_UNAUTHORIZED must not be touched (STD-SEC-35)');
      } else if (t.v === 'rejectUnauthorized' && isP(next, ':') && isId(all[i + 2], 'false')) {
        add(t.line, 'security/reject-unauthorized', 'rejectUnauthorized: false disables TLS verification');
      } else if (
        t.v === 'Buffer' &&
        isP(next, '.') &&
        (isId(all[i + 2], 'allocUnsafe') || isId(all[i + 2], 'allocUnsafeSlow'))
      ) {
        add(t.line, 'security/buffer-alloc-unsafe', `Buffer.${all[i + 2].v} leaks uninitialised memory`);
      } else if ((t.v === 'innerHTML' || t.v === 'outerHTML') && isMember(prev)) {
        add(t.line, 'security/inner-html', `.${t.v} access is forbidden (XSS); render with the UI components`);
      } else if (t.v === 'insertAdjacentHTML') {
        add(t.line, 'security/insert-adjacent-html', 'insertAdjacentHTML is forbidden (XSS)');
      } else if (
        t.v === 'document' &&
        isP(next, '.') &&
        (isId(all[i + 2], 'write') || isId(all[i + 2], 'writeln')) &&
        isP(all[i + 3], '(')
      ) {
        add(t.line, 'security/document-write', `document.${all[i + 2].v}() is forbidden`);
      } else if (t.v === 'Buffer' && isId(prev, 'new') && isP(next, '(')) {
        add(t.line, 'security/new-buffer', 'new Buffer() is deprecated and unsafe; use Buffer.from/alloc');
      } else if (t.v === 'createCipher' && isP(next, '(')) {
        add(t.line, 'security/create-cipher', 'createCipher() is removed/insecure; use createCipheriv');
      } else if (t.v === 'createHash' && isP(next, '(')) {
        const { args } = callArgs(all, i + 1);
        const a = args[0]?.length === 1 ? args[0][0] : undefined;
        const text = a?.t === 'str' ? a.v : a?.t === 'tpl' && a.exprs.length === 0 ? a.quasis[0].v : null;
        if (text !== null && /^(md5|sha1)$/i.test(text)) {
          add(t.line, 'security/weak-hash', `createHash('${text}') is a weak hash`);
        }
      } else if (t.v === 'backup' && isMember(prev) && isP(next, '(')) {
        add(t.line, 'security/sqlite-backup', '.backup() is forbidden (STD-SQL-12): use VACUUM INTO via shared-kernel');
      } else if (t.v === 'Math' && isP(next, '.') && isId(all[i + 2], 'random') && /^services\/[^/]+\/src\/domain\//.test(rel)) {
        add(t.line, 'security/domain-math-random', 'Math.random in domain code: inject an Rng port (STD-TS)');
      } else if (
        t.v === 'url' &&
        !isMember(prev) &&
        isP(next, '.') &&
        isId(all[i + 2], 'parse') &&
        isP(all[i + 3], '(')
      ) {
        add(t.line, 'security/url-parse', 'url.parse() is deprecated and unsafe; use new URL()');
      } else if (t.v === 'fetch' && /^apps\/web\/src\//.test(rel) && !rel.startsWith('apps/web/src/lib/')) {
        if (!isMember(prev) && isP(next, '(') && !isId(prev, 'function') && !isMethodDefinition(all, i + 1)) {
          add(t.line, 'security/web-fetch-outside-lib', 'fetch() in apps/web must go through apps/web/src/lib/**');
        }
      } else if (
        t.v === 'EventSource' &&
        isId(prev, 'new') &&
        /^apps\/web\/src\//.test(rel) &&
        !rel.startsWith('apps/web/src/lib/')
      ) {
        add(t.line, 'security/web-fetch-outside-lib', 'new EventSource() in apps/web must live in apps/web/src/lib/**');
      }
    } else if (t.t === 'str' || t.t === 'tpl') {
      const texts = t.t === 'str' ? [t.v] : t.quasis.map((q) => q.v);
      if (texts.some((s) => s.includes('NODE_TLS_REJECT_UNAUTHORIZED'))) {
        add(t.line, 'security/tls-reject-env', 'NODE_TLS_REJECT_UNAUTHORIZED must not be touched (STD-SEC-35)');
      }
    }
  }

  // child_process.exec/execSync, url.parse via imports
  for (const c of importClauses(top, CHILD_PROCESS)) {
    for (const n of c.named) {
      if (n.imported === 'exec' || n.imported === 'execSync') {
        add(n.line, 'security/child-process-exec', `${n.imported}() runs through a shell; use safeSpawn(shell:false)`);
      }
    }
    if (c.binding) {
      for (let i = 0; i < all.length - 3; i++) {
        if (
          isId(all[i], c.binding) &&
          !isMember(all[i - 1]) &&
          isP(all[i + 1], '.') &&
          (isId(all[i + 2], 'exec') || isId(all[i + 2], 'execSync')) &&
          isP(all[i + 3], '(')
        ) {
          add(all[i].line, 'security/child-process-exec', `${c.binding}.${all[i + 2].v}() runs through a shell`);
        }
      }
    }
  }
  for (const c of importClauses(top, URL_MODULES)) {
    for (const n of c.named) {
      if (n.imported === 'parse') {
        for (let i = 0; i < all.length - 1; i++) {
          if (isId(all[i], n.local) && !isMember(all[i - 1]) && isP(all[i + 1], '(') && !isId(all[i - 1], 'function')) {
            add(all[i].line, 'security/url-parse', 'url.parse() is deprecated and unsafe; use new URL()');
          }
        }
      }
    }
    if (c.binding && c.binding !== 'url') {
      for (let i = 0; i < all.length - 3; i++) {
        if (
          isId(all[i], c.binding) &&
          !isMember(all[i - 1]) &&
          isP(all[i + 1], '.') &&
          isId(all[i + 2], 'parse') &&
          isP(all[i + 3], '(')
        ) {
          add(all[i].line, 'security/url-parse', 'url.parse() is deprecated and unsafe; use new URL()');
        }
      }
    }
  }

  // secret literals (strings and template pieces)
  const visitPieces = (tokens) => {
    for (const t of tokens) {
      if (t.t === 'str') {
        secretCheck(t.v, t.line);
      } else if (t.t === 'tpl') {
        for (const q of t.quasis) {
          secretCheck(q.v, lineOf(q.s));
        }
        for (const ex of t.exprs) {
          visitPieces(ex.tokens);
        }
      }
    }
  };
  const secretCheck = (text, line) => {
    if (SECRET_PATTERNS.some((re) => re.test(text))) {
      add(line, 'security/secret-literal', 'secret-looking literal in source (STD-SEC-35)');
    }
  };
  visitPieces(top);
  return out;
}

/** 텍스트 파일의 비밀 리터럴(줄 단위). */
export function scanSecretText(rel, text) {
  const out = [];
  text.split('\n').forEach((l, idx) => {
    if (SECRET_PATTERNS.some((re) => re.test(l))) {
      out.push({
        file: rel,
        line: idx + 1,
        rule: 'security/secret-literal',
        message: 'secret-looking literal in test/eval data (CR-60)',
        severity: 'error',
      });
    }
  });
  return out;
}

export async function analyze(root) {
  const srcs = srcFiles(root, SRC_EXT);
  const srcSet = new Set(srcs);
  const violations = [];
  for (const f of srcs) {
    violations.push(...scanSource(f, readFileSync(path.join(root, f), 'utf8')));
  }
  const extra = walk(root, { exts: SECRET_EXTS, include: SECRET_SCAN_INCLUDE, exclude: SECRET_EXCLUDE });
  for (const f of extra) {
    if (srcSet.has(f)) {
      continue; // 이미 토큰 기준으로 검사함
    }
    violations.push(...scanSecretText(f, readFileSync(path.join(root, f), 'utf8')));
  }
  const files = new Set([...srcs, ...extra]).size;
  return { files, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:security', requireUnits: true, spec: {} }, (o) => analyze(o.root));
}
