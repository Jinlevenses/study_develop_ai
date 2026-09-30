/**
 * promotion.ts - PURE reference implementation of the Fathom mastery / promotion rules.
 *
 * Intended reuse: `services/learning` (G03 mastery, G04 promotion). No I/O, no clock, no randomness, no globals:
 * every function takes the policy object (`MasteryRules`, mirroring `mastery_rules@v1`) and plain data.
 *
 * Spec map
 *   FR-PRG-002  evidenceWeight()            w = w_format x w_grader x gaming (frozen at write time)
 *   FR-PRG-008  expectedCorrect/applyResponse  weighted Elo, w = 0 => theta unchanged
 *   FR-PRG-009  masteryStatus()             P>=0.80 AND F>=3 (w_format>=0.7 AND w_grader>=0.6 each) AND days>=2
 *   FR-PRG-013  decidePromotion() T1..T3    concept gate | sparse-level rule, 12-item assessment, D4, Case
 *   FR-PRG-032  decidePromotion() T4        Transferred + Taught|Artifact + assessment
 *   FR-PRG-033  provisional flag, reconcileProvisional(), AI-mode profiles
 *   FR-CUR-025  computeCap()                highest level whose OFFLINE evidence exists
 */
import {
  AI_MODES,
  FORMATS,
  type AiMode,
  type EngineId,
  type FormatId,
  type FormatSpec,
  type Level,
  type MasteryRules,
  type Tier,
  type Transition,
} from './policy.ts';

/* ------------------------------------------------------------------ inventory types (plain data) */

export type Pool = Partial<Record<FormatId, number>>;
export interface ConceptRef { id: string; level: Level; tier: Tier; pool: Pool }
export interface CaseRef { id: number; level: 3 | 4 | 5; tracks: string[]; floor: boolean }
export interface TrackInventory {
  id: string;
  concepts: ConceptRef[];
  cases: CaseRef[];
  artifactTasks: number;
  declaredCap: Level;
  generatedPool: Pool;
}

/* ------------------------------------------------------------------ helpers */

const EPS = 1e-9;
/** Threshold comparison that is safe for values like 0.7*1 or 27/36 vs 0.75. */
export const geq = (a: number, b: number): boolean => a >= b - EPS;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/* ------------------------------------------------------------------ engine + weight */

/** Which engine grades a format in a given AI mode (FR-QST-017 ladder, CNV 8.2). */
export function resolveEngine(policy: MasteryRules, fmt: FormatSpec, mode: AiMode, sp1Calibrated: boolean): EngineId {
  if (fmt.gradeClass === 'D') return 'deterministic';
  if (mode === 'OFFLINE' && fmt.offlineDeterministicAlt) return 'deterministic';
  return policy.aiProfiles[mode].jEngine(sp1Calibrated);
}

export interface WeightInput {
  format: FormatId;
  engine: EngineId;
  rapid?: boolean;
  hints?: number;
  /** multiplier in [0,1] from selfBiasFactor(); only applied to engine 'self'. */
  selfBiasFactor?: number;
}
export interface EvidenceWeight { wFormat: number; wGrader: number; gaming: number; w: number }

export function evidenceWeight(policy: MasteryRules, i: WeightInput): EvidenceWeight {
  const wFormat = FORMATS[i.format].wFormat;
  let wGrader = policy.weights.grader[i.engine];
  if (i.engine === 'self' && policy.weights.selfBias.enabled) wGrader *= clamp(i.selfBiasFactor ?? 1, 0, 1);
  let gaming = i.rapid ? policy.weights.rapid : 1;
  if (!i.rapid && (i.hints ?? 0) > 0) gaming = policy.weights.hintFactor;
  return { wFormat, wGrader, gaming, w: wFormat * wGrader * gaming };
}

/** Self-grade inflation tracker: self-marked correct rate above the deterministic rate scales w_grader(self) down. */
export function selfBiasFactor(
  policy: MasteryRules,
  s: { selfCorrect: number; selfN: number; detCorrect: number; detN: number },
): number {
  if (!policy.weights.selfBias.enabled || s.selfN < 5 || s.detN < 5) return 1;
  const inflation = Math.max(0, s.selfCorrect / s.selfN - s.detCorrect / s.detN);
  return clamp(1 - policy.weights.selfBias.slope * inflation, 0, 1);
}

