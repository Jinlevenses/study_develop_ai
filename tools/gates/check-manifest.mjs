#!/usr/bin/env node
// check:manifest (FR-STD-033, UR-14, D-WBS-09, CR-68) — 학습 모드 매니페스트의 6계열·E2E·렌더러 레지스트리 정합.
//   manifest/schema · family-missing · e2e-missing · e2e-deferred · renderer-missing · renderer-key · renderer-formats-unverified(warn) · schedule-missing-mode(warn)
//   "기한 도래" 모드 = status included ∧ (--schedule 없음 또는 compareInt(schedule.modes[id], --int) ≤ 0)
// 사용: node tools/gates/check-manifest.mjs [--root <dir>] [--manifest <path>] [--int <id>] [--schedule <path>] [--registry <path>]
//        [--domain <path>] [--mode-formats <json>] [--json] [--quiet]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { compareInt, isIntId } from './lib/int.mjs';
import { matchClose, tokenize } from './lib/lex.mjs';
import { walk } from './lib/walk.mjs';

const FAMILIES = ['개념이해', '실습', '문제', '개념 디깅', 'OX', '백지노트'];
const STATUSES = ['included', 'deferred'];
/** IF-01 고정 BlockKind. */
const BLOCK_KINDS = [
  'lesson',
  'items',
  'blank_note',
  'dialog',
  'lab',
  'case',
  'artifact',
  'jol',
  'reflection',
  'triage',
];
const MODE_FIELDS = ['mode_id', 'name_ko', 'ur14_family', 'offline_path', 'e2e_ids', 'status'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isP = (t, v) => t !== undefined && t.t === 'p' && t.v === v;

function readJson(abs, what) {
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    throw new GateEngineError('engine/input-missing', `${what} not found: ${abs} (${e.code ?? e.message})`);
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch (e) {
    throw new GateEngineError('engine/input-missing', `${what} is not valid JSON: ${abs} (${e.message})`);
  }
}

/** `SCN-nn` → `E2E-0nn`, 그 밖에는 그대로. */
export function resolveE2eId(id) {
  const m = /^SCN-(\d{2})$/.exec(id);
  return m ? `E2E-0${m[1]}` : id;
}

/** 레지스트리: 첫 `= {` 객체 리터럴의 깊이 1 키와 각 값 객체 안의 `e2e_id: '<ID>'`. 파일 없음 = []. */
export function parseRegistry(src) {
  const { tokens } = tokenize(src);
  let open = -1;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (isP(tokens[i], '=') && isP(tokens[i + 1], '{')) {
      open = i + 1;
      break;
    }
  }
  if (open < 0) {
    return [];
  }
  const close = matchClose(tokens, open);
  const entries = [];
  let k = open + 1;
  while (k < close) {
    const key = tokens[k];
    if ((key.t === 'id' || key.t === 'str') && isP(tokens[k + 1], ':')) {
      // 값 범위: 다음 깊이 0 쉼표 또는 닫는 중괄호
      let d = 0;
      let j = k + 2;
      for (; j < close; j++) {
        const x = tokens[j];
        if (x.t === 'p' && '([{'.includes(x.v)) {
          d++;
        } else if (x.t === 'p' && ')]}'.includes(x.v)) {
          d--;
        } else if (d === 0 && x.t === 'p' && x.v === ',') {
          break;
        }
      }
      let e2e = null;
      for (let m = k + 2; m < j - 2; m++) {
        if (tokens[m].t === 'id' && tokens[m].v === 'e2e_id' && isP(tokens[m + 1], ':') && tokens[m + 2].t === 'str') {
          e2e = tokens[m + 2].v;
          break;
        }
      }
      entries.push({ key: key.v, e2e_id: e2e, line: key.line });
      k = j + 1;
    } else {
      k++;
    }
  }
  return entries;
}

/** domain.ts에서 `FormatId = z.enum([ … ])` 문자열 목록. */
export function parseFormatIds(src) {
  const { tokens } = tokenize(src);
  for (let i = 0; i < tokens.length - 3; i++) {
    if (tokens[i].t === 'id' && tokens[i].v === 'FormatId' && isP(tokens[i + 1], '=')) {
      let k = i + 2;
      while (k < tokens.length && !isP(tokens[k], '[')) {
        if (isP(tokens[k], ';')) {
          break;
        }
        k++;
      }
      if (isP(tokens[k], '[')) {
        const close = matchClose(tokens, k);
        return tokens
          .slice(k + 1, close)
          .filter((t) => t.t === 'str')
          .map((t) => t.v);
      }
    }
  }
  return null;
}

