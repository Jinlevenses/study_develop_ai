// Korean/English/abbreviation search on node:sqlite FTS5.
//  - fts_tri : trigram tokenizer over (title, alias, body)  -> substring match for tokens >= 3 chars
//  - fts_cmp : trigram over whitespace-stripped text        -> whitespace-insensitive fallback ("이벤트루프")
//  - fts_uni : unicode61 + prefix index                     -> alternative for 1-2 char tokens
//  - docs.ntext : NFC+lowercase text for instr() scans      -> fallback for tokens < 3 chars
import { DatabaseSync } from 'node:sqlite';

export const norm = (s) => s.normalize('NFC').toLowerCase();
const clen = (s) => [...s].length;
const q1 = (t) => '"' + t.replaceAll('"', '""') + '"';

export function openSearchDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE docs(
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, alias TEXT NOT NULL, body TEXT NOT NULL,
      ntext TEXT NOT NULL, compact TEXT NOT NULL
    ) STRICT;
    CREATE VIRTUAL TABLE fts_tri USING fts5(title, alias, body, content='docs', content_rowid='id', tokenize='trigram');
    CREATE VIRTUAL TABLE fts_cmp USING fts5(compact, content='docs', content_rowid='id', tokenize='trigram');
    CREATE VIRTUAL TABLE fts_uni USING fts5(title, alias, body, content='docs', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2', prefix='2 3');
    -- keep the three external-content indexes in sync with docs (the canonical FTS5 external-content trigger recipe)
    CREATE TRIGGER docs_ai AFTER INSERT ON docs BEGIN
      INSERT INTO fts_tri(rowid,title,alias,body) VALUES (new.id,new.title,new.alias,new.body);
      INSERT INTO fts_cmp(rowid,compact) VALUES (new.id,new.compact);
      INSERT INTO fts_uni(rowid,title,alias,body) VALUES (new.id,new.title,new.alias,new.body);
    END;
    CREATE TRIGGER docs_ad AFTER DELETE ON docs BEGIN
      INSERT INTO fts_tri(fts_tri,rowid,title,alias,body) VALUES('delete',old.id,old.title,old.alias,old.body);
      INSERT INTO fts_cmp(fts_cmp,rowid,compact) VALUES('delete',old.id,old.compact);
      INSERT INTO fts_uni(fts_uni,rowid,title,alias,body) VALUES('delete',old.id,old.title,old.alias,old.body);
    END;
    CREATE TRIGGER docs_au AFTER UPDATE ON docs BEGIN
      INSERT INTO fts_tri(fts_tri,rowid,title,alias,body) VALUES('delete',old.id,old.title,old.alias,old.body);
      INSERT INTO fts_cmp(fts_cmp,rowid,compact) VALUES('delete',old.id,old.compact);
      INSERT INTO fts_uni(fts_uni,rowid,title,alias,body) VALUES('delete',old.id,old.title,old.alias,old.body);
      INSERT INTO fts_tri(rowid,title,alias,body) VALUES (new.id,new.title,new.alias,new.body);
      INSERT INTO fts_cmp(rowid,compact) VALUES (new.id,new.compact);
      INSERT INTO fts_uni(rowid,title,alias,body) VALUES (new.id,new.title,new.alias,new.body);
    END;
  `);
  return db;
}

export function insertDocs(db, docs) {
  const ins = db.prepare('INSERT INTO docs(slug,title,alias,body,ntext,compact) VALUES (?,?,?,?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const d of docs) {
      const title = d.title.normalize('NFC'), alias = d.alias.normalize('NFC'), body = d.body.normalize('NFC');
      const ntext = norm(`${title}\n${alias}\n${body}`);
      ins.run(d.slug, title, alias, body, ntext, ntext.replace(/\s+/g, ''));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const JOSA2 = ['에서', '에게', '으로', '에는', '이란', '라는', '까지', '부터', '보다'];
const JOSA1 = ['을', '를', '은', '는', '이', '가', '에', '의', '와', '과', '도', '로'];
export function stripJosa(t) {
  if (!/[가-힣]$/.test(t)) return t;
  for (const j of JOSA2) if (t.endsWith(j) && clen(t) - 2 >= 3) return t.slice(0, -2);
  for (const j of JOSA1) if (t.endsWith(j) && clen(t) - 1 >= 3 && clen(t) >= 4) return t.slice(0, -1);
  return t;
}

// ---- V0: what you get if you just hand the raw query to FTS5 trigram --------------------------------
export function searchNaive(db, q, k = 10) {
  const s = norm(q).trim();
  if (!s) return [];
  try {
    return db.prepare(`SELECT d.slug FROM fts_tri JOIN docs d ON d.id=fts_tri.rowid
                       WHERE fts_tri MATCH ? ORDER BY bm25(fts_tri,10.0,5.0,1.0) LIMIT ?`).all(q1(s), k).map((r) => r.slug);
  } catch { return []; }
}

// ---- hybrid ---------------------------------------------------------------------------------------
const stmtCache = new WeakMap();
function stmts(db) {
  let s = stmtCache.get(db);
  if (!s) {
    s = {
      fts: (n) => db.prepare(`SELECT d.id,d.slug,d.title,d.alias,d.ntext,bm25(fts_tri,10.0,5.0,1.0) AS r
                              FROM fts_tri JOIN docs d ON d.id=fts_tri.rowid WHERE fts_tri MATCH ? ORDER BY r LIMIT ${n}`),
      cmp: db.prepare(`SELECT d.id,d.slug,d.title,d.alias,d.ntext,bm25(fts_cmp) AS r
                       FROM fts_cmp JOIN docs d ON d.id=fts_cmp.rowid WHERE fts_cmp MATCH ? ORDER BY r LIMIT 300`),
      uni: db.prepare(`SELECT d.id,d.slug,d.title,d.alias,d.ntext,bm25(fts_uni,10.0,5.0,1.0) AS r
                       FROM fts_uni JOIN docs d ON d.id=fts_uni.rowid WHERE fts_uni MATCH ? ORDER BY r LIMIT 300`),
      scan: db.prepare(`SELECT id,slug,title,alias,ntext,0 AS r FROM docs WHERE instr(ntext,?)>0 LIMIT 3000`),
      scanCmp: db.prepare(`SELECT id,slug,title,alias,ntext,0 AS r FROM docs WHERE instr(compact,?)>0 LIMIT 3000`),
    };
    s.ftsFixed = s.fts(300);
    stmtCache.set(db, s);
  }
  return s;
}

const SEP = /[\s,(/.\-_:]/;
function wordStart(text, t) {
  for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + 1)) if (i === 0 || SEP.test(text[i - 1])) return true;
  return false;
}
// field-weighted, word-boundary-aware match quality of one token in one row (0 = only a mid-word/body substring hit)
function tokScore(row, t) {
  const title = row.title.toLowerCase();
  if (title === t) return 5;
  if (title.startsWith(t)) return 4;
  if (wordStart(title, t)) return 3;
  if (title.includes(t)) return 2;
  const alias = row.alias.toLowerCase();
  if (wordStart(alias, t)) return 1.5;
  if (alias.includes(t)) return 1;
  if (wordStart(row.ntext, t)) return 0.5;
  return 0;
}

// one "stage" = one candidate set with a consistent match rule
function stageAnd(db, toks, shortMode) {
  const st = stmts(db);
  const L = toks.filter((t) => clen(t) >= 3), S = toks.filter((t) => clen(t) < 3);
  let rows;
  if (L.length) {
    rows = st.ftsFixed.all(L.map(q1).join(' AND '));
    if (S.length) rows = rows.filter((r) => S.every((s) => (shortMode === 'uni' ? wordStart(r.ntext, s) : r.ntext.includes(s))));
  } else if (shortMode === 'uni') {
    rows = st.uni.all(S.map((t) => q1(t) + '*').join(' AND '));
  } else {
    rows = st.scan.all(S[0]);
    if (S.length > 1) rows = rows.filter((r) => S.slice(1).every((s) => r.ntext.includes(s)));
  }
  return rows.map((r) => ({ ...r, s: toks.reduce((a, t) => a + tokScore(r, t), 0) }));
}

function stageOr(db, toks, shortMode) {
  const st = stmts(db), byId = new Map();
  const N = (st.n ??= db.prepare('SELECT count(*) AS n FROM docs').get().n);
  for (const t of toks) {
    const rows = clen(t) >= 3 ? st.ftsFixed.all(q1(t)) : shortMode === 'uni' ? st.uni.all(q1(t) + '*') : st.scan.all(t);
    const w = Math.log(1 + N / Math.max(1, rows.length));       // rare tokens dominate ("파이프라인" >> "ci")
    for (const r of rows) {
      const o = byId.get(r.id) ?? { ...r, s: 0 };
      o.s += w * (1 + tokScore(r, t) / 4);
      byId.set(r.id, o);
    }
  }
  return [...byId.values()];
}

function stageCompact(db, q) {
  const st = stmts(db);
  const cq = norm(q).replace(/\s+/g, '');
  if (!cq) return [];
  const rows = clen(cq) >= 3 ? st.cmp.all(q1(cq)) : st.scanCmp.all(cq);
  return rows.map((r) => ({ ...r, s: tokScore(r, cq) }));
}

/**
 * opts: shortMode 'like'|'uni', compact (whitespace-insensitive stage), josa (particle-stripped AND stage), or (OR fill)
 * Stages run in order; each appends docs not seen yet, ordered by (score desc, bm25 asc), until k results.
 */
export function searchHybrid(db, q, { k = 10, shortMode = 'like', compact = true, josa = true, or = true } = {}) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const out = [], seen = new Set();
  const push = (rows) => {
    rows.sort((a, b) => b.s - a.s || a.r - b.r || a.id - b.id);
    for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push(r.slug); if (out.length >= k) return true; }
    return false;
  };
  if (push(stageAnd(db, toks, shortMode))) return out;
  if (josa) {
    const st = toks.map(stripJosa);
    if (st.some((t, i) => t !== toks[i]) && push(stageAnd(db, st, shortMode))) return out;
  }
  if (compact && toks.length > 1 && push(stageCompact(db, q))) return out;
  if (compact && toks.length === 1 && push(stageCompact(db, q))) return out;
  if (or && toks.length > 1) push(stageOr(db, josa ? toks.map(stripJosa) : toks, shortMode));
  return out;
}

export function recallAtK(results, rel, k = 10) {
  const top = new Set(results.slice(0, k));
  const hit = rel.filter((r) => top.has(r)).length;
  return hit / Math.min(rel.length, k);
}

export function pct(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
}
