import { DatabaseSync } from 'node:sqlite';
import { sha256hex, GENESIS } from './util.ts';
import { Projector, cloneProjection, type Projection, type Envelope, type CardState, type ConceptState, type ReviewPayload } from './projection.ts';
import type { Row } from './sim.ts';

/** Total order for replay. device_id compared bytewise (ASCII ULID) — same in SQLite BINARY and JS `<`. */
export const ORDER_BY = 'client_ts, device_id, device_seq';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events(
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  device_seq INTEGER NOT NULL,
  client_ts  INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL CHECK (json_valid(payload)),
  card_id    TEXT GENERATED ALWAYS AS (json_extract(payload,'$.card_id')) STORED,
  concept_id TEXT GENERATED ALWAYS AS (json_extract(payload,'$.concept_id')) STORED,
  UNIQUE(device_id, device_seq)
);
CREATE INDEX IF NOT EXISTS ix_order   ON events(client_ts, device_id, device_seq);
CREATE INDEX IF NOT EXISTS ix_card    ON events(card_id, client_ts, device_id, device_seq);
CREATE INDEX IF NOT EXISTS ix_concept ON events(concept_id, client_ts, device_id, device_seq);
CREATE INDEX IF NOT EXISTS ix_corr    ON events(type) WHERE type = 'correction';
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TABLE IF NOT EXISTS card_state(card_id TEXT PRIMARY KEY, concept_id TEXT NOT NULL, json TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_cs_concept ON card_state(concept_id);
CREATE TABLE IF NOT EXISTS concept_state(concept_id TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
`;

export function openLedger(path: string, sync: 'NORMAL' | 'FULL' | 'OFF' = 'NORMAL'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=${sync}; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-262144;`);
  db.exec(SCHEMA);
  return db;
}

export class Inserter {
  private st;
  constructor(private db: DatabaseSync, ignore = true) {
    this.st = db.prepare(`INSERT ${ignore ? 'OR IGNORE ' : ''}INTO events(id,device_id,device_seq,client_ts,type,payload) VALUES(?,?,?,?,?,?)`);
  }
  /** returns number actually inserted (duplicates by id or (device,seq) ignored => idempotent import) */
  many(rows: Row[]): number {
    let ins = 0;
    this.db.exec('BEGIN');
    try { for (const r of rows) ins += Number(this.st.run(r.id, r.device_id, r.device_seq, r.client_ts, r.type, r.payload).changes); this.db.exec('COMMIT'); }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return ins;
  }
  one(r: Row): number { return Number(this.st.run(r.id, r.device_id, r.device_seq, r.client_ts, r.type, r.payload).changes); }
}

export function rowToEnv(r: any): Envelope<any> {
  return { id: r.id, device_id: r.device_id, device_seq: Number(r.device_seq), client_ts: Number(r.client_ts), type: r.type, payload: JSON.parse(r.payload) };
}

export function loadVoided(db: DatabaseSync): Set<string> {
  const s = new Set<string>();
  for (const r of db.prepare(`SELECT json_extract(payload,'$.target_id') AS t FROM events WHERE type='correction'`).iterate() as any) s.add(r.t);
  return s;
}

export interface ReplayOpts {
  orderBy?: string;
  voided?: Set<string>;
  cutoffs?: number[];
  onCutoff?: (cutoff: number, proj: Projection) => void;
  hook?: (ev: Envelope<ReviewPayload>, before: CardState | undefined) => void;
  limitRowid?: number;
  tolerateNegative?: boolean; // control experiment only: clamp client_ts to card.last_review instead of throwing
}
/** Rebuild projection purely from the ledger table (no content/assessment DB). */
export function replayFromDb(db: DatabaseSync, pr: Projector, o: ReplayOpts = {}) {
  const t0 = performance.now();
  const voided = o.voided ?? loadVoided(db);
  const proj: Projection = { cards: new Map(), concepts: new Map() };
  const where = o.limitRowid ? `WHERE rowid <= ${o.limitRowid}` : '';
  const st = db.prepare(`SELECT id,device_id,device_seq,client_ts,type,payload FROM events ${where} ORDER BY ${o.orderBy ?? ORDER_BY}`);
  let n = 0, ci = 0, negClamped = 0;
  const cut = o.cutoffs ?? [];
  for (const r of st.iterate() as any) {
    const ev = rowToEnv(r);
    while (ci < cut.length && ev.client_ts >= cut[ci]) { o.onCutoff!(cut[ci], proj); ci++; }
    if (ev.type === 'review' && !voided.has(ev.id)) {
      const before = proj.cards.get(ev.payload.card_id);
      if (o.tolerateNegative && before && before.last_review !== null && ev.client_ts < before.last_review) { ev.client_ts = before.last_review; negClamped++; }
      if (o.hook) o.hook(ev, before);
      pr.applyReview(proj, ev);
    }
    n++;
  }
  while (ci < cut.length) { o.onCutoff!(cut[ci], proj); ci++; }
  return { proj, events: n, voided: voided.size, ms: performance.now() - t0, negClamped };
}

