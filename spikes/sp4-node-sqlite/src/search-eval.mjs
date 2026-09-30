import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadDocs, QUERIES, PROBES } from './corpus.mjs';
import { HELDOUT } from './heldout.mjs';
import * as S from './search.mjs';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r3 = (x) => Math.round(x * 1000) / 1000;
const ms = (x) => Math.round(x * 1000) / 1000;

const VARIANTS = {
  V0_naive_trigram: (db, q) => S.searchNaive(db, q),
  V1_hybrid_basic: (db, q) => S.searchHybrid(db, q, { compact: false, josa: false, or: false }),
  V2_hybrid_full_like: (db, q) => S.searchHybrid(db, q, { shortMode: 'like' }),
  V3_hybrid_full_uni: (db, q) => S.searchHybrid(db, q, { shortMode: 'uni' }),
};

function evalSet(db, set) {
  const out = {};
  for (const [name, fn] of Object.entries(VARIANTS)) {
    const per = {}, rows = [];
    for (const x of set) {
      const res = fn(db, x.q), r = S.recallAtK(res, x.rel);
      (per[x.cat] ??= []).push(r);
      rows.push({ q: x.q, cat: x.cat, recall: r3(r), top10: res.slice(0, 10) });
    }
    out[name] = {
      recall_at_10: r3(mean(rows.map((r) => r.recall))),
      by_category: Object.fromEntries(Object.entries(per).map(([c, a]) => [c, { n: a.length, recall: r3(mean(a)) }])),
      queries_below_1: rows.filter((r) => r.recall < 1).map((r) => ({ q: r.q, cat: r.cat, recall: r.recall })),
      queries_full_recall: rows.filter((r) => r.recall === 1).length,
      rows,
    };
  }
  return out;
}

// why did a relevant doc not make the top 10?  token absent (vocabulary gap) vs present-but-ranked-out (ranking miss)
function diagnoseMisses(db, set, variantName) {
  const docsBySlug = new Map(db.prepare('SELECT slug, ntext FROM docs').all().map((d) => [d.slug, d.ntext]));
  const fn = VARIANTS[variantName], out = [];
  for (const x of set) {
    const res = new Set(fn(db, x.q).slice(0, 10));
    const toks = S.norm(x.q).split(/\s+/);
    for (const rel of x.rel.slice(0, 100)) {
      if (res.has(rel) || (x.rel.length > 10 && res.size >= 10 && [...res].every((s) => x.rel.includes(s)))) continue;
      const missing = toks.filter((t) => !docsBySlug.get(rel).includes(t));
      out.push({ q: x.q, missed: rel, reason: missing.length ? `lexical gap (absent: ${missing.join(', ')})` : 'ranking miss (all tokens present)' });
    }
  }
  return out;
}

function auditGroundTruth(db, set) {
  // For substring-type queries: docs that literally contain the (single-token) query but are not in rel.
  const all = db.prepare('SELECT slug, ntext FROM docs').all();
  const out = [];
  for (const x of set.filter((y) => !/\s/.test(y.q))) {
    const lit = all.filter((d) => d.ntext.includes(S.norm(x.q))).map((d) => d.slug);
    const extra = lit.filter((s) => !x.rel.includes(s));
    const relNoLit = x.rel.filter((s) => !lit.includes(s));
    if (extra.length || relNoLit.length) out.push({ q: x.q, contains_query_but_not_rel: extra, rel_without_literal_hit: relNoLit });
  }
  return out;
}

// ---- synthetic scale corpus (latency only) -----------------------------------------------------------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function synth(n, base, seed = 7) {
  const rnd = mulberry32(seed), pick = (a) => a[Math.floor(rnd() * a.length)];
  const words = base.flatMap((d) => d.body.split(/\s+/)).filter((w) => w.length >= 2);
  const tw = base.flatMap((d) => d.title.split(/\s+/));
  const aw = base.flatMap((d) => d.alias.split(/,\s*/));
  return Array.from({ length: n }, (_, i) => ({
    slug: `syn.${i}`,
    title: `${pick(tw)} ${pick(tw)} ${i}`,
    alias: `${pick(aw)}, ${pick(aw)}`,
    body: Array.from({ length: 14 }, () => pick(words)).join(' ') + '.',
  }));
}

