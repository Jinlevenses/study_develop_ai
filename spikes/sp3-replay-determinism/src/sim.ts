import { forgetting_curve, default_w } from 'ts-fsrs';
import { DAY, Rng, UlidGen, sha256hex, GENESIS, mixSeed } from './util.ts';
import { Projector, cloneProjection, sigmoid, newCardState, type Projection, type FsrsCfg, type ReviewPayload, type Envelope, type CardState } from './projection.ts';

export type FuzzMode = 'off' | 'embedded' | 'default' | 'random';
export interface SimConfig {
  seed: number; startTs: number; days: number; deviceId: string;
  concepts: number; cardsPool: number; targetDaily: number; newMax: number; sessionCap: number;
  fuzz: FuzzMode; fsrs: FsrsCfg; correctionsPerActiveDay: number;
  memMean: number;      // learner true stability multiplier (mean); <1 => forgets faster than FSRS default
  memSigma: number; drift: number; slipOffset: number; tsQuantMs: number; sessionHourUtc: number;
  pActiveScale: number; tplSeed: number; clockOffsetMs: number; skewFromDay: number;
}
export const DEFAULT_SIM: SimConfig = {
  seed: 20260930, startTs: Date.UTC(2026, 0, 1), days: 5479, deviceId: '', concepts: 469, cardsPool: 24000,
  targetDaily: 75, newMax: 10, sessionCap: 320, fuzz: 'off', fsrs: { fuzz: false, shortTerm: true, retention: 0.9 },
  correctionsPerActiveDay: 0.11, memMean: 0.95, memSigma: 0.25, drift: 0.08, slipOffset: 5.0, tsQuantMs: 1, sessionHourUtc: 19, pActiveScale: 1, tplSeed: 1, clockOffsetMs: 0, skewFromDay: 1e9,
};

interface FormatSpec { name: string; guess: number; wFormat: number; recognition: boolean; graders: [string, number, number][] }
const DET: [string, number, number][] = [['det', 1.0, 1]];
const FORMATS: Record<string, FormatSpec> = {
  mcq: { name: 'mcq', guess: 0.25, wFormat: 0.6, recognition: true, graders: DET },
  ox: { name: 'ox', guess: 0.5, wFormat: 0.5, recognition: true, graders: DET },
  match: { name: 'match', guess: 0.1, wFormat: 0.6, recognition: true, graders: DET },
  cloze: { name: 'cloze', guess: 0.03, wFormat: 0.8, recognition: false, graders: DET },
  code: { name: 'code', guess: 0.0, wFormat: 1.0, recognition: false, graders: DET },
  free_text: { name: 'free_text', guess: 0.02, wFormat: 1.0, recognition: false, graders: [['jev', 0.7, 0.5], ['llm', 0.6, 0.3], ['self', 0.3, 0.2]] },
};
const FACETS: { name: string; formats: [string, number][] }[] = [
  { name: 'recognition', formats: [['mcq', 0.5], ['ox', 0.2], ['match', 0.3]] },
  { name: 'production', formats: [['cloze', 0.5], ['free_text', 0.5]] },
  { name: 'code', formats: [['code', 1]] },
  { name: 'contrast', formats: [['mcq', 1]] },
  { name: 'explain', formats: [['free_text', 1]] },
  { name: 'apply', formats: [['free_text', 0.5], ['code', 0.5]] },
];
export const TIERS = (c: number) => (c < 80 ? 'core' : c < 230 ? 'standard' : c < 400 ? 'breadth' : 'archive');
const ACTIVE_BY_DOW = [0.9, 0.9, 0.9, 0.9, 0.85, 0.7, 0.75];

export interface Row { id: string; device_id: string; device_seq: number; client_ts: number; type: string; payload: string; card_id: string; concept_id: string }
export type Sink = (row: Row, ev: Envelope<any>) => void;

/** Learner + app (live projection) in one deterministic loop. The learner's hidden truth
 *  (theta, memory factors) never enters the ledger; only the app-visible facts do. */