/** Verify per-device hash chain from stored payload text. */
export function verifyChains(db: DatabaseSync) {
  const t0 = performance.now();
  const heads = new Map<string, { prev: string; seq: number }>();
  let bad = 0, n = 0;
  for (const r of db.prepare(`SELECT id,device_id,device_seq,client_ts,type,payload FROM events ORDER BY device_id, device_seq`).iterate() as any) {
    const i = r.payload.lastIndexOf(',"prev_hash":"');
    const body = r.payload.slice(0, i) + '}';
    const prev = r.payload.slice(i + 14, i + 14 + 32);
    let h = heads.get(r.device_id);
    if (!h) { h = { prev: GENESIS, seq: 0 }; heads.set(r.device_id, h); }
    if (prev !== h.prev || Number(r.device_seq) !== h.seq + 1) bad++;
    h.prev = sha256hex(`${prev}|${r.id}|${r.device_seq}|${r.client_ts}|${r.type}|${body}`).slice(0, 32);
    h.seq = Number(r.device_seq);
    n++;
  }
  return { events: n, brokenLinks: bad, devices: heads.size, ms: performance.now() - t0 };
}

export function persistProjection(db: DatabaseSync, proj: Projection, cardConcept: Map<string, string>) {
  db.exec('BEGIN; DELETE FROM card_state; DELETE FROM concept_state;');
  const a = db.prepare('INSERT INTO card_state(card_id,concept_id,json) VALUES(?,?,?)');
  const b = db.prepare('INSERT INTO concept_state(concept_id,json) VALUES(?,?)');
  for (const [k, v] of proj.cards) a.run(k, cardConcept.get(k)!, JSON.stringify(v));
  for (const [k, v] of proj.concepts) b.run(k, JSON.stringify(v));
  db.exec('COMMIT');
}
export function loadProjection(db: DatabaseSync): Projection {
  const proj: Projection = { cards: new Map(), concepts: new Map() };
  for (const r of db.prepare('SELECT card_id,json FROM card_state').iterate() as any) proj.cards.set(r.card_id, JSON.parse(r.json));
  for (const r of db.prepare('SELECT concept_id,json FROM concept_state').iterate() as any) proj.concepts.set(r.concept_id, JSON.parse(r.json));
  return proj;
}

