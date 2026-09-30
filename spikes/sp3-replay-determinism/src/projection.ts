import { fsrs, generatorParameters, StrategyMode, DefaultInitSeedStrategy, forgetting_curve, default_w, type FSRS } from 'ts-fsrs';
import { createHash } from 'node:crypto';

export interface CardState {
  due: number; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number;
  learning_steps: number; reps: number; lapses: number; state: number; last_review: number | null;
}
export interface ConceptState {
  theta: number; n: number; w_sum: number; beta_wsum: number;
  formats: string[]; day1: number; day2: number; mastered: boolean; first_mastered_ts: number; last_ts: number;
}
export interface ReviewPayload {
  card_id: string; concept_id: string; facet: string; format: string; tier: string;
  rating: number; result: number; w_format: number; w_grader: number; gaming_factor: number; rapid: boolean;
  latency_ms: number; item_beta: number; grader: string; policy_version: string; fuzz_seed?: string; prev_hash: string;
}
export interface Envelope<P = any> { id: string; device_id: string; device_seq: number; client_ts: number; type: string; payload: P }
export interface Projection { cards: Map<string, CardState>; concepts: Map<string, ConceptState> }

export const ELO_K = 0.2;
export const MASTER_P = 0.8;
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface FsrsCfg { fuzz: boolean; shortTerm: boolean; retention: number }
export const DEFAULT_FSRS_CFG: FsrsCfg = { fuzz: false, shortTerm: true, retention: 0.9 };

export function newCardState(ts: number): CardState {
  return { due: ts, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null };
}

/** Pure reducer: (state, event) -> state. Everything it needs is inside the event. */
export class Projector {
  readonly f: FSRS;
  private seedVal: string | undefined;
  constructor(public cfg: FsrsCfg = DEFAULT_FSRS_CFG) {
    this.f = fsrs(generatorParameters({ enable_fuzz: cfg.fuzz, enable_short_term: cfg.shortTerm, request_retention: cfg.retention }));
    const self = this;
    // Seed strategy: explicit per-event seed (embedded in the event) wins; otherwise the library default.
    this.f.useStrategy(StrategyMode.SEED, function (this: any) {
      return self.seedVal !== undefined ? self.seedVal : (DefaultInitSeedStrategy as any).call(this);
    });
  }
  applyCard(c: CardState | undefined, ts: number, rating: number, seed?: string): CardState {
    const input = c ?? newCardState(ts);
    this.seedVal = seed;
    const { card } = this.f.next(input as any, ts, rating as any);
    return {
      due: card.due.getTime(), stability: card.stability, difficulty: card.difficulty,
      elapsed_days: card.elapsed_days, scheduled_days: card.scheduled_days, learning_steps: card.learning_steps,
      reps: card.reps, lapses: card.lapses, state: card.state, last_review: card.last_review ? card.last_review.getTime() : null,
    };
  }
  applyConcept(s: ConceptState | undefined, p: ReviewPayload, ts: number): ConceptState {
    const c: ConceptState = s
      ? { ...s, formats: s.formats.slice() }
      : { theta: 0, n: 0, w_sum: 0, beta_wsum: 0, formats: [], day1: -1, day2: -1, mastered: false, first_mastered_ts: -1, last_ts: ts };
    const w = p.w_format * p.w_grader * p.gaming_factor;
    if (w > 0) {
      const P = sigmoid(c.theta - p.item_beta);
      c.theta += ELO_K * w * (p.result - P);
      c.n += 1; c.w_sum += w; c.beta_wsum += w * p.item_beta;
      if (p.result === 1 && p.w_format >= 0.7 && p.w_grader >= 0.6 && !p.rapid) {
        if (!c.formats.includes(p.format)) { c.formats.push(p.format); c.formats.sort(); }
        const day = Math.floor(ts / 86_400_000);
        if (c.day1 < 0) c.day1 = day; else if (c.day2 < 0 && day !== c.day1) c.day2 = day;
      }
    }
    const betaMean = c.w_sum > 0 ? c.beta_wsum / c.w_sum : 0;
    c.mastered = sigmoid(c.theta - betaMean) >= MASTER_P && c.formats.length >= 3 && c.day1 >= 0 && c.day2 >= 0;
    if (c.mastered && c.first_mastered_ts < 0) c.first_mastered_ts = ts;
    c.last_ts = ts;
    return c;
  }
  applyReview(proj: Projection, ev: Envelope<ReviewPayload>, seedOverride?: string | null) {
    const p = ev.payload;
    const seed = seedOverride === null ? undefined : (seedOverride ?? p.fuzz_seed);
    proj.cards.set(p.card_id, this.applyCard(proj.cards.get(p.card_id), ev.client_ts, p.rating, seed));
    proj.concepts.set(p.concept_id, this.applyConcept(proj.concepts.get(p.concept_id), p, ev.client_ts));
  }
  /** fold a card's events (already in total order, voided ones skipped) */
  foldCard(events: Iterable<Envelope<ReviewPayload>>, voided: Set<string>): CardState | undefined {
    let c: CardState | undefined;
    for (const e of events) { if (e.type !== 'review' || voided.has(e.id)) continue; c = this.applyCard(c, e.client_ts, e.payload.rating, e.payload.fuzz_seed); }
    return c;
  }
  foldConcept(events: Iterable<Envelope<ReviewPayload>>, voided: Set<string>): ConceptState | undefined {
    let c: ConceptState | undefined;
    for (const e of events) { if (e.type !== 'review' || voided.has(e.id)) continue; c = this.applyConcept(c, e.payload, e.client_ts); }
    return c;
  }
}