/* ------------------------------------------------------------------ Elo (FR-PRG-008) */

export function guessFloor(format: FormatId, nOptions?: number): number {
  const n = nOptions ?? FORMATS[format].options;
  return n > 1 ? 1 / n : 0;
}

/** P(correct) for an item. With guessCorrection: c + (1-c) * sigmoid(theta - beta). */
export function expectedCorrect(policy: MasteryRules, theta: number, beta: number, floor: number): number {
  const base = sigmoid(theta - beta);
  return policy.elo.guessCorrection ? floor + (1 - floor) * base : base;
}

export interface ConceptEvidence {
  theta: number;
  /** number of observations with w > 0 (drives the K schedule) */
  n: number;
  /** formats that already have a qualifying correct event (w_format>=0.7 AND w_grader>=0.6, w>0, not pending) */
  qualifiedFormats: FormatId[];
  qualifiedDays: number[];
  /** true if any qualifying event came from a provisional source */
  provisional: boolean;
}

export const newConceptEvidence = (policy: MasteryRules): ConceptEvidence => ({
  theta: policy.elo.theta0, n: 0, qualifiedFormats: [], qualifiedDays: [], provisional: false,
});

export interface ResponseEvent {
  day: number;
  format: FormatId;
  engine: EngineId;
  /** result AS GRADED by the engine (not ground truth) */
  correct: boolean;
  beta: number;
  nOptions?: number;
  rapid?: boolean;
  hints?: number;
  pending?: boolean;
  selfBiasFactor?: number;
}

export function countsAsFormatEvidence(policy: MasteryRules, w: EvidenceWeight, ev: ResponseEvent): boolean {
  const q = policy.mastered.formatCounts;
  return (
    ev.correct && !ev.pending && w.gaming > 0 &&
    geq(w.wFormat, q.wFormatMin) && geq(w.wGrader, q.wGraderMin)
  );
}

/** Returns a NEW evidence state; the event itself is immutable and returned with its frozen weight. */
export function applyResponse(
  policy: MasteryRules,
  st: ConceptEvidence,
  ev: ResponseEvent,
): { state: ConceptEvidence; weight: EvidenceWeight } {
  const weight = evidenceWeight(policy, ev);
  const next: ConceptEvidence = { ...st, qualifiedFormats: [...st.qualifiedFormats], qualifiedDays: [...st.qualifiedDays] };
  if (ev.pending || weight.w <= 0) return { state: next, weight: ev.pending ? { ...weight, w: 0 } : weight };
  const K = policy.elo.alpha / (1 + policy.elo.b * st.n);
  const P = expectedCorrect(policy, st.theta, ev.beta, guessFloor(ev.format, ev.nOptions));
  next.theta = clamp(st.theta + K * weight.w * ((ev.correct ? 1 : 0) - P), policy.elo.thetaMin, policy.elo.thetaMax);
  next.n = st.n + 1;
  if (countsAsFormatEvidence(policy, weight, ev)) {
    if (!next.qualifiedFormats.includes(ev.format)) next.qualifiedFormats.push(ev.format);
    if (!next.qualifiedDays.includes(ev.day)) next.qualifiedDays.push(ev.day);
  }
  return { state: next, weight };
}

/* ------------------------------------------------------------------ Mastered (FR-PRG-009) */

export interface MasteryStatus {
  p: number;
  formatsCounted: number;
  days: number;
  mastered: boolean;
  missing: string[];
}

export function masteryStatus(policy: MasteryRules, st: ConceptEvidence): MasteryStatus {
  const m = policy.mastered;
  const p = sigmoid(st.theta - m.refBeta);
  const missing: string[] = [];
  if (!geq(p, m.pMin)) missing.push(`P ${p.toFixed(3)} < ${m.pMin}`);
  if (st.qualifiedFormats.length < m.formatsMin) missing.push(`formats ${st.qualifiedFormats.length} < ${m.formatsMin}`);
  if (st.qualifiedDays.length < m.distinctDaysMin) missing.push(`days ${st.qualifiedDays.length} < ${m.distinctDaysMin}`);
  return { p, formatsCounted: st.qualifiedFormats.length, days: st.qualifiedDays.length, mastered: missing.length === 0, missing };
}

