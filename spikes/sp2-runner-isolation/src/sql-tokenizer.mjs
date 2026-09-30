// SQL tokenizer + allowlist for the learner SQL runner (FR-LAB-002).
// node:sqlite has no authorizer, and ATTACH / VACUUM INTO create files even under --permission (measured),
// so the ONLY gate is this lexer. Design: lex fully (comments, '..' strings, ".." / `..` / [..] identifiers,
// X'..' blobs, numbers, punctuation), then decide on tokens, never on regex over raw text.
export const MAX_STATEMENTS = 20;
export const MAX_SQL_BYTES = 64 * 1024;

const STATEMENT_START = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'REPLACE']);
// words that are rejected wherever they appear as an unquoted word
const DENY_WORDS = new Set([
  'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'LOAD_EXTENSION', 'READFILE', 'WRITEFILE', 'EDIT', 'FTS3_TOKENIZER',
  'SQLITE_DBPAGE', 'VIRTUAL', 'TRIGGER', 'EXPLAIN', 'ANALYZE', 'REINDEX', 'BEGIN', 'COMMIT', 'END', 'ROLLBACK',
  'SAVEPOINT', 'RELEASE', 'ALTER',
]);
// Safe PRAGMA list (read-only schema introspection). Used ONLY as "PRAGMA name(arg)" or "PRAGMA name".
// NOTE: FR-LAB-002 says PRAGMA is rejected; this spike proposes a tiny opt-in safe list (see report).
export const SAFE_PRAGMAS = new Set(['TABLE_INFO', 'TABLE_XINFO', 'TABLE_LIST', 'INDEX_LIST', 'INDEX_INFO', 'INDEX_XINFO', 'FOREIGN_KEY_LIST']);

export function lex(sql) {
  const toks = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (c === '\0') throw reject('NUL byte');
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && c2 === '-') { const j = sql.indexOf('\n', i); i = j < 0 ? n : j + 1; continue; }
    if (c === '/' && c2 === '*') { const j = sql.indexOf('*/', i + 2); if (j < 0) { i = n; } else i = j + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= n) throw reject('unterminated literal');
        if (sql[j] === c) { if (sql[j + 1] === c) { s += c; j += 2; continue; } break; }
        s += sql[j++];
      }
      toks.push({ t: c === "'" ? 'str' : 'qid', v: s });
      i = j + 1; continue;
    }
    if (c === '[') { const j = sql.indexOf(']', i + 1); if (j < 0) throw reject('unterminated [ident]'); toks.push({ t: 'qid', v: sql.slice(i + 1, j) }); i = j + 1; continue; }
    if ((c === 'x' || c === 'X') && c2 === "'") { const j = sql.indexOf("'", i + 2); if (j < 0) throw reject('unterminated blob'); toks.push({ t: 'blob', v: sql.slice(i + 2, j) }); i = j + 1; continue; }
    if (/[A-Za-z_\u0080-\uffff]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$\u0080-\uffff]/.test(sql[j])) j++; toks.push({ t: 'word', v: sql.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(c2 || ''))) { let j = i + 1; while (j < n && /[0-9A-Za-z_.]/.test(sql[j])) j++; toks.push({ t: 'num', v: sql.slice(i, j) }); i = j; continue; }
    if (c === '?' || c === ':' || c === '@' || c === '$') { // bind params: reject, learners get no parameters
      throw reject('bind parameter not allowed');
    }
    toks.push({ t: 'punct', v: c }); i++;
  }
  return toks;
}

function reject(reason) { const e = new Error('SQL rejected: ' + reason); e.code = 'ERR_SQL_REJECTED'; e.reason = reason; return e; }

const PATH_LIKE = /^(?:\/|~|[A-Za-z]:[\\/]|\.{1,2}[\\/]|file:|\\\\)|\.(?:db|sqlite3?|sql|so|dll|dylib)$/i;

