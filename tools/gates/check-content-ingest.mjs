#!/usr/bin/env node
// check:content-ingest (FR-CUR-002·020, STD-DIR-20, DB-01 §5.1) — 서빙 테이블(ct_*·ib_*)은 단일 수입 포트(writers)에서만 쓴다.
//   ingest/write-location  서빙 테이블 쓰기문이 writers 밖(overlay 테이블은 overlay_writers에서도 허용)
//   ingest/replace         INSERT OR REPLACE INTO · REPLACE INTO(어디서든: 내용 주소 행 덮어쓰기 금지)
// 사용: node tools/gates/check-content-ingest.mjs [--root <dir>] [--config <path>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { srcFiles } from './check-security-scan.mjs';
import { loadSqlConfig, normalizeSql, sqlLiterals } from './check-sql-template.mjs';
import { isMain, runGate } from './lib/common.mjs';
import { matchAny } from './lib/glob.mjs';
import { tokenize } from './lib/lex.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 서빙 테이블 쓰기문 정규식(전역): 그룹 1 = 연산, 그룹 2 = 테이블. */
function writeRegex(tables) {
  const alt = [...tables]
    .map((t) => escapeRe(t.toUpperCase()))
    .sort((a, b) => b.length - a.length)
    .join('|');
  return new RegExp(`(INSERT (?:OR \\w+ )?INTO|REPLACE INTO|UPDATE(?: OR \\w+)?|DELETE FROM) "?(${alt})\\b`, 'g');
}

/** 한 파일 검사. */
export function checkFile(rel, src, cfg) {
  const out = [];
  const ci = cfg.content_ingest;
  const re = writeRegex(ci.serving_tables);
  const overlay = new Set(ci.overlay_tables.map((t) => t.toUpperCase()));
  const inWriters = matchAny(rel, ci.writers);
  const inOverlay = matchAny(rel, ci.overlay_writers);
  const { tokens } = tokenize(src);
  for (const { text, line } of sqlLiterals(tokens)) {
    const n = normalizeSql(text);
    for (const m of n.matchAll(re)) {
      const op = m[1];
      const table = m[2].toLowerCase();
      const allowedHere = inWriters || (overlay.has(m[2]) && inOverlay);
      if (!allowedHere) {
        out.push({
          file: rel,
          line,
          rule: 'ingest/write-location',
          message: `${op} ${table}: serving tables are written only by the single import port (STD-DIR-20, DB-01 §5.1)`,
          severity: 'error',
        });
      }
      if (op.includes('REPLACE')) {
        out.push({
          file: rel,
          line,
          rule: 'ingest/replace',
          message: `${op} ${table}: content-addressed rows are never overwritten (SP-3 audit)`,
          severity: 'error',
        });
      }
    }
  }
  return out;
}

export async function analyze(root, opts = {}) {
  const cfg = loadSqlConfig(opts.config);
  const files = srcFiles(root);
  const violations = [];
  for (const f of files) {
    violations.push(...checkFile(f, readFileSync(path.join(root, f), 'utf8'), cfg));
  }
  return { files: files.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:content-ingest', requireUnits: true, spec: { options: ['config'] } }, (o) =>
    analyze(o.root, { config: o.get('config') ? path.resolve(o.get('config')) : undefined }),
  );
}
