import { R_of, type Projection, type CardState, type ConceptState } from './projection.ts';
import { TIERS } from './sim.ts';

const W: Record<string, number> = { core: 1.0, standard: 0.7, breadth: 0.4, archive: 0.2 };
const D = [0, 1, 2, 3, 5, 8];
/** Spike stand-in for ldi_params@v1: L_k derived from Elo theta (real L_k comes from mastery rules), c̄=1, F_k=1. */
export function conceptTerm(kid: string, k: ConceptState | undefined, cardsR: number, nCards: number): number {
  if (!k || !k.mastered || nCards === 0) return 0;
  const L = Math.max(1, Math.min(5, Math.round(k.theta + 1)));
  const E = 0.5 * 1 + 0.5 * Math.min(1, k.formats.length / 3);
  return W[TIERS(Number(kid.slice(1)))] * D[L] * (cardsR / nCards) * E;
}
export function ldiFull(proj: Projection, cardConcept: Map<string, string>, t: number) {
  const sumR = new Map<string, number>(), cnt = new Map<string, number>();
  for (const [id, c] of proj.cards) { const k = cardConcept.get(id)!; sumR.set(k, (sumR.get(k) ?? 0) + R_of(c, t)); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  let total = 0; const terms = new Map<string, number>();
  for (const [k, ks] of proj.concepts) { const v = conceptTerm(k, ks, sumR.get(k) ?? 0, cnt.get(k) ?? 0); terms.set(k, v); total += v; }
  return { total, terms };
}
export function ldiConceptFromCards(kid: string, k: ConceptState | undefined, cards: CardState[], t: number) {
  let s = 0; for (const c of cards) s += R_of(c, t);
  return conceptTerm(kid, k, s, cards.length);
}
