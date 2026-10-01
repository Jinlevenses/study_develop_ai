#!/usr/bin/env node
// ported-from: spikes/sp7-static-gates/src/check-boundaries.mjs (audit-fixed: 엔진 예외·스캔 0파일·tsconfig 부재 → exit 2, tokens·tsgo·both만 유지(lexer·regex·es-module-lexer 제거), 설정 파일 boundaries.json, 규칙 16종)
// check:boundaries (NFR-MAINT-001·002·003, QAS-20) — 단위 간 import·서비스 내부 경계·DB 경로·내장 모듈 제한.
//   tokens : lib/lex.mjs 어휘 분석기(주석·문자열 인식, TS·TSX 허용)
//   tsgo   : typescript/unstable/sync 모듈 해석(별칭·exports·심볼릭 링크) — 실패는 강등 없이 exit 2
//   both   : tokens ∪ tsgo (CI 기본)
// 사용: node tools/gates/check-boundaries.mjs [--root <dir>] [--engine=tokens|tsgo|both] [--config <path>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { hasEscape, isMain, runGate, SRC_EXT } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { matchAny, matchGlob } from './lib/glob.mjs';
import { extractImports } from './lib/imports.mjs';
import { callArgs, tokenize } from './lib/lex.mjs';
import { openProject } from './lib/tsgo.mjs';
import { isAllowed, loadBoundaries, unitOf } from './lib/units.mjs';
import { isExcludedPath, walk } from './lib/walk.mjs';

const ESCAPABLE_RULES = new Set(['boundary/nonliteral-import', 'boundary/require', 'boundary/create-require']);
const BC_ALT = 'http|application|domain';
const BC_DIRS = `(?:${BC_ALT})`;
const PORTS_RE = /^ports(?:\.d)?(?:\.(?:ts|mts|js|mjs))?$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 대상 단위 해석. 단위('services/b' …)·'spikes'·'builtin'·'external'·null(단위 밖 상대 경로). */
export function targetUnit(spec, fromRel) {
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
    return abs === '..' || abs.startsWith('../') ? null : unitOf(abs);
  }
  if (spec.startsWith('node:') || isBuiltin(spec)) {
    return 'builtin';
  }
  const scoped = /^@fathom\/([^/]+)/.exec(spec);
  if (scoped) {
    const name = scoped[1];
    for (const [prefix, dir] of [
      ['svc-', 'services'],
      ['app-', 'apps'],
      ['tool-', 'tools'],
    ]) {
      if (name.startsWith(prefix)) {
        return `${dir}/${name.slice(prefix.length)}`;
      }
    }
    return `packages/${name}`;
  }
  if (/^(?:services|apps|packages|tools|spikes)\//.test(spec) || spec.startsWith('tests/')) {
    return unitOf(spec);
  }
  if (spec.startsWith('/') || spec.startsWith('file:')) {
    return null;
  }
  return 'external';
}

