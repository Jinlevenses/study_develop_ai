import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, withFixes } from './policy.ts';
import {
  applyResponse, cbmPercent, composeAssessment, computeCap, d4Required, decidePromotion, effectiveTheta, evidenceWeight,
  geq, guessFloor, masteryStatus, neededMastered, newConceptEvidence, qualifyingFormats, reconcileProvisional,
  resolveEngine, selfBiasFactor, structuralFeasibility, type ConceptRef, type PromotionSnapshot,
} from './promotion.ts';
import { buildInventory, conceptPool } from './inventory.ts';
import { AGENTS, Rng, runCell } from './sim.ts';
import { FORMATS } from './policy.ts';

const P = DEFAULT_POLICY;
const snap = (over: Partial<PromotionSnapshot>): PromotionSnapshot => ({
  from: 1, mode: 'FULL', sp1Calibrated: true, masteredIds: [], retainedIds: [], d4: [], cases: [], teaching: [], artifacts: [], depthEvidence: 0, ...over,
});

test('evidence weight = w_format x w_grader x gaming, rapid = 0 regardless of correctness', () => {
  const w = evidenceWeight(P, { format: 'blank_note', engine: 'jev_uncalibrated' });
  assert.ok(Math.abs(w.w - 0.63) < 1e-12);
  assert.equal(evidenceWeight(P, { format: 'mcq', engine: 'deterministic', rapid: true }).w, 0);
  assert.ok(evidenceWeight(P, { format: 'mcq', engine: 'deterministic', hints: 1 }).w < evidenceWeight(P, { format: 'mcq', engine: 'deterministic' }).w);
});

test('DEC-CNV-19: format counts iff w_format>=0.7 AND w_grader>=0.6 (product is irrelevant)', () => {
  const c: ConceptRef = { id: 'x', level: 2, tier: 'A', pool: conceptPool('A', 'be') };
  const off = qualifyingFormats(P, c, 'OFFLINE', false);
  assert.ok(off.includes('mcq') && off.includes('cloze') && off.includes('matching') && off.includes('digging_d4_mcq'));
  assert.ok(!off.includes('blank_note'), 'self/heuristic-graded blank note must not count OFFLINE');
  assert.ok(!off.includes('ox'), 'OX (w_format 0.5) must not count');
  assert.ok(qualifyingFormats(P, c, 'FULL', false).includes('blank_note'), 'uncalibrated Jev (0.7*0.9=0.63) still counts');
  assert.ok(qualifyingFormats(P, c, 'LLM_ONLY', false).includes('blank_note'), 'LLM-judge 0.6 is exactly on the boundary and counts');
});

test('OX only x20 never Mastered; Tier B OFFLINE 3 deterministic formats on 2 days Mastered', () => {
  let st = newConceptEvidence(P);
  for (let i = 0; i < 20; i++) st = applyResponse(P, st, { day: 1 + (i % 3), format: 'ox', engine: 'deterministic', correct: true, beta: 0 }).state;
  assert.equal(masteryStatus(P, st).mastered, false);
  st = newConceptEvidence(P);
  const seq: [number, 'mcq' | 'cloze' | 'matching'][] = [];
  for (let i = 0; i < 12; i++) seq.push([1 + (i % 2), (['mcq', 'cloze', 'matching'] as const)[i % 3]!]);
  for (const [day, format] of seq) st = applyResponse(P, st, { day, format, engine: 'deterministic', correct: true, beta: 0 }).state;
  const m = masteryStatus(P, st);
  assert.equal(m.formatsCounted, 3);
  assert.equal(m.mastered, true, m.missing.join(','));
});

test('self-graded and pending evidence never adds a format; w=0 does not move theta', () => {
  let st = newConceptEvidence(P);
  st = applyResponse(P, st, { day: 1, format: 'blank_note', engine: 'self', correct: true, beta: 0 }).state;
  assert.equal(st.qualifiedFormats.length, 0);
  const t0 = st.theta;
  st = applyResponse(P, st, { day: 1, format: 'mcq', engine: 'deterministic', correct: true, beta: 0, rapid: true }).state;
  assert.equal(st.theta, t0);
  st = applyResponse(P, st, { day: 1, format: 'mcq', engine: 'pending', correct: true, beta: 0, pending: true }).state;
  assert.equal(st.theta, t0);
});