/** Formats that CAN qualify for a concept in this mode (structural, independent of the learner). */
export function qualifyingFormats(policy: MasteryRules, c: ConceptRef, mode: AiMode, sp1: boolean, pool: Pool = c.pool): FormatId[] {
  const q = policy.mastered.formatCounts;
  const out: FormatId[] = [];
  for (const [f, n] of Object.entries(pool) as [FormatId, number][]) {
    if (!n || n <= 0) continue;
    const spec = FORMATS[f];
    if (c.level < spec.minLevel || c.level > spec.maxLevel) continue;
    const engine = resolveEngine(policy, spec, mode, sp1);
    if (geq(spec.wFormat, q.wFormatMin) && geq(policy.weights.grader[engine], q.wGraderMin)) out.push(f);
  }
  return out;
}

/* ------------------------------------------------------------------ CBM + assessment (FR-PRG-012/013) */

/** cbm_params@v1 default (Gardner-Medwin): confidence -> [correct, wrong]. */
export const CBM_TABLE: Record<1 | 2 | 3, [number, number]> = { 1: [1, 0], 2: [2, -2], 3: [3, -6] };
export interface AssessmentItemResult { format: FormatId; correct: boolean; confidence: 1 | 2 | 3 }

export function cbmPercent(items: AssessmentItemResult[]): { points: number; max: number; pct: number } {
  const max = 3 * items.length;
  const points = items.reduce((s, r) => s + CBM_TABLE[r.confidence][r.correct ? 0 : 1], 0);
  return { points, max, pct: max === 0 ? 0 : Math.max(0, points) / max };
}

export interface ComposeResult { ok: boolean; plan: FormatId[]; distinctFormats: number; reason?: string }

/** Choose the 12 assessment items: only formats whose engine is a "calibrated engine" in this mode, round-robin across formats. */
export function composeAssessment(
  policy: MasteryRules, pool: Pool, level: Level, mode: AiMode, sp1: boolean,
): ComposeResult {
  const A = policy.promotion.assessment;
  const allowed = policy.aiProfiles[mode].assessmentEngines(sp1);
  const avail: [FormatId, number][] = [];
  for (const [f, n] of Object.entries(pool) as [FormatId, number][]) {
    if (!n || n <= 0) continue;
    const spec = FORMATS[f];
    if (level < spec.minLevel || level > spec.maxLevel) continue;
    if (!allowed.includes(resolveEngine(policy, spec, mode, sp1))) continue;
    avail.push([f, n]);
  }
  avail.sort((a, b) => b[1] - a[1]);
  const plan: FormatId[] = [];
  const left = new Map(avail);
  while (plan.length < A.items) {
    let progressed = false;
    for (const [f] of avail) {
      if (plan.length >= A.items) break;
      const l = left.get(f)!;
      if (l > 0) { plan.push(f); left.set(f, l - 1); progressed = true; }
    }
    if (!progressed) break;
  }
  const distinct = new Set(plan).size;
  if (plan.length < A.items) return { ok: false, plan, distinctFormats: distinct, reason: `pool ${plan.length}/${A.items} items` };
  if (distinct < A.formatsMin) return { ok: false, plan, distinctFormats: distinct, reason: `formats ${distinct}/${A.formatsMin}` };
  return { ok: true, plan, distinctFormats: distinct };
}

/* ------------------------------------------------------------------ gates */

export const neededMastered = (n: number, ratio: number): number => Math.ceil(n * ratio - EPS);

export function d4Required(policy: MasteryRules, possible: number): number {
  const d = policy.promotion.d4;
  const cap = Math.min(d.conceptsCap, possible);
  return d.floorMode === 'hard' ? Math.max(d.conceptsFloor, cap) : Math.max(Math.min(d.conceptsFloor, possible), cap);
}

export interface GateResult { id: string; ok: boolean; detail: string; provisional?: boolean }
export interface CaseResult { caseId: number; level: number; metric: 'rubric4' | 'd_fraction'; value: number; provisional: boolean }
export interface TeachingResult { conceptId: string; score: number; provisional: boolean }
export interface ArtifactResult { score: number; rebuttalDefended: boolean; provisional: boolean }
export interface D4Result { conceptId: string; engine: EngineId; provisional: boolean }