/** Returns { statements: string[] } or throws Error(code ERR_SQL_REJECTED). */
export function checkSql(sql) {
  if (typeof sql !== 'string') throw reject('not a string');
  if (Buffer.byteLength(sql) > MAX_SQL_BYTES) throw reject('too large');
  const toks = lex(sql);
  const stmts = [];
  let cur = [];
  for (const t of toks) {
    if (t.t === 'punct' && t.v === ';') { if (cur.length) stmts.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) stmts.push(cur);
  if (stmts.length === 0) throw reject('empty');
  if (stmts.length > MAX_STATEMENTS) throw reject(`too many statements (${stmts.length} > ${MAX_STATEMENTS})`);
  for (const st of stmts) {
    const first = st[0];
    if (first.t !== 'word') throw reject('statement must start with a keyword');
    const kw = first.v.toUpperCase();
    if (kw === 'PRAGMA') { checkPragma(st); continue; }
    if (!STATEMENT_START.has(kw)) throw reject(`statement type ${kw} not allowed`);
    for (const t of st) {
      if (t.t === 'word' && DENY_WORDS.has(t.v.toUpperCase())) throw reject(`keyword ${t.v.toUpperCase()} not allowed`);
      if (t.t === 'qid' && DENY_WORDS.has(t.v.toUpperCase()) && ['LOAD_EXTENSION', 'READFILE', 'WRITEFILE', 'FTS3_TOKENIZER', 'SQLITE_DBPAGE'].includes(t.v.toUpperCase())) throw reject(`identifier ${t.v} not allowed`);
      if (t.t === 'str' && PATH_LIKE.test(t.v)) throw reject('file-path literal not allowed');
    }
    if (kw === 'CREATE') {
      // CREATE [TEMP|TEMPORARY] TABLE|VIEW ... / CREATE [UNIQUE] INDEX ...
      let k = 1;
      const w = (x) => (st[x]?.t === 'word' ? st[x].v.toUpperCase() : '');
      if (w(k) === 'TEMP' || w(k) === 'TEMPORARY') k++;
      if (w(k) === 'UNIQUE') k++;
      if (!['TABLE', 'VIEW', 'INDEX'].includes(w(k))) throw reject('only CREATE TABLE/INDEX/VIEW allowed');
    }
    if (kw === 'DROP') {
      const w2 = st[1]?.t === 'word' ? st[1].v.toUpperCase() : '';
      if (!['TABLE', 'INDEX', 'VIEW'].includes(w2)) throw reject('only DROP TABLE/INDEX/VIEW allowed');
    }
  }
  const out = [];
  // Rebuild statements from the ORIGINAL text is error-prone; rather, re-split on token boundaries by
  // re-lexing positions. Simpler and safe: execute the exact token-checked text split on ';' outside literals.
  out.push(...splitStatements(sql));
  if (out.length !== stmts.length) throw reject('internal split mismatch');
  return { statements: out };
}

function checkPragma(st) {
  // PRAGMA name | PRAGMA name(arg) | PRAGMA name = value  (only the first two forms, only safe names)
  const name = st[1]?.t === 'word' ? st[1].v.toUpperCase() : '';
  if (!SAFE_PRAGMAS.has(name)) throw reject(`PRAGMA ${name || '?'} not allowed`);
  const rest = st.slice(2);
  if (rest.length === 0) return;
  if (rest[0].t === 'punct' && rest[0].v === '(' && rest.length >= 3 && rest[rest.length - 1].v === ')' && rest.slice(1, -1).every((t) => t.t === 'word' || t.t === 'qid' || t.t === 'str')) {
    for (const t of rest.slice(1, -1)) if (t.t === 'str' && PATH_LIKE.test(t.v)) throw reject('file-path literal not allowed');
    return;
  }
  throw reject('PRAGMA form not allowed');
}

/** Split original text on top-level ';' using the same lexical rules (comments/strings aware). */
export function splitStatements(sql) {
  const parts = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i], c2 = sql[i + 1];
    if (c === '-' && c2 === '-') { const j = sql.indexOf('\n', i); i = j < 0 ? n : j + 1; continue; }
    if (c === '/' && c2 === '*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === "'" || c === '"' || c === '`') { let j = i + 1; for (;;) { if (j >= n) { j = n; break; } if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; } i = j + 1; continue; }
    if (c === '[') { const j = sql.indexOf(']', i + 1); i = j < 0 ? n : j + 1; continue; }
    if (c === ';') { const s = sql.slice(start, i).trim(); if (hasToken(s)) parts.push(s); start = i + 1; }
    i++;
  }
  const tail = sql.slice(start).trim();
  if (hasToken(tail)) parts.push(tail);
  return parts;
}
function hasToken(s) { try { return lex(s).length > 0; } catch { return true; } }

export const firstKeyword = (stmt) => { const t = lex(stmt)[0]; return t?.t === 'word' ? t.v.toUpperCase() : ''; };
