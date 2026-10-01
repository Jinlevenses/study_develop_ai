#!/usr/bin/env node
// ported-from: spikes/sp7-static-gates/src/check-jev-index.mjs (audit-fixed: 예외·0파일 → exit 2(runGate), 범위 = Brief 4종, 탈출구 `// jev-ok: <사유>`(사유 필수), 프롬프트 md는 services/*/assets/**까지 walk, warn severity)
// check:jev-index (FR-AI-005, UR-16, IF-EXT-01, STD-DIR-10·11) — Jev 요청·프롬프트는 후보를 위치가 아니라 객체 키로 참조한다.
// 범위: 경로에 `/jev/`가 있는 src 파일 · `*.jev.ts` · `@typesafe-ai/sdk`를 import하는 파일 · `**/jev/prompts/**/*.md`(services/*/assets/** 포함).
// 규칙: jev/index-literal(candidates[3]·options.at(0)) · jev/index-var(warn, units[i]) · jev/index-string("item 2"·"2번 항목") ·
//       jev/index-interp(`${i + 1}.`) · jev/index-field({ index: 0 }·best_index). 탈출구: `// jev-ok: <사유>`.
// 사용: node tools/gates/check-jev-index.mjs [--root <dir>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { srcFiles } from './check-security-scan.mjs';
import { hasEscape, isMain, runGate } from './lib/common.mjs';
import { deepTokens, stringPieces, tokenize } from './lib/lex.mjs';
import { walk } from './lib/walk.mjs';

const CANDIDATE_NAME =
  /^(candidates?|options?|choices?|units?|items?|answers?|claims?|statements?|criteria|criterions?|rubrics?|responses?|\w*(Candidates|Options|Choices|Units|Items|Answers|Claims|Statements))$/i;
const INDEX_VARS = new Set(['i', 'j', 'k', 'idx', 'index', 'n', 'pos']);
const INDEX_FIELD = /^(index|idx|position|ordinal|\w+_(index|idx|position)|\w+(Index|Idx|Position))$/;
const NOUN = '(?:items?|options?|choices?|candidates?|units?|claims?|statements?|answers?|criteri(?:on|a))';
const KO_NOUN = '(?:항목|선택지|보기|후보|문항|단위|유닛|주장|진술)';
const STRING_RULES = [
  new RegExp(`\\b${NOUN}\\s*#?\\s*\\d+\\b`, 'i'), // item 2, option #3
  new RegExp(`${KO_NOUN}\\s*#?\\s*\\d+`), // 항목 2, 선택지 3
  /\d+\s*번째/, // 3번째
  new RegExp(`\\d+\\s*번\\s*${KO_NOUN}`), // 2번 항목
  new RegExp(`\\b(?:first|second|third|fourth|fifth|last)\\s+${NOUN}\\b`, 'i'), // the second candidate
  new RegExp(`\\b\\d+(?:st|nd|rd|th)\\s+${NOUN}\\b`, 'i'), // the 2nd option
  new RegExp(`\\b\\w*${NOUN}\\s*\\[\\s*\\d+\\s*\\]`, 'i'), // candidates[3]
];
const SDK_RE = /^@typesafe-ai\/sdk(?:\/|$)/;
const JEV_PATH_RE = /(^|\/)jev\//i;
const JEV_FILE_RE = /\.jev\.[a-z]+$/i;
const PROMPT_MD_RE = /(^|\/)jev\/prompts\/.+\.md$/i;

const importsSdk = (tokens) =>
  tokens.some((t, i) => t.t === 'id' && t.v === 'from' && tokens[i + 1]?.t === 'str' && SDK_RE.test(tokens[i + 1].v));