export interface PromotionSnapshot {
  from: Transition;
  mode: AiMode;
  sp1Calibrated: boolean;
  /** required (Tier A/B, this level) concept ids that are Mastered right now */
  masteredIds: string[];
  /** ... and Retained (R >= tier target); only consulted for T4 with a concept gate */
  retainedIds: string[];
  masteredProvisionalIds?: string[];
  d4: D4Result[];
  cases: CaseResult[];
  teaching: TeachingResult[];
  artifacts: ArtifactResult[];
  depthEvidence: number;
  /** Lk-item accuracy in the latest passed assessment (sparse rule) */
  assessment?: { cbmPct: number; lkAccuracy: number; distinctFormats: number; engineOk: boolean };
}

export interface PromotionDecision {
  status: 'blocked_cap' | 'not_ready' | 'ready_for_assessment' | 'promoted';
  canStartAssessment: boolean;
  provisional: boolean;
  profile: string; // shown on the decision card (FR-PRG-033)
  gates: GateResult[];
}

/** Level the learner ends up at after `from` (cap check uses this). */
export const targetLevel = (from: Transition): Level => (from + 1) as Level;

export function levelConcepts(inv: TrackInventory, level: Level): { all: ConceptRef[]; required: ConceptRef[] } {
  const all = inv.concepts.filter((c) => c.level === level);
  return { all, required: all.filter((c) => c.tier === 'A' || c.tier === 'B') };
}