/** tests/e2e/**\/*.spec.ts 의 `E2E-nnn ` 로 시작하는 문자열 → Set<'E2E-nnn'>. */
export function collectE2eTitles(root) {
  const ids = new Set();
  for (const f of walk(root, { exts: ['.ts'], include: ['tests/e2e/**'] }).filter((x) => x.endsWith('.spec.ts'))) {
    const { tokens } = tokenize(readFileSync(path.join(root, f), 'utf8'));
    const visit = (list) => {
      for (const t of list) {
        const texts = t.t === 'str' ? [t.v] : t.t === 'tpl' ? t.quasis.slice(0, 1).map((q) => q.v) : [];
        for (const s of texts) {
          const m = /^(E2E-\d{3}) /.exec(s);
          if (m) {
            ids.add(m[1]);
          }
        }
        if (t.t === 'tpl') {
          t.exprs.forEach((ex) => {
            visit(ex.tokens);
          });
        }
      }
    };
    visit(tokens);
  }
  return ids;
}

/** 매니페스트 형식 검사 → 문제 목록 [{message, needle}]. */
export function validateManifest(json) {
  const problems = [];
  const p = (message, needle) => problems.push({ message, needle });
  if (!isObject(json)) {
    p('manifest must be a JSON object');
    return problems;
  }
  if (json.version !== 1) {
    p(`version must be 1 (got ${JSON.stringify(json.version)})`, '"version"');
  }
  if (!Array.isArray(json.modes)) {
    p('modes must be an array', '"modes"');
    return problems;
  }
  const seen = new Set();
  json.modes.forEach((m, i) => {
    if (!isObject(m)) {
      p(`modes[${i}] must be an object`);
      return;
    }
    const needle = typeof m.mode_id === 'string' ? `"${m.mode_id}"` : undefined;
    for (const f of MODE_FIELDS) {
      if (!(f in m)) {
        p(`modes[${i}]: missing field "${f}"`, needle);
      }
    }
    if ('mode_id' in m && !(typeof m.mode_id === 'string' && /^M-\d{2}$/.test(m.mode_id))) {
      p(`modes[${i}].mode_id must match ^M-\\d{2}$`, '"mode_id"');
    }
    if (typeof m.mode_id === 'string') {
      if (seen.has(m.mode_id)) {
        p(`duplicate mode_id ${m.mode_id}`, needle);
      }
      seen.add(m.mode_id);
    }
    for (const f of ['name_ko', 'offline_path']) {
      if (f in m && !(typeof m[f] === 'string' && m[f] !== '')) {
        p(`modes[${i}].${f} must be a non-empty string`, needle);
      }
    }
    if ('ur14_family' in m && !FAMILIES.includes(m.ur14_family)) {
      p(`modes[${i}].ur14_family must be one of ${FAMILIES.join(', ')}`, needle);
    }
    if ('e2e_ids' in m && !(Array.isArray(m.e2e_ids) && m.e2e_ids.every((x) => typeof x === 'string'))) {
      p(`modes[${i}].e2e_ids must be an array of strings`, needle);
    }
    if ('status' in m && !STATUSES.includes(m.status)) {
      p(`modes[${i}].status must be one of ${STATUSES.join(', ')}`, needle);
    }
  });
  return problems;
}

const lineOfNeedle = (lines, needle) => {
  if (!needle) {
    return 1;
  }
  const i = lines.findIndex((l) => l.includes(needle));
  return i >= 0 ? i + 1 : 1;
};