test('guess-corrected Elo: an OX-farming random guesser cannot raise theta; naive Elo can', () => {
  const run = (guessCorrection: boolean): number => {
    const pol = { ...P, elo: { ...P.elo, guessCorrection } };
    const rng = new Rng(7);
    let st = newConceptEvidence(pol);
    for (let i = 0; i < 600; i++) st = applyResponse(pol, st, { day: i, format: 'ox', engine: 'deterministic', correct: rng.chance(0.5), beta: rng.normal(0, 0.35) }).state;
    return st.theta - pol.elo.theta0;
  };
  assert.ok(run(true) < 0.02, 'guess-corrected');
  assert.ok(run(false) > 0.3, 'naive Elo must inflate, otherwise the fix is unnecessary');
  assert.equal(guessFloor('ox'), 0.5);
  assert.equal(guessFloor('cloze'), 0);
});

test('required-concept ratio: 85% is effectively 100% up to n=6', () => {
  assert.deepEqual([3, 4, 5, 6, 7, 8, 12].map((n) => neededMastered(n, 0.85)), [3, 4, 5, 6, 6, 7, 11]);
});

test('CBM boundaries: one wrong at C3 out of 12 = 75% exactly and passes both 70% and 75%', () => {
  const items = (wrong: number) => Array.from({ length: 12 }, (_, i) => ({ format: 'mcq' as const, correct: i >= wrong, confidence: 3 as const }));
  assert.equal(cbmPercent(items(0)).pct, 1);
  assert.equal(cbmPercent(items(1)).pct, 0.75);
  assert.ok(geq(cbmPercent(items(1)).pct, P.promotion.assessment.cbmMin[4]));
  assert.ok(!geq(cbmPercent(items(2)).pct, P.promotion.assessment.cbmMin[1]));
  const allC2 = Array.from({ length: 12 }, () => ({ format: 'mcq' as const, correct: true, confidence: 2 as const }));
  assert.ok(cbmPercent(allC2).pct < 0.7, 'a perfect but honest C2 learner cannot pass');
  assert.equal(cbmPercent(items(12)).pct, 0, 'negative totals clamp to 0');
});

test('assessment composition needs 12 items and >=4 formats from calibrated engines only', () => {
  const ok = composeAssessment(P, { ox: 7, mcq: 3, cloze: 6, matching: 4 }, 3, 'OFFLINE', false);
  assert.equal(ok.ok, true);
  assert.equal(composeAssessment(P, { mcq: 10, cloze: 10, matching: 10 }, 3, 'OFFLINE', false).ok, false); // 3 formats
  assert.equal(composeAssessment(P, { mcq: 3, cloze: 3, matching: 3, ox: 2 }, 3, 'OFFLINE', false).ok, false); // 11 items
  // blank_note is Jev-graded: allowed only when SP-1 calibrated
  const withNote = { mcq: 6, cloze: 6, matching: 0, ox: 0, blank_note: 3 };
  assert.equal(composeAssessment(P, withNote, 2, 'FULL', true).distinctFormats, 3);
  assert.equal(resolveEngine(P, FORMATS.blank_note, 'FULL', false), 'jev_uncalibrated');
  assert.equal(resolveEngine(P, FORMATS.digging_d4_mcq, 'OFFLINE', false), 'deterministic');
});

test('D4 gate: hard floor of 2 makes a track with 1 D4-capable concept unreachable; F3 relaxes it', () => {
  assert.equal(d4Required(P, 1), 2);
  assert.equal(d4Required(P, 3), 3);
  assert.equal(d4Required(P, 9), 5);
  assert.equal(d4Required(withFixes(P, { F3: true }), 1), 1);
});