export class Simulator {
  cfg: SimConfig;
  proj: Projection = { cards: new Map(), concepts: new Map() };
  projector: Projector;
  rng: Rng;
  ulid: UlidGen;
  seq = 0;
  chain = GENESIS;
  lastTs = -1;
  introduced = 0;
  vacationLeft = 0;
  thetaTrue: Float64Array; betaConcept: Float64Array; memFactor: Float64Array;
  voided = new Set<string>();
  byCard = new Map<string, Envelope<ReviewPayload>[]>();
  byConcept = new Map<string, Envelope<ReviewPayload>[]>();
  recentReviews: Envelope<ReviewPayload>[] = []; // for correction targets (last ~60 days)
  eventCount = 0;
  correctionCount = 0;
  day = 0;
  private world: { thetaTrue: Float64Array; betaConcept: Float64Array; memFactor: Float64Array };

  constructor(cfg: Partial<SimConfig> & { deviceId: string }, sharedWorld?: Simulator['world']) {
    this.cfg = { ...DEFAULT_SIM, ...cfg };
    this.projector = new Projector({ ...this.cfg.fsrs, fuzz: this.cfg.fuzz !== 'off' });
    this.rng = new Rng(mixSeed(this.cfg.seed, 1));
    this.ulid = new UlidGen(new Rng(mixSeed(this.cfg.seed, 2)));
    if (sharedWorld) this.world = sharedWorld;
    else {
      const wr = new Rng(mixSeed(this.cfg.seed, 3));
      const th = new Float64Array(this.cfg.concepts), be = new Float64Array(this.cfg.concepts), mf = new Float64Array(this.cfg.cardsPool);
      for (let i = 0; i < th.length; i++) { th[i] = 0.5 + wr.normal(); be[i] = 0.8 * wr.normal(); }
      for (let i = 0; i < mf.length; i++) mf[i] = Math.exp(Math.log(this.cfg.memMean) + this.cfg.memSigma * wr.normal());
      this.world = { thetaTrue: th, betaConcept: be, memFactor: mf };
    }
    this.thetaTrue = this.world.thetaTrue; this.betaConcept = this.world.betaConcept; this.memFactor = this.world.memFactor;
  }

  /** Fork for the second device / continuation: same learner world, copied app state. */
  fork(over: Partial<SimConfig> & { deviceId: string }, keepIdentity: boolean): Simulator {
    const s = new Simulator({ ...this.cfg, ...over, correctionsPerActiveDay: 0 }, this.world);
    s.proj = cloneProjection(this.proj);
    s.introduced = this.introduced; s.day = this.day; s.vacationLeft = this.vacationLeft;
    s.voided = new Set(this.voided);
    if (keepIdentity) { s.seq = this.seq; s.chain = this.chain; s.lastTs = this.lastTs; s.ulid.restore(this.ulid.snapshot()); }
    return s;
  }

  private cardMeta(idx: number) {
    const concept = Math.floor(idx / (this.cfg.cardsPool / this.cfg.concepts));
    const c = Math.min(concept, this.cfg.concepts - 1);
    return { c, facet: FACETS[idx % FACETS.length] };
  }
  static cardId(idx: number) { return 'K' + idx; }

  private isActive(day: number): boolean {
    if (this.vacationLeft > 0) { this.vacationLeft--; return false; }
    if (this.rng.next() < 0.004) { this.vacationLeft = 7 + this.rng.int(15); return false; }
    const dow = (day + 3) % 7;
    return this.rng.next() < ACTIVE_BY_DOW[dow] * this.cfg.pActiveScale;
  }

  private sessionStart(day: number): number {
    // Session template depends only on (seed, day) so two devices open sessions at the same wall time (collision stress).
    const r = new Rng(mixSeed(this.cfg.tplSeed, 99, day));
    const jitterMin = Math.max(-150, Math.min(150, 60 * r.normal()));
    return this.cfg.startTs + day * DAY + this.cfg.sessionHourUtc * 3_600_000 + Math.round(jitterMin * 60_000) + (day >= this.cfg.skewFromDay ? this.cfg.clockOffsetMs : 0);
  }

  private quant(ts: number) { const q = this.cfg.tsQuantMs; return q > 1 ? Math.floor(ts / q) * q : Math.floor(ts); }

  run(fromDay: number, toDay: number, sink: Sink) {
    for (let d = fromDay; d < toDay; d++) { this.day = d; this.runDay(d, sink); }
    this.day = toDay;
  }