export function decidePromotion(policy: MasteryRules, inv: TrackInventory, s: PromotionSnapshot): PromotionDecision {
  const P = policy.promotion;
  const profile = `${policy.version}/${s.mode}/${s.sp1Calibrated ? 'SP1-pass' : 'SP1-fail'}`;
  const gates: GateResult[] = [];
  if (targetLevel(s.from) > inv.declaredCap) {
    return { status: 'blocked_cap', canStartAssessment: false, provisional: false, profile,
      gates: [{ id: 'cap', ok: false, detail: `v1 content cap L${inv.declaredCap}` }] };
  }
  const { all, required } = levelConcepts(inv, s.from);
  const emptyLevel = all.length === 0;
  const n = required.length;
  let provisional = false;

  if (emptyLevel && P.emptyLevel === 'skip') {
    return { status: 'promoted', canStartAssessment: false, provisional: false, profile,
      gates: [{ id: 'empty_level_skip', ok: true, detail: `L${s.from} has no concepts in ${inv.id}` }] };
  }

  const useConceptGate = n >= P.minRequiredForConceptGate;
  const masteredCount = required.filter((c) => s.masteredIds.includes(c.id)).length;
  if (useConceptGate) {
    const need = neededMastered(n, P.requiredMasteredRatio);
    let ok = masteredCount >= need;
    let detail = `mastered ${masteredCount}/${n} (need ${need})`;
    if (s.from === 4) {
      const retained = required.filter((c) => s.masteredIds.includes(c.id) && s.retainedIds.includes(c.id)).length;
      ok = retained >= need;
      detail += `, retained ${retained}/${n}`;
    }
    gates.push({ id: 'G1_required_concepts', ok, detail });
    if (required.some((c) => s.masteredProvisionalIds?.includes(c.id) && s.masteredIds.includes(c.id))) provisional = true;
  } else {
    const okDepth = s.depthEvidence >= P.sparse.depthEvidenceMin;
    gates.push({ id: 'G1_sparse_depth_evidence', ok: okDepth, detail: `sparse level (n=${n} < ${P.minRequiredForConceptGate}); depth evidence ${s.depthEvidence}/${P.sparse.depthEvidenceMin}` });
  }

  if (s.from === 2) {
    const possible = d4Possible(policy, inv, s.from, s.mode);
    const need = d4Required(policy, possible);
    const got = new Set(s.d4.map((d) => d.conceptId)).size;
    gates.push({ id: 'G3_d4', ok: got >= need && possible >= need, detail: `D4 ${got}/${need} (possible ${possible})` });
    if (s.d4.some((d) => d.provisional)) provisional = true;
  }
  if (s.from === 3) {
    const need = s.mode === 'OFFLINE' ? P.caseGate.l3l4OfflineDFraction : P.caseGate.l3l4ScoreMin;
    const hit = s.cases.find((c) => c.level >= 3 && (s.mode === 'OFFLINE' ? c.metric === 'd_fraction' : c.metric === 'rubric4') && geq(c.value, need));
    gates.push({ id: 'G4_case', ok: !!hit, detail: `Case L3+ >= ${s.mode === 'OFFLINE' ? need * 100 + '% D' : need + '/4'}` });
    if (hit?.provisional) provisional = true;
  }
  if (s.from === 4) {
    const cg = P.caseGate;
    const need = s.mode === 'OFFLINE' ? cg.l4l5OfflineDFraction : cg.l4l5ScoreMin;
    const passed = s.cases.filter((c) => c.level >= 4 && (s.mode === 'OFFLINE' ? c.metric === 'd_fraction' : c.metric === 'rubric4') && geq(c.value, need));
    const uniq = new Map(passed.map((c) => [c.caseId, c]));
    const artifactOk = s.artifacts.filter((a) => geq(a.score, P.l5.artifactAvgMin) && a.rebuttalDefended).length >= 1;
    const hasL5OrArtifact = [...uniq.values()].some((c) => c.level >= 5) || artifactOk;
    gates.push({ id: 'G5_transferred', ok: uniq.size >= cg.l4l5Count && hasL5OrArtifact,
      detail: `Case L4+ >= ${need} : ${uniq.size}/${cg.l4l5Count}, L5-or-artifact ${hasL5OrArtifact}` });
    if ([...uniq.values()].some((c) => c.provisional)) provisional = true;
    const taught = s.teaching.filter((t) => geq(t.score, P.l5.teachingMin));
    const taughtOk = new Set(taught.map((t) => t.conceptId)).size >= P.l5.teachingConcepts;
    const arts = s.artifacts;
    const artAvgOk = arts.length >= P.l5.artifactCount &&
      geq(arts.slice(0, P.l5.artifactCount).reduce((x, a) => x + a.score, 0) / P.l5.artifactCount, P.l5.artifactAvgMin) &&
      arts.some((a) => a.rebuttalDefended);
    gates.push({ id: 'G6_taught_or_artifact', ok: taughtOk || artAvgOk, detail: `Taught ${new Set(taught.map((t) => t.conceptId)).size}/${P.l5.teachingConcepts} or artifacts ${arts.length}/${P.l5.artifactCount}` });
    if ((taughtOk && taught.some((t) => t.provisional)) || (!taughtOk && arts.some((a) => a.provisional))) provisional = true;
  }

  const pre = gates.every((g) => g.ok);
  if (!pre) return { status: 'not_ready', canStartAssessment: false, provisional, profile, gates };

  const a = s.assessment;
  const cbmMin = P.assessment.cbmMin[s.from];
  let aOk = !!a && a.engineOk && geq(a.cbmPct, cbmMin) && a.distinctFormats >= P.assessment.formatsMin;
  if (!useConceptGate && a) aOk = aOk && geq(a.lkAccuracy, P.sparse.lkAccuracyMin);
  if (!a) return { status: 'ready_for_assessment', canStartAssessment: true, provisional, profile, gates };
  gates.push({ id: 'G2_assessment', ok: aOk, detail: `CBM ${(a.cbmPct * 100).toFixed(1)}% (need ${cbmMin * 100}%), Lk acc ${(a.lkAccuracy * 100).toFixed(0)}%` });
  return { status: aOk ? 'promoted' : 'ready_for_assessment', canStartAssessment: !aOk, provisional: aOk && provisional, profile, gates };
}

/** D4-capable concepts of the track that the mode can run (FR-STD-020). */
export function d4Possible(policy: MasteryRules, inv: TrackInventory, from: Transition, mode: AiMode): number {
  const tiers = policy.aiProfiles[mode].d4Tiers;
  const scope = policy.promotion.d4.scope;
  return inv.concepts.filter((c) => (scope === 'any_level' || c.level <= from) && tiers.includes(c.tier)).length;
}

/* ------------------------------------------------------------------ provisional lifecycle (FR-PRG-033) */

export interface ProvisionalOutcome {
  levelAfter: number;
  flag: 'confirmed' | 'needs_reconfirmation';
  event: 'provisional_confirmed' | 'provisional_revoked';
}
/** AI is back: the pending descriptive evidence was regraded. A revoke NEVER demotes (BR-14). */
export function reconcileProvisional(levelNow: number, regradePassed: boolean): ProvisionalOutcome {
  return regradePassed
    ? { levelAfter: levelNow, flag: 'confirmed', event: 'provisional_confirmed' }
    : { levelAfter: levelNow, flag: 'needs_reconfirmation', event: 'provisional_revoked' };
}

