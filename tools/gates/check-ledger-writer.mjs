#!/usr/bin/env node
// check:ledger-writer (NFR-DATA-013, CR-27, STD-SQL-11, STD-DIR-19, DB-01 §3.7) — 증거 원장 테이블은 writer 파일에서 `INSERT OR IGNORE`로만 쓴다.
//   ledger/writer-location  원장 테이블 쓰기문이 ledger.writer 파일 밖
//   ledger/insert-form      INSERT가 OR IGNORE가 아님(일반 INSERT·OR ABORT 등)
//   ledger/replace          INSERT OR REPLACE · REPLACE INTO
//   ledger/upsert           ON CONFLICT … DO UPDATE
//   ledger/mutation         UPDATE · DELETE
//   ledger/drop-trigger     DROP TRIGGER(어느 테이블이든, src 안)
// 사용: node tools/gates/check-ledger-writer.mjs [--root <dir>] [--config <path>] [--json] [--quiet]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { srcFiles } from './check-security-scan.mjs';
import { loadSqlConfig, normalizeSql, sqlLiterals } from './check-sql-template.mjs';
import { isMain, runGate } from './lib/common.mjs';
import { tokenize } from './lib/lex.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 한 파일 검사. */
export function checkFile(rel, src, cfg) {
  const out = [];
  const T = escapeRe(cfg.ledger.table.toUpperCase());
  const insertRe = new RegExp(`INSERT (?:OR (\\w+) )?INTO "?${T}\\b`);
  const replaceRe = new RegExp(`(?:^|[^A-Z_])REPLACE INTO "?${T}\\b`);
  const updateRe = new RegExp(`UPDATE (?:OR \\w+ )?"?${T}\\b`);
  const deleteRe = new RegExp(`DELETE FROM "?${T}\\b`);
  const mentionRe = new RegExp(`(?<![\\w"])"?${T}\\b`);
  const isWriter = rel === cfg.ledger.writer;
  const { tokens } = tokenize(src);
  for (const { text, line } of sqlLiterals(tokens)) {
    const n = normalizeSql(text);
    const add = (rule, message) => out.push({ file: rel, line, rule, message, severity: 'error' });
    const ins = insertRe.exec(n);
    const rep = replaceRe.test(n);
    const upd = updateRe.test(n);
    const del = deleteRe.test(n);
    if ((ins || rep || upd || del) && !isWriter) {
      add('ledger/writer-location', `${cfg.ledger.table} may only be written in ${cfg.ledger.writer} (STD-SQL-11)`);
    }
    if (ins) {
      const x = ins[1];
      if (x === 'REPLACE') {
        add('ledger/replace', `INSERT OR REPLACE INTO ${cfg.ledger.table}: evidence rows are never overwritten`);
      } else if (x !== 'IGNORE') {
        add('ledger/insert-form', `INSERT${x ? ` OR ${x}` : ''} INTO ${cfg.ledger.table}: use INSERT OR IGNORE only (STD-SQL-11)`);
      }
    }
    if (rep && !(ins && ins[1] === 'REPLACE')) {
      add('ledger/replace', `REPLACE INTO ${cfg.ledger.table}: evidence rows are never overwritten`);
    }
    if (mentionRe.test(n) && /ON CONFLICT.*DO UPDATE/.test(n)) {
      add('ledger/upsert', `ON CONFLICT … DO UPDATE on ${cfg.ledger.table}: evidence is append-only`);
    }
    if (upd || del) {
      add('ledger/mutation', `${upd ? 'UPDATE' : 'DELETE FROM'} ${cfg.ledger.table}: evidence is append-only (DB-01 §3.7)`);
    }
    if (/DROP TRIGGER/.test(n)) {
      add('ledger/drop-trigger', 'DROP TRIGGER is forbidden in src: ledger immutability triggers must stay');
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
  await runGate({ id: 'check:ledger-writer', requireUnits: true, spec: { options: ['config'] } }, (o) =>
    analyze(o.root, { config: o.get('config') ? path.resolve(o.get('config')) : undefined }),
  );
}
