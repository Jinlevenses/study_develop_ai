// ported-from: spikes/sp7-static-gates/src/lib/expect.mjs + common.mjs loadExpectations (audit-fixed: EVADES 수집, expect.json 병합, 중립 모듈)
// selftest·테스트 전용 — 게이트 본체는 이 모듈을 import하지 않는다(감사 A.1: 게이트가 기대 마커를 읽으면 채점 독립성이 깨진다).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TEXT_EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.md', '.sql', '.yml', '.yaml', '.txt']);
const SKIP = new Set(['node_modules', '.git']);

function textFiles(caseRoot) {
  const out = [];
  const rec = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!SKIP.has(ent.name)) {
          rec(path.join(abs, ent.name), r);
        }
      } else if (ent.isFile() && TEXT_EXT.has(path.extname(ent.name))) {
        out.push(r);
      }
    }
  };
  rec(caseRoot, '');
  return out.sort();
}

function readExpectJson(caseRoot) {
  try {
    const arr = JSON.parse(readFileSync(path.join(caseRoot, 'expect.json'), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** `EXPECT[<rule>]`(그 줄)·`EXPECT-NEXT[<rule>]`(다음 줄) + expect.json → Set<'file:line:rule'>. */
export function loadExpectations(caseRoot) {
  const exp = new Set();
  for (const f of textFiles(caseRoot)) {
    const lines = readFileSync(path.join(caseRoot, f), 'utf8').split('\n');
    lines.forEach((text, idx) => {
      for (const m of text.matchAll(/EXPECT(-NEXT)?\[([^\]]+)\]/g)) {
        exp.add(`${f}:${idx + 1 + (m[1] ? 1 : 0)}:${m[2]}`);
      }
    });
  }
  for (const e of readExpectJson(caseRoot)) {
    exp.add(`${e.file}:${e.line}:${e.rule}`);
  }
  return exp;
}

/** `EVADES[<rule>]` 행(탐지하지 못하는 알려진 회피) → [{file, line, rule}]. */
export function loadEvasions(caseRoot) {
  const out = [];
  for (const f of textFiles(caseRoot)) {
    const lines = readFileSync(path.join(caseRoot, f), 'utf8').split('\n');
    lines.forEach((text, idx) => {
      for (const m of text.matchAll(/EVADES\[([^\]]+)\]/g)) {
        out.push({ file: f, line: idx + 1, rule: m[1] });
      }
    });
  }
  return out;
}

/** 기대 집합 대 보고 진단 → {tp, fp[], fn[]} (fp = 초과, fn = 누락). */
export function compare(expected, violations) {
  const got = new Set(violations.map((v) => `${v.file}:${v.line}:${v.rule}`));
  const fp = [...got].filter((k) => !expected.has(k)).sort();
  const fn = [...expected].filter((k) => !got.has(k)).sort();
  const tp = [...got].filter((k) => expected.has(k)).length;
  return { tp, fp, fn };
}