/** Incremental projector on top of the persisted projection tables. */
export class LiveLedger {
  private ins; private gc; private gk; private pc; private pk; private evByCard; private evByConcept;
  voided: Set<string>;
  stats = { fast: 0, slowCard: 0, slowConcept: 0, dup: 0 };
  constructor(public db: DatabaseSync, public pr: Projector) {
    this.ins = db.prepare(`INSERT OR IGNORE INTO events(id,device_id,device_seq,client_ts,type,payload) VALUES(?,?,?,?,?,?)`);
    this.gc = db.prepare('SELECT json FROM card_state WHERE card_id=?');
    this.gk = db.prepare('SELECT json FROM concept_state WHERE concept_id=?');
    this.pc = db.prepare('INSERT OR REPLACE INTO card_state(card_id,concept_id,json) VALUES(?,?,?)');
    this.pk = db.prepare('INSERT OR REPLACE INTO concept_state(concept_id,json) VALUES(?,?)');
    this.evByCard = db.prepare(`SELECT id,device_id,device_seq,client_ts,type,payload FROM events WHERE card_id=? ORDER BY ${ORDER_BY}`);
    this.evByConcept = db.prepare(`SELECT id,device_id,device_seq,client_ts,type,payload FROM events WHERE concept_id=? ORDER BY ${ORDER_BY}`);
    this.voided = loadVoided(db);
  }
  private card(id: string): CardState | undefined { const r: any = this.gc.get(id); return r ? JSON.parse(r.json) : undefined; }
  private concept(id: string): ConceptState | undefined { const r: any = this.gk.get(id); return r ? JSON.parse(r.json) : undefined; }
  rederiveCard(id: string) {
    const c = this.pr.foldCard((function* (rows: any) { for (const r of rows) yield rowToEnv(r); })(this.evByCard.iterate(id)), this.voided);
    if (c) { const kid = this.conceptOfCard(id); this.pc.run(id, kid, JSON.stringify(c)); }
    else this.db.prepare('DELETE FROM card_state WHERE card_id=?').run(id);
  }
  private conceptOfCard(id: string): string {
    const r: any = this.db.prepare('SELECT concept_id FROM events WHERE card_id=? LIMIT 1').get(id); return r.concept_id;
  }
  rederiveConcept(id: string) {
    const c = this.pr.foldConcept((function* (rows: any) { for (const r of rows) yield rowToEnv(r); })(this.evByConcept.iterate(id)), this.voided);
    if (c) this.pk.run(id, JSON.stringify(c)); else this.db.prepare('DELETE FROM concept_state WHERE concept_id=?').run(id);
  }
  /** Append one event and update projection in one transaction. */
  append(row: Row): 'fast' | 'slow' | 'dup' {
    const db = this.db;
    db.exec('BEGIN');
    try {
      if (Number(this.ins.run(row.id, row.device_id, row.device_seq, row.client_ts, row.type, row.payload).changes) === 0) { db.exec('COMMIT'); this.stats.dup++; return 'dup'; }
      const ev = { id: row.id, device_id: row.device_id, device_seq: row.device_seq, client_ts: row.client_ts, type: row.type, payload: JSON.parse(row.payload) } as Envelope<any>;
      let path: 'fast' | 'slow' = 'fast';
      if (ev.type === 'review') {
        const p = ev.payload as ReviewPayload;
        const cs = this.card(p.card_id);
        if (!cs || cs.last_review! < ev.client_ts) this.pc.run(p.card_id, p.concept_id, JSON.stringify(this.pr.applyCard(cs, ev.client_ts, p.rating, p.fuzz_seed)));
        else { this.rederiveCard(p.card_id); this.stats.slowCard++; path = 'slow'; }
        const ks = this.concept(p.concept_id);
        if (!ks || ks.last_ts < ev.client_ts) this.pk.run(p.concept_id, JSON.stringify(this.pr.applyConcept(ks, p, ev.client_ts)));
        else { this.rederiveConcept(p.concept_id); this.stats.slowConcept++; path = 'slow'; }
      } else if (ev.type === 'correction') {
        this.voided.add(ev.payload.target_id);
        this.rederiveCard(ev.payload.card_id); this.rederiveConcept(ev.payload.concept_id); path = 'slow';
      }
      if (path === 'fast') this.stats.fast++;
      db.exec('COMMIT');
      return path;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  /** Bulk import (merge): insert, then re-derive only the touched keys from the ledger. */
  importRows(rows: Row[]) {
    const db = this.db;
    const cards = new Set<string>(), concepts = new Set<string>();
    let inserted = 0;
    db.exec('BEGIN');
    for (const r of rows) {
      if (Number(this.ins.run(r.id, r.device_id, r.device_seq, r.client_ts, r.type, r.payload).changes) === 0) continue;
      inserted++;
      if (r.card_id) cards.add(r.card_id);
      if (r.concept_id) concepts.add(r.concept_id);
      if (r.type === 'correction') this.voided.add(JSON.parse(r.payload).target_id);
    }
    for (const c of cards) this.rederiveCard(c);
    for (const k of concepts) this.rederiveConcept(k);
    db.exec('COMMIT');
    return { inserted, cards: cards.size, concepts: concepts.size };
  }
}

export function exportRows(db: DatabaseSync, sql = 'SELECT id,device_id,device_seq,client_ts,type,payload,card_id,concept_id FROM events ORDER BY rowid'): Row[] {
  const out: Row[] = [];
  for (const r of db.prepare(sql).iterate() as any) out.push({ id: r.id, device_id: r.device_id, device_seq: Number(r.device_seq), client_ts: Number(r.client_ts), type: r.type, payload: r.payload, card_id: r.card_id ?? '', concept_id: r.concept_id ?? '' });
  return out;
}
