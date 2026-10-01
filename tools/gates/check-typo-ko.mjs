#!/usr/bin/env node
// check:typo-ko (NFR-UX-009, DS-01 §12 K1·K2·K6·K7·K10·K11) — 한국어 조판 규칙의 정적 검사.
//   typo-ko/keep-all · no-italic · tabular-nums · px-literal · body-min · measure · design/no-uppercase
// 범위: apps/web/src/** · packages/ui/src/** · packages/design-tokens/src/** 의 .css .ts .tsx. "클래스 토큰" = TS·TSX 문자열·템플릿 조각을 공백으로 나눈 단어.
// 탈출구: `// biome-ignore lint/plugin: <사유>`(CSS는 `/* biome-ignore lint/plugin: <사유> */`) — 사유 필수.
// 사용: node tools/gates/check-typo-ko.mjs [--root <dir>] [--json] [--quiet]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hasEscape, isMain, runGate } from './lib/common.mjs';
import { extractImports } from './lib/imports.mjs';
import { matchClose, stringPieces, tokenize } from './lib/lex.mjs';
import { walk } from './lib/walk.mjs';

const INCLUDE = ['apps/web/src/**', 'packages/ui/src/**', 'packages/design-tokens/src/**'];
const TYPOGRAPHY = 'packages/design-tokens/src/typography.css';
const MARKDOWN_ENTRY = 'apps/web/src/lib/markdown.tsx';
const TAG_ESCAPE = 'biome-ignore lint/plugin';
const CSS_ESCAPE_RE = /biome-ignore\s+lint\/plugin:\s*(?!\*\/)\S/;

const isP = (t, v) => t !== undefined && t.t === 'p' && t.v === v;

/** CSS 주석을 공백으로(오프셋·줄바꿈 보존). */
const maskCss = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** CSS 블록: [{selector, body, bodyStart}] — 가장 안쪽 `선택자 { 선언 }` 단위(@media·@layer 중첩 포함). */
function cssBlocks(masked) {
  const out = [];
  for (const m of masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim(), body: m[2], bodyStart: m.index + m[0].indexOf('{') + 1 });
  }
  return out;
}

const selectorList = (selector) =>
  selector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** CSS 파일 검사. */
export function checkCss(rel, src) {
  const out = [];
  const masked = maskCss(src);
  const rawLines = src.split('\n');
  const lineAt = (pos) => masked.slice(0, pos).split('\n').length;
  const inTokens = rel.startsWith('packages/design-tokens/');
  const add = (line, rule, message) => {
    const escaped = [line, line - 1].some((l) => l >= 1 && CSS_ESCAPE_RE.test(rawLines[l - 1] ?? ''));
    if (!escaped) {
      out.push({ file: rel, line, rule, message, severity: 'error' });
    }
  };
  for (const blk of cssBlocks(masked)) {
    const sels = selectorList(blk.selector);
    for (const d of blk.body.matchAll(/([\w-]+)\s*:\s*([^;]+)(?:;|$)/g)) {
      const prop = d[1].toLowerCase();
      const value = d[2].trim();
      const line = lineAt(blk.bodyStart + d.index + d[0].search(/\S/));
      if (prop === 'word-break' && /^(break-all|normal)\b/.test(value) && !sels.includes('.break-code')) {
        add(line, 'typo-ko/keep-all', `word-break: ${value} is allowed only on .break-code (K1)`);
      }
      if (prop === 'font-style' && /^italic\b/.test(value)) {
        add(line, 'typo-ko/no-italic', 'font-style: italic is forbidden in Korean typography (K6)');
      }
      if (prop === 'text-transform' && /^uppercase\b/.test(value)) {
        add(line, 'design/no-uppercase', 'text-transform: uppercase is forbidden (K10)');
      }
      if (!inTokens) {
        for (const m of value.matchAll(/\b(\d+(?:\.\d+)?)px\b/g)) {
          if (m[1] !== '0' && m[1] !== '1') {
            add(line, 'typo-ko/px-literal', `${m[0]} literal outside design-tokens: use a token (hairline 0px·1px only)`);
          }
        }
      }
      if (prop === 'font-size') {
        const fs = /^(\d+(?:\.\d+)?)px\b/.exec(value);
        if (fs && Number(fs[1]) < 11) {
          add(line, 'typo-ko/body-min', `font-size ${fs[1]}px is below the 11px minimum (K11)`);
        }
      }
    }
  }
  return out;
}

/** typography.css 전역 keep-all 선언 존재 확인(없으면 위반 1건). */
export function checkTypography(root) {
  const abs = path.join(root, TYPOGRAPHY);
  if (!existsSync(abs)) {
    return [
      {
        file: '(repo)',
        line: 0,
        rule: 'typo-ko/keep-all',
        message: `${TYPOGRAPHY} is missing: body { word-break: keep-all } must be declared (K1)`,
        severity: 'error',
      },
    ];
  }
  const masked = maskCss(readFileSync(abs, 'utf8'));
  const ok = cssBlocks(masked).some(
    (b) => selectorList(b.selector).includes('body') && /word-break\s*:\s*keep-all/.test(b.body),
  );
  return ok
    ? []
    : [
        {
          file: TYPOGRAPHY,
          line: 1,
          rule: 'typo-ko/keep-all',
          message: 'no `body { word-break: keep-all }` rule found (K1)',
          severity: 'error',
        },
      ];
}