test('decidePromotion: cap is enforced and OFFLINE Case promotion is provisional', () => {
  const inv = buildInventory();
  assert.equal(decidePromotion(P, inv.alg, snap({ from: 4 })).status, 'blocked_cap');
  const req = inv.be.concepts.filter((c) => c.level === 3 && c.tier !== 'C').map((c) => c.id);
  const base = snap({
    from: 3, mode: 'OFFLINE', sp1Calibrated: false, masteredIds: req, depthEvidence: 1,
    cases: [{ caseId: 2, level: 3, metric: 'd_fraction', value: 0.75, provisional: true }],
    assessment: { cbmPct: 0.75, lkAccuracy: 0.9, distinctFormats: 4, engineOk: true },
  });
  const d = decidePromotion(P, inv.be, base);
  assert.equal(d.status, 'promoted');
  assert.equal(d.provisional, true);
  assert.match(d.profile, /OFFLINE/);
  const noCase = decidePromotion(P, inv.be, { ...base, cases: [] });
  assert.equal(noCase.status, 'not_ready');
});

test('provisional revoke never demotes (BR-14)', () => {
  const r = reconcileProvisional(4, false);
  assert.equal(r.levelAfter, 4);
  assert.equal(r.flag, 'needs_reconfirmation');
  assert.equal(r.event, 'provisional_revoked');
  assert.equal(reconcileProvisional(4, true).event, 'provisional_confirmed');
});

test('self-bias tracker shrinks self weight only when inflation is visible', () => {
  assert.equal(selfBiasFactor(P, { selfCorrect: 10, selfN: 10, detCorrect: 0, detN: 2 }), 1); // no baseline -> cannot tell (documented hole)
  assert.equal(selfBiasFactor(P, { selfCorrect: 10, selfN: 10, detCorrect: 1, detN: 10 }), 0);
  assert.ok(selfBiasFactor(P, { selfCorrect: 9, selfN: 10, detCorrect: 85, detN: 100 }) >= 0.89);
});

test('inventory oracle: declared cap tracks match structural OFFLINE cap except the documented gaps', () => {
  const inv = buildInventory();
  const gaps = ['docker', 'cicd', 'cloud', 'ml', 'eng', 'arch', 'lead'];
  for (const t of Object.keys(inv) as (keyof typeof inv)[]) {
    const cap = computeCap(P, inv[t], 'OFFLINE');
    if (gaps.includes(t)) assert.ok(cap < inv[t].declaredCap, `${t} expected to fall short of its declared cap`);
    else assert.equal(cap, inv[t].declaredCap, t);
  }
  const fixed = buildInventory({ brief: { 'docker:4': 1, 'cicd:4': 1, 'cloud:4': 1, 'ml:4': 1, 'eng:4': 1, 'lead:2': 1, 'lead:3': 1 } });
  const pol = withFixes(P, { F1: true, F3: true });
  for (const t of Object.keys(fixed) as (keyof typeof fixed)[]) assert.equal(computeCap(pol, fixed[t], 'OFFLINE'), fixed[t].declaredCap, t);
  assert.equal(structuralFeasibility(P, inv.lead, 3, 'FULL', true).feasible, true);
});

test('simulation is deterministic per seed', () => {
  const inv = buildInventory();
  const a = runCell({ policy: P, inv: inv.k8s, from: 3, mode: 'OFFLINE', sp1: false, agent: AGENTS.realistic, seed: 42, horizonDays: 120 });
  const b = runCell({ policy: P, inv: inv.k8s, from: 3, mode: 'OFFLINE', sp1: false, agent: AGENTS.realistic, seed: 42, horizonDays: 120 });
  assert.deepEqual(a, b);
});

test('F4: self-mark farming inflates theta as written, but effective theta is capped and Mastered stays impossible', () => {
  const fixed = withFixes(P, { F4: true });
  let a = newConceptEvidence(P), b = newConceptEvidence(fixed);
  for (let i = 0; i < 400; i++) {
    const ev = { day: 1 + (i % 5), format: 'blank_note' as const, engine: 'self' as const, correct: true, beta: 0 };
    a = applyResponse(P, a, ev).state; b = applyResponse(fixed, b, ev).state;
  }
  assert.ok(effectiveTheta(P, a) > 1.386, 'as written: P >= 0.8 from self marks alone');
  assert.ok(effectiveTheta(fixed, b) <= fixed.elo.theta0 + 1e-9);
  assert.equal(masteryStatus(fixed, b).mastered, false);
});
