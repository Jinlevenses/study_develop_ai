#!/usr/bin/env node
// check:jev-index  -- STD-01 "객체 키 참조 lint (Jev 배열 인덱스 금지)"  (FR-AI-005, SP-1 precondition: all Jev references are object keys)
// Scope (Jev code): path contains /jev/, file name *.jev.*, or file imports @typesafe-ai/sdk. Prompt files (.md/.txt) under /jev/ too.
// Rules:
//   jev/index-literal  candidates[3], options.at(0), res.items[2]      (identifier from CANDIDATE_NAME, literal index)   error
//   jev/index-var      units[i]                                          (identifier from CANDIDATE_NAME, variable index)  warn
//   jev/index-string   "item 2", "항목 2번", "3번째 보기", "second candidate", "candidates[3]" in string/template/prompt text   error
//   jev/index-interp   `${i + 1}. ${c}` / `[${idx}]`  numbering candidates by position inside a template               error
//   jev/index-field    { index: 0 } / best_index / selectedIndex  (positional field in a Jev response/format schema)     error
import { parseArgs, walk, read, SRC_EXT, finish } from "./lib/common.mjs";
import { tokenize, stringPieces, deepTokens } from "./lib/lex.mjs";

const CANDIDATE_NAME = /^(candidates?|options?|choices?|units?|items?|answers?|claims?|statements?|criteria|criterions?|rubrics?|responses?|\w*(Candidates|Options|Choices|Units|Items|Answers|Claims|Statements))$/i;
const INDEX_VARS = new Set(["i", "j", "k", "idx", "index", "n", "pos"]);
const INDEX_FIELD = /^(index|idx|position|ordinal|\w+_(index|idx|position)|\w+(Index|Idx|Position))$/;
const NOUN = "(?:items?|options?|choices?|candidates?|units?|claims?|statements?|answers?|criteri(?:on|a))";
const KO_NOUN = "(?:항목|선택지|보기|후보|문항|단위|유닛|주장|진술)";
const STRING_RULES = [
  new RegExp(`\\b${NOUN}\\s*#?\\s*\\d+\\b`, "i"),                                   // item 2, option #3
  new RegExp(`${KO_NOUN}\\s*#?\\s*\\d+`),                                            // 항목 2, 선택지 3
  /\d+\s*번째/,                                                                       // 3번째
  new RegExp(`\\d+\\s*번\\s*${KO_NOUN}`),                                            // 2번 항목
  new RegExp(`\\b(?:first|second|third|fourth|fifth|last)\\s+${NOUN}\\b`, "i"),     // the second candidate
  new RegExp(`\\b\\d+(?:st|nd|rd|th)\\s+${NOUN}\\b`, "i"),                        // the 2nd option
  new RegExp(`\\b\\w*${NOUN}\\s*\\[\\s*\\d+\\s*\\]`, "i"),                           // candidates[3]
];

const isJevScope = (rel, tokens) =>
  /(^|\/)jev\//i.test(rel) || /\.jev\.[a-z]+$/i.test(rel) ||
  tokens.some((t, i) => t.t === "id" && t.v === "from" && tokens[i + 1]?.t === "str" && /^@typesafe-ai\/sdk|^@fathom\/shared-kernel\/jev/.test(tokens[i + 1].v));

export function checkSource(rel, src) {
  const v = [];
  const { tokens, lineOf } = tokenize(src);
  if (!isJevScope(rel, tokens)) return v;
  const all = [...deepTokens(tokens)];
  // 1. positional access on candidate-like identifiers
  for (let i = 0; i < all.length - 3; i++) {
    const t = all[i];
    if (t.t !== "id" || !CANDIDATE_NAME.test(t.v)) continue;
    const n = all[i + 1];
    if (n.v === "[" && n.t === "p") {
      const idx = all[i + 2], close = all[i + 3];
      if (idx.t === "num" && close.v === "]") v.push({ file: rel, line: t.line, rule: "jev/index-literal", message: `${t.v}[${idx.v}]: reference items by object key, not array position` });
      else if (idx.t === "id" && INDEX_VARS.has(idx.v) && close.v === "]") v.push({ file: rel, line: t.line, level: "warn", rule: "jev/index-var", message: `${t.v}[${idx.v}]: positional lookup inside Jev code; prefer keyed record` });
    } else if (n.v === "." && all[i + 2]?.v === "at" && all[i + 3]?.v === "(" && all[i + 4]?.t === "num") {
      v.push({ file: rel, line: t.line, rule: "jev/index-literal", message: `${t.v}.at(${all[i + 4].v}): positional access` });
    }
  }
  // 2. strings / template text
  for (const p of stringPieces(tokens, lineOf)) {
    for (const re of STRING_RULES) if (re.test(p.text)) { v.push({ file: rel, line: p.line, rule: "jev/index-string", message: `string refers to an item by position (${re.source.slice(0, 40)}...)` }); break; }
  }
  // 3. template numbering `${i + 1}`
  for (const t of all) {
    if (t.t !== "tpl") continue;
    for (const ex of t.exprs) {
      const e = ex.tokens;
      if (e.length >= 1 && e[0].t === "id" && INDEX_VARS.has(e[0].v) && (e.length === 1 || (e.length === 3 && (e[1].v === "+" || e[1].v === "-") && e[2].t === "num")))
        v.push({ file: rel, line: t.line, rule: "jev/index-interp", message: `template numbers an item by position (\${${e.map((x) => x.v).join(" ")}}); interpolate the object key instead` });
    }
  }
  // 4. positional response fields
  for (let i = 1; i < all.length - 1; i++) {
    const t = all[i];
    if ((t.t === "id" || t.t === "str") && INDEX_FIELD.test(t.v) && all[i + 1].v === ":" && ["{", ",", ";"].includes(all[i - 1].v))
      v.push({ file: rel, line: t.line, rule: "jev/index-field", message: `positional field "${t.v}" in a Jev format/schema; use a key field` });
  }
  return v;
}

export function checkText(rel, text) {
  const v = [];
  text.split("\n").forEach((l, idx) => {
    for (const re of STRING_RULES) if (re.test(l)) { v.push({ file: rel, line: idx + 1, rule: "jev/index-string", message: "prompt text refers to an item by position" }); break; }
  });
  return v;
}

export function run(root) {
  const files = walk(root, new Set([...SRC_EXT, ".md", ".txt", ".prompt"]));
  const out = [];
  for (const f of files) {
    if (/\.(md|txt|prompt)$/.test(f)) { if (/(^|\/)jev\//i.test(f)) out.push(...checkText(f, read(root, f))); }
    else out.push(...checkSource(f, read(root, f)));
  }
  return { files: files.length, violations: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs();
  const { files, violations } = run(opts.root);
  finish("check:jev-index", opts.root, violations, opts, { files });
}