/** JSX 여는 태그: [{name, from, to}] (from = `<` 인덱스, to = 닫는 `>` 인덱스). */
function jsxOpenTags(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const name = tokens[i + 1];
    if (!isP(t, '<') || name.t !== 'id' || name.s !== t.e) {
      continue;
    }
    // 태그 이름 다음은 `>`·`/`·어트리뷰트(식별자)·`{...props}` 여야 한다(`x <i;`·`a <b && c` 같은 비교 배제)
    const after = tokens[i + 2];
    if (!(after && (isP(after, '>') || isP(after, '/') || isP(after, '{') || after.t === 'id'))) {
      continue;
    }
    const prev = tokens[i - 1];
    // `foo<T>(x)`·`a<b`: 앞 토큰에 바짝 붙은 `<` 는 제네릭·비교
    if (prev && prev.e === t.s && (prev.t === 'id' || prev.t === 'num' || isP(prev, ')') || isP(prev, ']'))) {
      continue;
    }
    let d = 0;
    let end = -1;
    for (let k = i + 2; k < tokens.length; k++) {
      const x = tokens[k];
      if (x.t === 'p') {
        if ('({['.includes(x.v)) {
          d++;
        } else if (')}]'.includes(x.v)) {
          d--;
        } else if (d === 0 && x.v === '>') {
          end = k;
          break;
        }
      }
    }
    if (end > 0) {
      let tag = name.v;
      let k = i + 2;
      while (isP(tokens[k], '.') && tokens[k + 1]?.t === 'id') {
        tag += `.${tokens[k + 1].v}`;
        k += 2;
      }
      out.push({ name: tag, from: i, to: end });
    }
  }
  return out;
}

const classTokens = (texts) => texts.flatMap((s) => s.split(/\s+/)).filter(Boolean);

/** 태그 안 className 어트리뷰트의 클래스 토큰. */
function tagClassTokens(tokens, tag, lineOf) {
  const texts = [];
  for (let k = tag.from; k < tag.to; k++) {
    if (tokens[k].t === 'id' && tokens[k].v === 'className' && isP(tokens[k + 1], '=')) {
      const n = tokens[k + 2];
      if (n?.t === 'str') {
        texts.push(n.v);
      } else if (n?.t === 'tpl') {
        texts.push(...n.quasis.map((q) => q.v));
      } else if (isP(n, '{')) {
        const c = Math.min(matchClose(tokens, k + 2), tag.to);
        for (const p of stringPieces(tokens.slice(k + 3, c), lineOf)) {
          texts.push(p.text);
        }
      }
    }
  }
  return classTokens(texts);
}

/** TS·TSX 파일 검사. */
export function checkSource(rel, src) {
  const out = [];
  const lines = src.split('\n');
  const add = (line, rule, message) => {
    if (!hasEscape(lines, line, TAG_ESCAPE)) {
      out.push({ file: rel, line, rule, message, severity: 'error' });
    }
  };
  const { tokens, lineOf } = tokenize(src);
  const inTokens = rel.startsWith('packages/design-tokens/');

  // 클래스 토큰(모든 문자열·템플릿 조각)
  for (const p of stringPieces(tokens, lineOf)) {
    for (const w of classTokens([p.text])) {
      if (w === 'break-all' || w === 'break-normal') {
        add(p.line, 'typo-ko/keep-all', `class "${w}" breaks Korean words; use .break-code for code only (K1)`);
      } else if (w === 'italic') {
        add(p.line, 'typo-ko/no-italic', 'class "italic" is forbidden in Korean typography (K6)');
      } else if (w === 'uppercase') {
        add(p.line, 'design/no-uppercase', 'class "uppercase" is forbidden (K10)');
      }
      if (!inTokens && /-\[\d+(?:\.\d+)?px\]/.test(w)) {
        add(p.line, 'typo-ko/px-literal', `arbitrary px value "${w}": use a token`);
      }
    }
  }

  // JSX 태그
  for (const tag of jsxOpenTags(tokens)) {
    const line = tokens[tag.from].line;
    if (tag.name === 'i') {
      add(line, 'typo-ko/no-italic', '<i> renders italic; use <em> or font-weight 600 (K6)');
    }
    const inner = tokens.slice(tag.from, tag.to);
    const hasNumeric = inner.some((t, k) => t.t === 'id' && t.v === 'data' && isP(inner[k + 1], '-') && inner[k + 2]?.v === 'numeric');
    if (hasNumeric && !tagClassTokens(tokens, tag, lineOf).includes('num')) {
      add(line, 'typo-ko/tabular-nums', `<${tag.name} data-numeric> lacks the "num" class (tabular-nums, K7)`);
    }
    if (tag.name === 'p' && tagClassTokens(tokens, tag, lineOf).some((c) => ['text-2xs', 'text-xs', 'text-sm'].includes(c))) {
      add(line, 'typo-ko/body-min', '<p> body text below the 15px minimum: text-2xs/xs/sm (K11)');
    }
  }

  // react-markdown 단일 진입(D-STD-23)
  if (rel !== MARKDOWN_ENTRY) {
    for (const imp of extractImports(src)) {
      if (imp.spec === 'react-markdown' || (typeof imp.spec === 'string' && imp.spec.startsWith('react-markdown/'))) {
        add(imp.line, 'typo-ko/measure', `react-markdown may only be imported in ${MARKDOWN_ENTRY} (K2, D-STD-23)`);
      }
    }
  }
  return out;
}

export async function analyze(root) {
  const files = walk(root, { exts: ['.css', '.ts', '.tsx'], include: INCLUDE });
  const violations = [];
  for (const f of files) {
    const text = readFileSync(path.join(root, f), 'utf8');
    violations.push(...(f.endsWith('.css') ? checkCss(f, text) : checkSource(f, text)));
  }
  violations.push(...checkTypography(root));
  return { files: files.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:typo-ko', requireUnits: true, spec: {} }, (o) => analyze(o.root));
}
