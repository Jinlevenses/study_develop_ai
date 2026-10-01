#!/usr/bin/env node
// check:db-paths (NFR-MAINT-002, AP-01, STD-SQL-13) — 다른 서비스 DB 파일 이름·ATTACH/DETACH 금지.
//   db/foreign-path : 리터럴에 `<name>.db(-wal|-shm)?`가 있고 그 DB의 소유 단위(config/sql.json db_files) ≠ 파일의 단위
//   db/attach       : SQL 리터럴의 ATTACH/DETACH
// 범위: 소스 파일(§4.1-4) 중 db_paths_exempt 제외.
// 사용: node tools/gates/check-db-paths.mjs [--root <dir>] [--config <path>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { srcFiles } from './check-security-scan.mjs';
import { loadSqlConfig, normalizeSql, sqlLiterals } from './check-sql-template.mjs';
import { isMain, runGate } from './lib/common.mjs';
import { matchAny } from './lib/glob.mjs';
import { stringPieces, tokenize } from './lib/lex.mjs';
import { unitOf } from './lib/units.mjs';

const DB_NAME_RE = /(?<![\w.-])(content|learning|insight|ai|ai-cache|ops)\.db(-wal|-shm)?\b/g;
const ATTACH_RE = /\b(ATTACH|DETACH)\s+(DATABASE\s+)?['"?:$]/;

/** 한 파일 검사. */
export function checkFile(rel, src, cfg) {
  const out = [];
  const unit = unitOf(rel);
  const { tokens, lineOf } = tokenize(src);
  for (const p of stringPieces(tokens, lineOf)) {
    for (const m of p.text.matchAll(DB_NAME_RE)) {
      const owner = cfg.db_files[`${m[1]}.db`];
      if (owner !== undefined && owner !== unit) {
        out.push({
          file: rel,
          line: p.line,
          rule: 'db/foreign-path',
          message: `${m[1]}.db belongs to ${owner}; ${unit ?? rel} must not name it (STD-SQL-13)`,
          severity: 'error',
        });
      }
    }
  }
  for (const { text, line } of sqlLiterals(tokens)) {
    if (ATTACH_RE.test(normalizeSql(text))) {
      out.push({
        file: rel,
        line,
        rule: 'db/attach',
        message: 'ATTACH/DETACH is forbidden: one database per service (STD-SQL-13)',
        severity: 'error',
      });
    }
  }
  return out;
}

export async function analyze(root, opts = {}) {
  const cfg = loadSqlConfig(opts.config);
  const files = srcFiles(root).filter((f) => !matchAny(f, cfg.db_paths_exempt));
  const violations = [];
  for (const f of files) {
    violations.push(...checkFile(f, readFileSync(path.join(root, f), 'utf8'), cfg));
  }
  return { files: files.length, violations };
}

if (isMain(import.meta.url)) {
  await runGate({ id: 'check:db-paths', requireUnits: true, spec: { options: ['config'] } }, (o) =>
    analyze(o.root, { config: o.get('config') ? path.resolve(o.get('config')) : undefined }),
  );
}
