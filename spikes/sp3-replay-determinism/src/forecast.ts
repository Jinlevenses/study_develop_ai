import { DAY } from './util.ts';
import { Projector, R_of, newCardState, type CardState } from './projection.ts';

export interface Tuples { n: number; ts: Float64Array; code: Uint8Array; card: Int32Array }
export const makeTuples = (cap: number): Tuples => ({ n: 0, ts: new Float64Array(cap), code: new Uint8Array(cap), card: new Int32Array(cap) });
/** code = stateBefore(0..3) | rating << 2 ; stateBefore 0 == first event of the card */
export function pushTuple(t: Tuples, ts: number, before: CardState | undefined, rating: number, cardIdx: number) {
  t.ts[t.n] = ts; t.code[t.n] = (before ? before.state : 0) | (rating << 2); t.card[t.n] = cardIdx; t.n++;
}
const lowerBound = (a: Float64Array, n: number, x: number) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };

export interface Stats { pFirst: number; pStep: number; pReview: number; hardShare: number; easyShare: number; newPerDay: number; nReview: number }
export function windowStats(t: Tuples, t0: number, days = 90): Stats {
  const i0 = lowerBound(t.ts, t.n, t0 - days * DAY), i1 = lowerBound(t.ts, t.n, t0);
  const tot = [0, 0, 0, 0], ok = [0, 0, 0, 0]; let hard = 0, easy = 0, sRev = 0;
  for (let i = i0; i < i1; i++) {
    const st = t.code[i] & 3, r = t.code[i] >> 2;
    tot[st]++; if (r >= 2) ok[st]++;
    if (st === 2 && r >= 2) { sRev++; if (r === 2) hard++; if (r === 4) easy++; }
  }
  const stepTot = tot[1] + tot[3], stepOk = ok[1] + ok[3];
  return { pFirst: ok[0] / Math.max(1, tot[0]), pStep: stepOk / Math.max(1, stepTot), pReview: ok[2] / Math.max(1, tot[2]), hardShare: hard / Math.max(1, sRev), easyShare: easy / Math.max(1, sRev), newPerDay: tot[0] / days, nReview: tot[2] };
}
export function actualLoad(t: Tuples, t0: number, H: number, known: Set<number>) {
  const ex = new Array(H).fill(0), nw = new Array(H).fill(0);
  const i0 = lowerBound(t.ts, t.n, t0), i1 = lowerBound(t.ts, t.n, t0 + H * DAY);
  for (let i = i0; i < i1; i++) { const d = Math.floor((t.ts[i] - t0) / DAY); (known.has(t.card[i]) ? ex : nw)[d]++; }
  return { ex, nw };
}

export type Mode = 'model' | 'observed';
export function forecast(pr: Projector, cards: Iterable<CardState>, t0: number, H: number, st: Stats, mode: Mode, eps = 0.02) {
  const f = pr.f;
  const gs = 1 - st.hardShare - st.easyShare;
  const walk = (card: CardState, prob: number, out: number[]) => {
    const tr = Math.max(card.due, t0);
    const d = Math.floor((tr - t0) / DAY);
    if (d >= H) return;
    out[d] += prob;
    let r: number;
    if (card.state === 0) r = st.pFirst; else if (card.state === 2) r = mode === 'model' ? Math.min(0.999, R_of(card, tr)) : st.pReview; else r = st.pStep;
    const nx = (g: number) => { const c = f.next(card as any, tr, g as any).card; return { due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days, learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state as number, last_review: c.last_review!.getTime() } as CardState; };
    if (prob < eps) { walk(nx(3), prob, out); return; } // tail: keep expected mass on the modal path only
    walk(nx(1), prob * (1 - r), out);
    if (card.state === 2) { walk(nx(2), prob * r * st.hardShare, out); walk(nx(3), prob * r * gs, out); walk(nx(4), prob * r * st.easyShare, out); }
    else walk(nx(3), prob * r, out);
  };
  const ex = new Array(H).fill(0);
  for (const c of cards) if (c.state !== 0 && c.due < t0 + H * DAY) walk(c, 1, ex);
  // new-card curve (one card introduced at t0+19h), convolved with the observed introduction rate
  const curve = new Array(H).fill(0);
  const nc = newCardState(t0 + 19 * 3_600_000);
  walk(nc, 1, curve);
  const nw = new Array(H).fill(0);
  for (let j = 0; j < H; j++) for (let d = j; d < H; d++) nw[d] += st.newPerDay * curve[d - j];
  return { ex, nw };
}