export const canonCard = (id: string, c: CardState) =>
  `${id}|${c.due}|${c.stability}|${c.difficulty}|${c.elapsed_days}|${c.scheduled_days}|${c.learning_steps}|${c.reps}|${c.lapses}|${c.state}|${c.last_review}`;
export const canonConcept = (id: string, c: ConceptState) =>
  `${id}|${c.theta}|${c.n}|${c.w_sum}|${c.beta_wsum}|${c.formats.join(',')}|${c.day1}|${c.day2}|${c.mastered ? 1 : 0}|${c.first_mastered_ts}|${c.last_ts}`;

/** Byte-exact projection hash: numbers via JS shortest round-trip repr (bit-exact), keys sorted bytewise. */
export function projectionHash(proj: Projection): string {
  const h = createHash('sha256');
  h.update(`cards:${proj.cards.size}\n`);
  for (const id of [...proj.cards.keys()].sort()) h.update(canonCard(id, proj.cards.get(id)!) + '\n');
  h.update(`concepts:${proj.concepts.size}\n`);
  for (const id of [...proj.concepts.keys()].sort()) h.update(canonConcept(id, proj.concepts.get(id)!) + '\n');
  return h.digest('hex');
}

export function diffProjection(a: Projection, b: Projection) {
  let cardDiff = 0, conceptDiff = 0;
  const ids = new Set([...a.cards.keys(), ...b.cards.keys()]);
  for (const id of ids) { const x = a.cards.get(id), y = b.cards.get(id); if (!x || !y || canonCard(id, x) !== canonCard(id, y)) cardDiff++; }
  const cids = new Set([...a.concepts.keys(), ...b.concepts.keys()]);
  for (const id of cids) { const x = a.concepts.get(id), y = b.concepts.get(id); if (!x || !y || canonConcept(id, x) !== canonConcept(id, y)) conceptDiff++; }
  return { cardDiff, conceptDiff, cards: ids.size, concepts: cids.size };
}

export function cloneProjection(p: Projection): Projection {
  const cards = new Map<string, CardState>(); for (const [k, v] of p.cards) cards.set(k, { ...v });
  const concepts = new Map<string, ConceptState>(); for (const [k, v] of p.concepts) concepts.set(k, { ...v, formats: v.formats.slice() });
  return { cards, concepts };
}

export const R_of = (c: CardState, ts: number): number =>
  c.state === 0 || c.last_review === null ? 0 : forgetting_curve(default_w, Math.max(0, (ts - c.last_review) / 86_400_000), c.stability);

/** Reviews: replay input is the payload only. Apply a whole event stream. */
export function applyStream(pr: Projector, proj: Projection, events: Iterable<Envelope<any>>, voided: Set<string>, hook?: (ev: Envelope<ReviewPayload>, before: CardState | undefined) => void) {
  let n = 0;
  for (const ev of events) {
    if (ev.type === 'review' && !voided.has(ev.id)) {
      if (hook) hook(ev, proj.cards.get(ev.payload.card_id));
      pr.applyReview(proj, ev);
      n++;
    }
  }
  return n;
}