/** Jev 범위의 소스 파일 하나 검사. 범위 밖이면 []. */
export function checkSource(rel, src) {
  const out = [];
  const { tokens, lineOf } = tokenize(src);
  if (!(JEV_PATH_RE.test(rel) || JEV_FILE_RE.test(rel) || importsSdk(tokens))) {
    return out;
  }
  const lines = src.split('\n');
  const add = (line, rule, message, severity = 'error') => {
    if (!hasEscape(lines, line, 'jev-ok')) {
      out.push({ file: rel, line, rule, message, severity });
    }
  };
  const all = [...deepTokens(tokens)];
  // 1. 후보 이름 식별자의 위치 접근
  for (let i = 0; i < all.length - 3; i++) {
    const t = all[i];
    if (t.t !== 'id' || !CANDIDATE_NAME.test(t.v)) {
      continue;
    }
    const n = all[i + 1];
    if (n.v === '[' && n.t === 'p') {
      const idx = all[i + 2];
      const close = all[i + 3];
      if (idx.t === 'num' && close.v === ']') {
        add(t.line, 'jev/index-literal', `${t.v}[${idx.v}]: reference items by object key, not array position`);
      } else if (idx.t === 'id' && INDEX_VARS.has(idx.v) && close.v === ']') {
        add(t.line, 'jev/index-var', `${t.v}[${idx.v}]: positional lookup inside Jev code; prefer keyed record`, 'warn');
      }
    } else if (n.v === '.' && all[i + 2]?.v === 'at' && all[i + 3]?.v === '(' && all[i + 4]?.t === 'num') {
      add(t.line, 'jev/index-literal', `${t.v}.at(${all[i + 4].v}): positional access`);
    }
  }
  // 2. 문자열·템플릿 텍스트
  for (const p of stringPieces(tokens, lineOf)) {
    for (const re of STRING_RULES) {
      if (re.test(p.text)) {
        add(p.line, 'jev/index-string', `string refers to an item by position (${re.source.slice(0, 40)}...)`);
        break;
      }
    }
  }
  // 3. 템플릿 번호 매김 `${i + 1}`
  for (const t of all) {
    if (t.t !== 'tpl') {
      continue;
    }
    for (const ex of t.exprs) {
      const e = ex.tokens;
      if (
        e.length >= 1 &&
        e[0].t === 'id' &&
        INDEX_VARS.has(e[0].v) &&
        (e.length === 1 || (e.length === 3 && (e[1].v === '+' || e[1].v === '-') && e[2].t === 'num'))
      ) {
        add(t.line, 'jev/index-interp', `template numbers an item by position (\${${e.map((x) => x.v).join(' ')}}); interpolate the object key instead`);
      }
    }
  }
  // 4. 위치 응답 필드
  for (let i = 1; i < all.length - 1; i++) {
    const t = all[i];
    if (
      (t.t === 'id' || t.t === 'str') &&
      INDEX_FIELD.test(t.v) &&
      all[i + 1].v === ':' &&
      ['{', ',', ';'].includes(all[i - 1].v)
    ) {
      add(t.line, 'jev/index-field', `positional field "${t.v}" in a Jev format/schema; use a key field`);
    }
  }
  return out;
}

/** 프롬프트 md 텍스트 검사. 탈출구: `<!-- jev-ok: <사유> -->` 또는 `// jev-ok: <사유>`(같은 줄·윗줄). */
export function checkText(rel, text) {
  const out = [];
  const lines = text.split('\n');
  const escapeRe = /(?:\/\/|<!--)\s*jev-ok:\s*(?!-->)\S/;
  lines.forEach((l, idx) => {
    for (const re of STRING_RULES) {
      if (re.test(l)) {
        if (!(escapeRe.test(l) || (idx > 0 && escapeRe.test(lines[idx - 1])))) {
          out.push({
            file: rel,
            line: idx + 1,
            rule: 'jev/index-string',
            message: 'prompt text refers to an item by position',
            severity: 'error',
          });
        }
        break;
      }
    }
  });
  return out;
}

export async function analyze(root) {
  const sources = srcFiles(root);
  const prompts = walk(root, {
    exts: ['.md'],
    include: [
      'apps/*/src/**',
      'services/*/src/**',
      'packages/*/src/**',
      'tools/*/src/**',
      'services/*/assets/**',
    ],
  }).filter((f) => PROMPT_MD_RE.test(f));
  const violations = [];
  for (const f of sources) {
    violations.push(...checkSource(f, readFileSync(path.join(root, f), 'utf8')));
  }
  for (const f of prompts) {
    violations.push(...checkText(f, readFileSync(path.join(root, f), 'utf8')));
  }
  return { files: sources.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:jev-index', requireUnits: true, spec: {} }, (o) => analyze(o.root));
}