export function analyze(root, opts = {}) {
  const manifestAbs = path.resolve(root, opts.manifest ?? 'packages/contracts/manifests/modes.manifest.json');
  const manifestRel = path.relative(root, manifestAbs).split(path.sep).join('/');
  const { text, json } = readJson(manifestAbs, 'modes manifest');
  const lines = text.split('\n');
  const violations = [];
  const add = (line, rule, message, severity = 'error') =>
    violations.push({ file: manifestRel, line, rule, message, severity });

  // 옵션 검증
  if (opts.int !== undefined && !isIntId(opts.int)) {
    throw new GateEngineError('engine/usage', `--int must be one of INT-1a..INT-7, PG-3 (got ${opts.int})`);
  }
  let schedule = null;
  if (opts.schedule !== undefined) {
    if (opts.int === undefined) {
      throw new GateEngineError('engine/usage', '--schedule requires --int');
    }
    schedule = readJson(path.resolve(root, opts.schedule), 'mode schedule').json;
    if (!isObject(schedule) || schedule.version !== 1 || !isObject(schedule.modes)) {
      throw new GateEngineError(
        'engine/input-missing',
        'mode-schedule.json must be {version: 1, modes: {<M-nn>: <INT>}}',
      );
    }
  }
  let modeFormats = null;
  if (opts.modeFormats !== undefined) {
    modeFormats = readJson(path.resolve(root, opts.modeFormats), 'mode-formats').json;
    if (!isObject(modeFormats)) {
      throw new GateEngineError('engine/input-missing', '--mode-formats must be a JSON object {<M-nn>: [format…]}');
    }
  }

  // 1. 스키마
  const problems = validateManifest(json);
  for (const pr of problems) {
    add(lineOfNeedle(lines, pr.needle), 'manifest/schema', pr.message);
  }
  if (!isObject(json) || !Array.isArray(json.modes)) {
    return { files: 1, violations };
  }
  const modes = json.modes.filter((m) => isObject(m) && typeof m.mode_id === 'string');
  const included = modes.filter((m) => m.status === 'included');

  // 2. 6계열
  for (const fam of FAMILIES) {
    if (!included.some((m) => m.ur14_family === fam)) {
      add(1, 'manifest/family-missing', `UR-14 family "${fam}" has no included mode`);
    }
  }

  // 3. 기한 도래 모드
  const due = included.filter((m) => {
    if (schedule === null) {
      return true;
    }
    const first = schedule.modes[m.mode_id];
    if (typeof first !== 'string' || !isIntId(first)) {
      add(
        lineOfNeedle(lines, `"${m.mode_id}"`),
        'manifest/schedule-missing-mode',
        `${m.mode_id} is included but absent from the mode schedule`,
        'warn',
      );
      return false;
    }
    return compareInt(first, opts.int) <= 0;
  });

  // 4. E2E 제목
  const titles = collectE2eTitles(root);
  const e2eOf = (m) =>
    Array.isArray(m.e2e_ids) ? m.e2e_ids.filter((x) => typeof x === 'string').map(resolveE2eId) : [];
  for (const m of due) {
    const missing = e2eOf(m).filter((id) => !titles.has(id));
    if (missing.length > 0) {
      add(
        lineOfNeedle(lines, `"${m.mode_id}"`),
        'manifest/e2e-missing',
        `${m.mode_id}: no E2E title for ${missing.join(', ')} under tests/e2e/**`,
      );
    }
  }
  for (const m of modes.filter((x) => x.status === 'deferred')) {
    const present = e2eOf(m).filter((id) => /^E2E-3\d\d$/.test(id) && titles.has(id));
    if (present.length > 0) {
      add(
        lineOfNeedle(lines, `"${m.mode_id}"`),
        'manifest/e2e-deferred',
        `${m.mode_id} is deferred but ${present.join(', ')} exists: E2E = the included set`,
      );
    }
  }

  // 5. 렌더러 레지스트리
  const registryAbs = path.resolve(root, opts.registry ?? 'apps/web/src/features/practice/renderers/registry.ts');
  const entries = existsSync(registryAbs) ? parseRegistry(readFileSync(registryAbs, 'utf8')) : [];
  const registryRel = path.relative(root, registryAbs).split(path.sep).join('/');
  for (const m of due) {
    const ids = new Set(e2eOf(m));
    if (!entries.some((e) => e.e2e_id !== null && ids.has(e.e2e_id))) {
      add(
        lineOfNeedle(lines, `"${m.mode_id}"`),
        'manifest/renderer-missing',
        `${m.mode_id}: no renderer registry entry with e2e_id in [${[...ids].join(', ')}] (${registryRel})`,
      );
    }
  }
  if (existsSync(registryAbs) && entries.length > 0) {
    const domainAbs = path.resolve(root, opts.domain ?? 'packages/contracts/src/common/domain.ts');
    if (!existsSync(domainAbs)) {
      throw new GateEngineError(
        'engine/input-missing',
        `domain.ts not found: ${path.relative(root, domainAbs)} (needed for FormatId)`,
      );
    }
    const formatIds = parseFormatIds(readFileSync(domainAbs, 'utf8'));
    if (formatIds === null || formatIds.length === 0) {
      throw new GateEngineError(
        'engine/input-missing',
        `${path.relative(root, domainAbs)}: FormatId = z.enum([...]) not found`,
      );
    }
    const allowed = new Set([...formatIds, ...BLOCK_KINDS]);
    for (const e of entries) {
      if (!allowed.has(e.key)) {
        violations.push({
          file: registryRel,
          line: e.line,
          rule: 'manifest/renderer-key',
          message: `registry key "${e.key}" is neither a FormatId nor a BlockKind`,
          severity: 'error',
        });
      }
    }
  }
  if (modeFormats === null) {
    add(
      1,
      'manifest/renderer-formats-unverified',
      'format_candidates ∩ registry keys not verified: run with --mode-formats <json>',
      'warn',
    );
  } else {
    const keys = new Set(entries.map((e) => e.key));
    for (const m of due) {
      const cands = modeFormats[m.mode_id];
      if (Array.isArray(cands) && cands.length > 0 && !cands.some((c) => keys.has(c))) {
        add(
          lineOfNeedle(lines, `"${m.mode_id}"`),
          'manifest/renderer-missing',
          `${m.mode_id}: no registry key among format candidates [${cands.join(', ')}]`,
        );
      }
    }
  }
  return { files: 1, violations };
}

if (isMain(import.meta.url)) {
  await runGate(
    {
      id: 'check:manifest',
      requireUnits: false,
      spec: { options: ['manifest', 'int', 'schedule', 'registry', 'domain', 'mode-formats'] },
    },
    (o) =>
      analyze(o.root, {
        manifest: o.get('manifest'),
        int: o.get('int'),
        schedule: o.get('schedule'),
        registry: o.get('registry'),
        domain: o.get('domain'),
        modeFormats: o.get('mode-formats'),
      }),
  );
}