  private emit(sink: Sink, ts: number, type: string, body: any): Envelope<any> {
    ts = this.quant(ts);
    const q = Math.max(1, this.cfg.tsQuantMs);
    if (ts <= this.lastTs) ts = this.lastTs + q;
    this.lastTs = ts;
    const id = this.ulid.next(ts);
    this.seq += 1;
    const seq = this.seq;
    const bodyText = JSON.stringify(body);
    const h = sha256hex(`${this.chain}|${id}|${seq}|${ts}|${type}|${bodyText}`).slice(0, 32);
    const payload = bodyText.slice(0, -1) + ',"prev_hash":"' + this.chain + '"}';
    body.prev_hash = this.chain;
    this.chain = h;
    const ev: Envelope<any> = { id, device_id: this.cfg.deviceId, device_seq: seq, client_ts: ts, type, payload: body };
    this.eventCount++;
    sink({ id, device_id: this.cfg.deviceId, device_seq: seq, client_ts: ts, type, payload, card_id: body.card_id ?? '', concept_id: body.concept_id ?? '' }, ev);
    return ev;
  }

  private runDay(day: number, sink: Sink) {
    if (!this.isActive(day)) return;
    const cfg = this.cfg;
    let clock = this.sessionStart(day);
    // due list
    const due: [number, string][] = [];
    for (const [id, c] of this.proj.cards) if (c.due <= clock) due.push([c.due, id]);
    due.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
    const ready: string[] = due.slice(0, cfg.sessionCap).map((x) => x[1]);
    // new cards
    let nNew = due.length < cfg.targetDaily ? Math.min(cfg.newMax, cfg.targetDaily - due.length) : 0;
    while (nNew-- > 0 && this.introduced < cfg.cardsPool) ready.push(Simulator.cardId(this.introduced++));
    const waiting: [number, string][] = [];
    let ri = 0, count = 0;
    const cap = cfg.sessionCap + 60;
    while (count < cap) {
      let id: string | undefined;
      let wi = -1, best = Infinity;
      for (let i = 0; i < waiting.length; i++) if (waiting[i][0] <= clock && waiting[i][0] < best) { best = waiting[i][0]; wi = i; }
      if (wi >= 0) { id = waiting[wi][1]; waiting.splice(wi, 1); }
      else if (ri < ready.length) id = ready[ri++];
      else if (waiting.length) {
        let m = Infinity; for (const w of waiting) if (w[0] < m) m = w[0];
        if (m - clock <= 15 * 60_000) { clock = m; continue; }
        break;
      } else break;
      clock = this.reviewOne(id, clock, day, sink);
      count++;
      const c = this.proj.cards.get(id)!;
      if ((c.state === 1 || c.state === 3) && c.due - clock <= 30 * 60_000) waiting.push([c.due, id]);
    }
    if (cfg.correctionsPerActiveDay > 0 && day > 60 && this.rng.next() < cfg.correctionsPerActiveDay) this.emitCorrection(clock + 60_000, day, sink);
    // trim recent list
    if (this.recentReviews.length > 8000) this.recentReviews = this.recentReviews.slice(-6000);
  }

  private pickFormat(facet: (typeof FACETS)[number]) {
    let u = this.rng.next();
    for (const [f, p] of facet.formats) { if (u < p) return FORMATS[f]; u -= p; }
    return FORMATS[facet.formats[0][0]];
  }