/** 상대 specifier의 root 기준 정규화 경로(확장자 그대로). 상대가 아니거나 root 밖이면 null. */
function relTarget(spec, fromRel) {
  if (!(spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../'))) {
    return null;
  }
  const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  return abs === '..' || abs.startsWith('../') ? null : abs;
}

function specAllowed(spec, patterns) {
  return patterns.some((p) => (p.endsWith('/*') ? spec.startsWith(p.slice(0, -1)) : spec === p));
}

/**
 * 한 import 지점의 판정(tokens·tsgo 두 엔진 공용). 탈출구(`// boundary-ok:`) 처리는 파일 수준(checkFile)이 한다.
 * @param {{fromRel: string, spec: string|null, resolvedRel?: string|null, kind: string, typeOnly?: boolean, line: number}} imp
 */
export function evaluateImport(imp, cfg) {
  const { fromRel, spec, kind, line } = imp;
  const typeOnly = imp.typeOnly === true;
  const out = [];
  const add = (rule, message) => out.push({ file: fromRel, line, rule, message, severity: 'error' });

  if (kind === 'nonliteral-import' || kind === 'nonliteral-require') {
    add(
      'boundary/nonliteral-import',
      `${kind}: specifier is not a string literal (cannot verify); use a literal or // boundary-ok: <reason>`,
    );
  } else if (kind === 'create-require') {
    add(
      'boundary/create-require',
      'createRequire() bypasses static import checks; use import or // boundary-ok: <reason>',
    );
  } else if (kind === 'require') {
    add('boundary/require', `require("${spec}") is forbidden in ESM code; use import or // boundary-ok: <reason>`);
  }
  if (spec === null || spec === undefined) {
    return out;
  }

  const own = unitOf(fromRel);
  const resolvedOk = typeof imp.resolvedRel === 'string' && !imp.resolvedRel.includes('node_modules/');
  const resolvedUnit = resolvedOk ? unitOf(imp.resolvedRel) : null;
  const tgt = resolvedUnit ?? targetUnit(spec, fromRel);
  const tgtRel = resolvedUnit ? imp.resolvedRel : relTarget(spec, fromRel);

  // 단위 간 규칙
  if (tgt === 'spikes') {
    add(
      'boundary/spikes-import',
      `${fromRel} imports spikes/** via "${spec}" (${kind}); port by copy instead (STD-DIR-07)`,
    );
  } else if (own === null && tgt && (tgt.startsWith('services/') || tgt.startsWith('apps/'))) {
    // 단위 밖 파일(루트 vitest.config.ts·playwright.config.ts 등)은 packages/* 만 허용 — 서비스·앱 import 는 전 파일 규칙(Brief 4.1.3)
    add(
      'boundary/cross-service-import',
      `${fromRel} (outside any unit) imports ${tgt} via "${spec}" (${kind}); only packages/* allowed`,
    );
  } else if (own && tgt && tgt !== 'builtin' && tgt !== 'external' && tgt !== own) {
    if (tgt === cfg.test_only.unit) {
      if (!matchAny(fromRel, cfg.test_only.allowed_from)) {
        add(
          'boundary/testkit-in-src',
          `${own} imports ${tgt} via "${spec}" outside test paths (${cfg.test_only.allowed_from.join(', ')})`,
        );
      }
    } else if (!isAllowed(cfg, own, tgt, fromRel)) {
      const rule =
        tgt.startsWith('services/') || tgt.startsWith('apps/')
          ? 'boundary/cross-service-import'
          : 'boundary/unit-not-allowed';
      add(rule, `${own} -> ${tgt} via "${spec}" (${kind}) is not allowed by config/boundaries.json`);
    }
  }

  // intra 규칙: <unit>/src/** 파일에만
  if (!own || own === 'tests' || own === 'spikes' || !fromRel.startsWith(`${own}/src/`)) {
    return out;
  }
  const intra = cfg.intra;
  if (own === 'packages/contracts' && tgt === 'builtin') {
    add('boundary/contracts-builtin', `packages/contracts/src must stay pure (zod only); imports builtin "${spec}"`);
  }
  if (spec === 'node:sqlite' && !matchAny(fromRel, intra.sqlite_direct.allow)) {
    add(
      'boundary/sqlite-direct',
      `node:sqlite may only be imported from ${intra.sqlite_direct.allow.join(', ')}; use openDb()`,
    );
  }
  if (tgt === 'builtin') {
    const name = spec.replace(/^node:/, '').split('/')[0];
    const allowed = intra.builtin_restricted[name];
    if (allowed && !matchAny(fromRel, allowed)) {
      add('boundary/builtin-restricted', `"${spec}" is restricted to ${allowed.join(', ')}`);
    }
  }
  const bcList = intra.bc[own];
  if (bcList) {
    const from = new RegExp(`^${escapeRe(own)}/src/${BC_DIRS}/([^/]+)/`).exec(fromRel);
    const to = tgtRel ? new RegExp(`^${escapeRe(own)}/src/(${BC_ALT})/([^/]+)(?:/(.*))?$`).exec(tgtRel) : null;
    if (from && to && bcList.includes(from[1]) && bcList.includes(to[2]) && from[1] !== to[2]) {
      const portsTypeOnly = to[1] === 'application' && PORTS_RE.test(to[3] ?? '') && typeOnly;
      if (!portsTypeOnly) {
        add(
          'boundary/bc-cross',
          `${own} BC "${from[1]}" imports BC "${to[2]}" via "${spec}"; only \`import type\` of application/<bc>/ports.ts is allowed`,
        );
      }
    }
  }
  const gnc = intra.grading_no_catalog;
  if (tgtRel && matchGlob(fromRel, gnc.from)) {
    if (new RegExp(`^${escapeRe(own)}/src/${BC_DIRS}/${escapeRe(gnc.forbid_bc)}(?:/|$)`).test(tgtRel)) {
      add(
        'boundary/grading-no-catalog',
        `grading must not import the ${gnc.forbid_bc} BC (via "${spec}", ports included)`,
      );
    }
  }
  const dm = new RegExp(`^${escapeRe(own)}/src/domain/([^/]+)/`).exec(fromRel);
  if (dm) {
    const dp = intra.domain_pure;
    const sameBc = tgtRel?.startsWith(`${own}/src/domain/${dm[1]}/`) ?? false;
    const third = (dp.third_party[own] ?? []).some((p) => spec === p || spec.startsWith(`${p}/`));
    if (!sameBc && !specAllowed(spec, dp.allow_packages) && !third) {
      add('boundary/domain-impure', `domain/${dm[1]} must stay pure; imports "${spec}"`);
    }
  }
  for (const mod of intra.sk_pure.modules) {
    if (fromRel.startsWith(`${mod}/`) && !tgtRel?.startsWith(`${mod}/`)) {
      add('boundary/sk-pure', `${mod} must stay self-contained; imports "${spec}"`);
    }
  }
  const root = intra.web_feature_cross.root;
  const wf = new RegExp(`^${escapeRe(root)}/([^/]+)/`).exec(fromRel);
  const wt = tgtRel ? new RegExp(`^${escapeRe(root)}/([^/]+)/`).exec(tgtRel) : null;
  if (wf && wt && wf[1] !== wt[1]) {
    add('boundary/web-feature-cross', `web feature "${wf[1]}" imports feature "${wt[1]}" via "${spec}"`);
  }
  return out;
}

/** `new DatabaseSync(<인자>)` 검사: db-path(타 단위 파일, 전 파일) · sqlite-direct(src 한정). */
function checkDatabaseSync(rel, src, cfg) {
  const out = [];
  const own = unitOf(rel);
  const { tokens } = tokenize(src);
  const shared = new Set(['packages/contracts', 'packages/shared-kernel', 'packages/design-tokens']);
  for (let i = 1; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (!(t.t === 'id' && t.v === 'DatabaseSync' && tokens[i + 1].v === '(' && tokens[i - 1].v === 'new')) {
      continue;
    }
    const inSrc = own && own !== 'tests' && own !== 'spikes' && rel.startsWith(`${own}/src/`);
    if (inSrc && !matchAny(rel, cfg.intra.sqlite_direct.allow)) {
      out.push({
        file: rel,
        line: t.line,
        rule: 'boundary/sqlite-direct',
        message: 'new DatabaseSync() is only allowed in shared-kernel sqlite/service; use openDb()',
        severity: 'error',
      });
    }
    const { args } = callArgs(tokens, i + 1);
    const flat = args[0] ?? [];
    const strs = flat.filter((x) => x.t === 'str').map((x) => x.v);
    if (!own || strs.length === 0) {
      continue;
    }
    const usesDir =
      flat.some((x) => x.t === 'id' && (x.v === '__dirname' || x.v === 'dirname')) ||
      flat.some((x, k) => x.v === 'import' && flat[k + 2]?.v === 'dirname');
    const joined = strs.length === 1 && strs[0].includes('/') ? strs[0] : strs.join('/');
    const abs = path.posix.normalize(usesDir ? path.posix.join(path.posix.dirname(rel), joined) : joined);
    const tu = unitOf(abs.replace(/^\.\//, ''));
    if (tu && tu !== own && !shared.has(tu)) {
      out.push({
        file: rel,
        line: t.line,
        rule: 'boundary/db-path',
        message: `${own} opens a DB file owned by ${tu} ("${abs}")`,
        severity: 'error',
      });
    }
  }
  return out;
}

/** 한 파일 검사. resolve(spec) → root 기준 해석 경로|null (tsgo 엔진). */
export function checkFile(rel, src, cfg, resolve = null) {
  const lines = src.split('\n');
  const out = [];
  for (const imp of extractImports(src)) {
    const resolvedRel = resolve && imp.spec !== null ? resolve(imp.spec) : null;
    for (const viol of evaluateImport({ fromRel: rel, ...imp, resolvedRel }, cfg)) {
      if (ESCAPABLE_RULES.has(viol.rule) && hasEscape(lines, viol.line, 'boundary-ok')) {
        continue;
      }
      out.push(viol);
    }
  }
  out.push(...checkDatabaseSync(rel, src, cfg));
  return out;
}

function runTokens(root, cfg) {
  const files = walk(root, { exts: SRC_EXT });
  const violations = [];
  for (const f of files) {
    violations.push(...checkFile(f, readFileSync(path.join(root, f), 'utf8'), cfg));
  }
  return { files: files.length, violations };
}

async function runTsgo(root, cfg) {
  let SyntaxKind;
  try {
    ({ SyntaxKind } = await import('typescript/unstable/ast'));
  } catch (e) {
    throw new GateEngineError(
      'engine/tsgo',
      `cannot load typescript/unstable/ast: ${String(e.message).split('\n')[0]}`,
    );
  }
  const p = await openProject(root);
  const violations = [];
  let scanned = 0;
  try {
    for (const abs of p.files) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (isExcludedPath(rel)) {
        continue;
      }
      const sf = p.program.getSourceFile(abs);
      if (!sf) {
        continue;
      }
      scanned++;
      const resolved = new Map();
      const handle = (spec) => {
        if (resolved.has(spec.text)) {
          return;
        }
        const sym = p.checker.getSymbolAtLocation(spec);
        const symPath = sym?.name?.replace(/^"|"$/g, '');
        resolved.set(
          spec.text,
          symPath && path.isAbsolute(symPath) ? path.relative(root, symPath).split(path.sep).join('/') : null,
        );
      };
      for (const spec of sf.imports ?? []) {
        handle(spec);
      }
      const visit = (n) => {
        const isCall =
          n.kind === SyntaxKind.CallExpression &&
          n.arguments?.length === 1 &&
          (n.expression.kind === SyntaxKind.ImportKeyword ||
            (n.expression.kind === SyntaxKind.Identifier && n.expression.text === 'require')) &&
          (n.arguments[0].kind === SyntaxKind.StringLiteral ||
            n.arguments[0].kind === SyntaxKind.NoSubstitutionTemplateLiteral);
        if (isCall) {
          handle(n.arguments[0]);
        }
        n.forEachChild(visit);
      };
      visit(sf);
      violations.push(...checkFile(rel, readFileSync(abs, 'utf8'), cfg, (spec) => resolved.get(spec) ?? null));
    }
  } finally {
    p.close();
  }
  return { files: scanned, violations };
}

/** 엔진 실행. both = tokens ∪ tsgo(files = tokens 파일 수). tsgo 실패는 강등 없이 던진다. */
export async function runBoundaries(root, cfg, engine) {
  if (engine === 'tokens') {
    return runTokens(root, cfg);
  }
  if (engine === 'tsgo') {
    return runTsgo(root, cfg);
  }
  const t = runTokens(root, cfg);
  const g = await runTsgo(root, cfg);
  return { files: t.files, violations: [...t.violations, ...g.violations] };
}

if (isMain(import.meta.url)) {
  await runGate(
    { id: 'check:boundaries', requireUnits: true, spec: { options: ['engine', 'config'] } },
    async (opts) => {
      const engine = opts.get('engine') ?? 'tokens';
      if (!['tokens', 'tsgo', 'both'].includes(engine)) {
        throw new GateEngineError('engine/usage', `--engine must be tokens|tsgo|both (got ${engine})`);
      }
      const cfgArg = opts.get('config');
      const cfg = loadBoundaries(cfgArg ? path.resolve(cfgArg) : undefined);
      const res = await runBoundaries(opts.root, cfg, engine);
      return { files: res.files, violations: res.violations, extra: { engine } };
    },
  );
}