/* ------------------------------------------------------------------ structural feasibility + cap (FR-CUR-025) */

export interface Feasibility { feasible: boolean; blockers: string[] }

function addPool(dst: Pool, src: Pool): void {
  for (const [f, n] of Object.entries(src) as [FormatId, number][]) dst[f] = (dst[f] ?? 0) + (n ?? 0);
}

/** Can ANY learner satisfy transition `from` in this mode, given only the content inventory and the policy? */
export function structuralFeasibility(
  policy: MasteryRules, inv: TrackInventory, from: Transition, mode: AiMode, sp1: boolean,
): Feasibility {
  const P = policy.promotion;
  const prof = policy.aiProfiles[mode];
  const blockers: string[] = [];
  const { all, required } = levelConcepts(inv, from);
  if (all.length === 0) {
    return P.emptyLevel === 'skip' ? { feasible: true, blockers: [] } : { feasible: false, blockers: [`EMPTY_LEVEL:L${from} has 0 concepts`] };
  }
  // assessment item pool at level k
  const pool: Pool = {};
  for (const c of required) addPool(pool, c.pool);
  if (prof.tierCOnDemand) for (const c of all.filter((x) => x.tier === 'C')) addPool(pool, inv.generatedPool);
  let comp = composeAssessment(policy, pool, from as Level, mode, sp1);
  if (!comp.ok && P.sparse.fallbackPool === 'adjacent_level_ab' && from > 1) {
    const lower = levelConcepts(inv, (from - 1) as Level).required;
    for (const c of lower) addPool(pool, c.pool);
    comp = composeAssessment(policy, pool, from as Level, mode, sp1);
  }
  if (!comp.ok) blockers.push(`NO_ASSESSMENT_POOL:L${from} ${comp.reason}`);

  if (required.length >= P.minRequiredForConceptGate) {
    for (const c of required) {
      const q = qualifyingFormats(policy, c, mode, sp1);
      if (q.length < policy.mastered.formatsMin) blockers.push(`MASTERY_FORMATS<3:${c.id}(${q.length})`);
    }
  } else {
    const hasA = required.some((c) => c.tier === 'A');
    const caseOk = from >= 3 && inv.cases.some((c) => c.level >= from);
    if (!hasA && !caseOk) blockers.push(`NO_DEPTH_ASSET:L${from}`);
  }
  if (from === 2) {
    const possible = d4Possible(policy, inv, from, mode);
    const need = d4Required(policy, possible);
    if (possible < need) blockers.push(`D4_POSSIBLE<REQUIRED:${possible}<${need}`);
    else if (possible < P.d4.conceptsFloor && P.d4.floorMode === 'hard') blockers.push(`D4_POSSIBLE<${P.d4.conceptsFloor}:${possible}`);
  }
  if (from === 3 && !inv.cases.some((c) => c.level >= 3)) blockers.push('NO_CASE_L3+');
  if (from === 4) {
    const l4 = inv.cases.filter((c) => c.level >= 4);
    if (l4.length < P.caseGate.l4l5Count) blockers.push(`CASE_L4+<${P.caseGate.l4l5Count}:${l4.length}`);
    if (!l4.some((c) => c.level >= 5) && inv.artifactTasks < 1) blockers.push('NO_L5_CASE_OR_ARTIFACT');
    const tierA = inv.concepts.filter((c) => c.tier === 'A').length;
    if (tierA < P.l5.teachingConcepts && inv.artifactTasks < P.l5.artifactCount) blockers.push('NO_TAUGHT_OR_ARTIFACT_PATH');
  }
  return { feasible: blockers.length === 0, blockers };
}

/** Highest level reachable in `mode` from L1 (FR-CUR-025 oracle; all transitions below must be feasible). */
export function computeCap(policy: MasteryRules, inv: TrackInventory, mode: AiMode = 'OFFLINE', sp1 = false): Level {
  let level = 1;
  for (const from of [1, 2, 3, 4] as Transition[]) {
    if (structuralFeasibility(policy, inv, from, mode, sp1).feasible) level = from + 1; else break;
  }
  return level as Level;
}

export { AI_MODES };