  private reviewOne(cardId: string, clock: number, day: number, sink: Sink): number {
    const cfg = this.cfg, rng = this.rng;
    const idx = Number(cardId.slice(1));
    const { c, facet } = this.cardMeta(idx);
    const fmt = this.pickFormat(facet);
    const cs = this.proj.cards.get(cardId);
    const beta = this.betaConcept[c] + 0.5 * rng.normal();
    const theta = this.thetaTrue[c];
    const rapid = rng.next() < 0.012;
    let latency = rapid ? 400 + rng.int(700) : Math.min(90_000, Math.max(1300, Math.round(8000 * Math.exp(0.5 * rng.normal()))));
    let correct: boolean;
    let Rk = 0;
    if (!cs || cs.state === 0) {
      const pFirst = fmt.guess + (1 - fmt.guess) * 0.5 * sigmoid(theta - beta - 1);
      correct = rng.next() < pFirst;
    } else {
      const t = Math.max(0, (clock - cs.last_review!) / DAY);
      const drift = 1 + cfg.drift * Math.sin((2 * Math.PI * day) / 365);
      Rk = forgetting_curve(default_w, t, Math.max(0.01, cs.stability * this.memFactor[idx] * drift));
      const know = rng.next() < Rk;
      correct = know ? rng.next() < sigmoid(theta - beta + cfg.slipOffset) : rng.next() < fmt.guess;
    }
    let rating: number;
    if (!correct) rating = 1;
    else if (rapid) rating = 2;
    else {
      const u = rng.next();
      if (fmt.recognition) rating = u < 0.12 ? 2 : 3;
      else { const pe = Rk > 0.95 && latency < 8000 ? 0.35 : 0.15; rating = u < 0.12 ? 2 : u > 1 - pe ? 4 : 3; }
    }
    // grader
    let g: [string, number, number] = fmt.graders[0];
    if (fmt.graders.length > 1) { let u = rng.next(); for (const gg of fmt.graders) { if (u < gg[2]) { g = gg; break; } u -= gg[2]; } }
    const body: Omit<ReviewPayload, 'prev_hash'> & { fuzz_seed?: string } = {
      card_id: cardId, concept_id: 'C' + c, facet: facet.name, format: fmt.name, tier: TIERS(c),
      rating, result: correct ? 1 : 0, w_format: fmt.wFormat, w_grader: g[1], gaming_factor: rapid ? 0 : 1, rapid,
      latency_ms: latency, item_beta: Math.round(beta * 1000) / 1000, grader: g[0], policy_version: 'ldi_params@v1',
    } as any;
    // id must exist before body is finalised when fuzz seed = event id: emit() computes id, so pre-generate through a 2-phase trick
    let seedForLive: string | undefined;
    if (cfg.fuzz === 'random') seedForLive = 'r' + Math.floor(Math.random() * 1e12);
    const ts0 = clock + latency;
    let ev: Envelope<any>;
    if (cfg.fuzz === 'embedded') {
      // embedded seed = deterministic function of (device_id, device_seq): known before the id is minted
      (body as any).fuzz_seed = `${cfg.deviceId}:${this.seq + 1}`;
    }
    ev = this.emit(sink, ts0, 'review', body);
    // live projection (applies in-memory event, NOT the serialized row)
    this.projector.applyReview(this.proj, ev, cfg.fuzz === 'random' ? (seedForLive as string) : undefined);
    if (cfg.correctionsPerActiveDay > 0) {
      let a = this.byCard.get(cardId); if (!a) this.byCard.set(cardId, (a = [])); a.push(ev);
      let b = this.byConcept.get(body.concept_id); if (!b) this.byConcept.set(body.concept_id, (b = [])); b.push(ev);
      this.recentReviews.push(ev);
    }
    return Math.max(ts0, this.lastTs);
  }

  private emitCorrection(ts: number, day: number, sink: Sink) {
    // void a random review of the last ~60 days (e.g., G3: answer key wrong)
    const lim = this.cfg.startTs + (day - 60) * DAY;
    for (let tries = 0; tries < 20; tries++) {
      const tgt = this.recentReviews[this.rng.int(this.recentReviews.length)];
      if (!tgt || tgt.client_ts < lim || this.voided.has(tgt.id)) continue;
      const body = { target_id: tgt.id, card_id: tgt.payload.card_id, concept_id: tgt.payload.concept_id, reason: 'G3_answer_key_error', w_after: 0 };
      this.emit(sink, ts, 'correction', body);
      this.voided.add(tgt.id);
      this.correctionCount++;
      const cid = tgt.payload.card_id, kid = tgt.payload.concept_id;
      const cs = this.projector.foldCard(this.byCard.get(cid)!, this.voided);
      if (cs) this.proj.cards.set(cid, cs); else this.proj.cards.delete(cid);
      const ks = this.projector.foldConcept(this.byConcept.get(kid)!, this.voided);
      if (ks) this.proj.concepts.set(kid, ks); else this.proj.concepts.delete(kid);
      return;
    }
  }
}