function latency(db, queries, variants, reps) {
  const res = {};
  for (const [vn, fn] of Object.entries(variants)) {
    const by = {};
    for (const x of queries) {
      for (let i = 0; i < 2; i++) fn(db, x.q); // warm
      const t = [];
      for (let i = 0; i < reps; i++) { const t0 = performance.now(); fn(db, x.q); t.push(performance.now() - t0); }
      (by[x.cat] ??= []).push(...t);
      (by.ALL ??= []).push(...t);
    }
    res[vn] = Object.fromEntries(Object.entries(by).map(([c, a]) => [c, { p50: ms(S.pct(a, 50)), p95: ms(S.pct(a, 95)), p99: ms(S.pct(a, 99)), max: ms(a.reduce((m, x) => Math.max(m, x), 0)) }]));
  }
  return res;
}

export async function runSearch(workDir) {
  const t0 = Date.now();
  const docs = loadDocs();
  const out = { corpus: { docs: docs.length, queries_headline: QUERIES.length, probes: PROBES.length, heldout: HELDOUT.length } };

  // ---------- 1. FTS5 trigram behaviours (mechanism facts) ----------
  const db = S.openSearchDb();
  S.insertDocs(db, docs);
  const cnt = (sql, ...p) => db.prepare(sql).all(...p).length;
  const plan = (sql) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map((r) => r.detail).join(' | ');
  out.mechanism = {
    fts5_trigram_available: db.prepare("SELECT count(*) c FROM pragma_compile_options WHERE compile_options='ENABLE_FTS5'").get().c === 1,
    match_2char_hangul_rows: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"캐시"'`),
    match_2char_hangul_rows_via_like_scan: cnt(`SELECT id FROM docs WHERE instr(ntext,'캐시')>0`),
    match_3char_hangul_rows: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"스케줄링"'`),
    match_ascii_case_insensitive_jwt_lower: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"jwt"'`),
    match_ascii_k8s_3char: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"k8s"'`),
    match_2char_ascii_db: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"db"'`),
    match_NFD_query_on_NFC_index: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH ?`, '"' + '스케줄링'.normalize('NFD') + '"'),
    match_NFC_query_on_NFC_index: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH ?`, '"' + '스케줄링'.normalize('NFC') + '"'),
    match_phrase_with_space_hit: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"3-way handshake"'`),
    match_hyphen_slash_unquoted_error: (() => { try { db.prepare(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH 'CI/CD'`).all(); return 'no error'; } catch (e) { return `${e.code} errcode=${e.errcode}: ${e.message}`; } })(),
    match_hyphen_quoted_ok: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"ci/cd"'`),
    like_3char_plan_on_fts_column: plan(`SELECT rowid FROM fts_tri WHERE body LIKE '%스케줄%'`),
    like_2char_plan_on_fts_column: plan(`SELECT rowid FROM fts_tri WHERE body LIKE '%캐시%'`),
    like_3char_rows_on_fts_column: cnt(`SELECT rowid FROM fts_tri WHERE body LIKE '%스케줄%'`),
    unicode61_prefix_2char_rows: cnt(`SELECT rowid FROM fts_uni WHERE fts_uni MATCH '"캐시"*'`),
    unicode61_prefix_vs_trigram_midword: (() => { // "네티스" is the middle of "쿠버네티스": unicode61 prefix cannot find it, trigram can
      return { unicode61_prefix: cnt(`SELECT rowid FROM fts_uni WHERE fts_uni MATCH '"네티스"*'`), trigram: cnt(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"네티스"'`) };
    })(),
    fts_integrity_check: (() => { try { db.exec(`INSERT INTO fts_tri(fts_tri, rank) VALUES('integrity-check', 1)`); db.exec(`INSERT INTO fts_cmp(fts_cmp, rank) VALUES('integrity-check', 1)`); return 'ok'; } catch (e) { return e.message; } })(),
  };

  // trigger sync test
  const one = (sql, ...p) => db.prepare(sql).all(...p).length;
  db.prepare(`UPDATE docs SET body = ?, ntext = ? WHERE slug='net.udp'`).run('바뀐 본문 유니크토큰알파', S.norm('UDP\nUser Datagram Protocol\n바뀐 본문 유니크토큰알파'));
  const afterUpdateNew = one(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"유니크토큰알파"'`);
  const afterUpdateOld = one(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"실시간 스트리밍"'`);
  db.prepare(`DELETE FROM docs WHERE slug='net.udp'`).run();
  const afterDelete = one(`SELECT rowid FROM fts_tri WHERE fts_tri MATCH '"유니크토큰알파"'`);
  out.mechanism.trigger_sync = { after_update_new_term_hits: afterUpdateNew, after_update_old_term_hits: afterUpdateOld, after_delete_hits: afterDelete };
  db.close();

  // ---------- 2. recall@10 ----------
  const db2 = S.openSearchDb();
  S.insertDocs(db2, docs);
  out.ground_truth_audit = auditGroundTruth(db2, [...QUERIES, ...PROBES, ...HELDOUT]);
  out.headline40 = evalSet(db2, QUERIES);
  out.probes = evalSet(db2, PROBES);
  out.heldout20 = evalSet(db2, HELDOUT);
  out.misses_V2_headline = diagnoseMisses(db2, QUERIES, 'V2_hybrid_full_like');
  out.misses_V2_heldout = diagnoseMisses(db2, HELDOUT, 'V2_hybrid_full_like');
  const combined = [...QUERIES, ...HELDOUT];
  out.combined60_recall = Object.fromEntries(Object.entries(VARIANTS).map(([n, fn]) => [n, r3(mean(combined.map((x) => S.recallAtK(fn(db2, x.q), x.rel))))]));
  const shortOnly = combined.filter((x) => x.cat === 'S');
  out.short_1_2char_recall_combined = Object.fromEntries(Object.entries(VARIANTS).map(([n, fn]) => [n, { n: shortOnly.length, recall: r3(mean(shortOnly.map((x) => S.recallAtK(fn(db2, x.q), x.rel)))) }]));
  db2.close();

  // ---------- 3. latency + scale ----------
  mkdirSync(workDir, { recursive: true });
  const latVariants = {
    V0_naive_trigram: VARIANTS.V0_naive_trigram,
    V2_hybrid_full_like: VARIANTS.V2_hybrid_full_like,
    V3_hybrid_full_uni: VARIANTS.V3_hybrid_full_uni,
  };
  const allQ = [...QUERIES, ...HELDOUT, ...PROBES];
  out.scale = {};
  for (const n of [0, 12000, 50000]) {
    const path = join(workDir, `search-${n}.db`);
    for (const suf of ['', '-wal', '-shm']) rmSync(path + suf, { force: true });
    const dbs = S.openSearchDb(path);
    const tb = performance.now();
    S.insertDocs(dbs, docs);
    if (n) S.insertDocs(dbs, synth(n, docs));
    const buildMs = performance.now() - tb;
    dbs.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const pages = dbs.prepare('PRAGMA page_count').get().page_count * dbs.prepare('PRAGMA page_size').get().page_size;
    const sizes = Object.fromEntries(dbs.prepare(`SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name`).all().filter((r) => /^(docs|fts_)/.test(r.name)).map((r) => [r.name, r.bytes]));
    out.scale[`docs_${docs.length + n}`] = {
      build_ms: Math.round(buildMs), db_bytes: pages, dbstat_bytes_by_object: sizes,
      latency_ms: latency(dbs, allQ, latVariants, n >= 50000 ? 4 : n ? 8 : 25),
    };
    dbs.close();
    for (const suf of ['', '-wal', '-shm']) rmSync(path + suf, { force: true });
  }
  out.elapsed_s = Math.round((Date.now() - t0) / 100) / 10;
  return out;
}
