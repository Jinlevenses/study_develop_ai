/**
 * sim.ts - Monte-Carlo learner agents that drive the pure promotion module.
 * Nothing here is spec; it is a stochastic environment. All agent numbers are [ASSUME] and are printed in the report.
 */
import {
  FORMATS,
  type AiMode,
  type EngineId,
  type FormatId,
  type Level,
  type MasteryRules,
  type Transition,
} from './policy.ts';
import {
  applyResponse,
  cbmPercent,
  clamp,
  composeAssessment,
  d4Possible,
  d4Required,
  decidePromotion,
  effectiveTheta,
  guessFloor,
  levelConcepts,
  masteryStatus,
  newConceptEvidence,
  qualifyingFormats,
  resolveEngine,
  selfBiasFactor,
  sigmoid,
  type ArtifactResult,
  type AssessmentItemResult,
  type CaseResult,
  type ConceptEvidence,
  type ConceptRef,
  type D4Result,
  type Pool,
  type PromotionSnapshot,
  type TeachingResult,
  type TrackInventory,
} from './promotion.ts';

/* ------------------------------------------------------------------ RNG */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal(mu = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12), v = this.next();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  chance(p: number): boolean { return this.next() < p; }
}
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ------------------------------------------------------------------ agents */
export type AgentId = 'ideal' | 'realistic' | 'random' | 'random_ox' | 'gamer_pure' | 'gamer_seq';
export interface AgentSpec {
  id: AgentId;
  /** true competence as a function of exposures; guess agents ignore it */
  thetaStart: number; thetaMax: number; thetaMaxSd: number; tau: number;
  slip: number;
  guess: boolean;
  itemsPerDay: number;
  activeDayProb: number;
  rapidRate: number; hintRate: number;
  /** self-grading: P(mark correct | actually wrong) and P(mark wrong | actually correct) */
  selfFP: number; selfFN: number;
  overconfidence: number; randomConfidence: boolean; alwaysC3: boolean;
  caseMu: number; caseSd: number;
  teachMu: number; teachSd: number;
  artMu: number; artSd: number; defendProb: number;
  d4Prob: number;
  selfTeachInflation: number;
  /** router bias: only these formats are used when the concept has them (adversarial farming) */
  favoriteFormats?: FormatId[] | ((day: number) => FormatId[]);
}

export const AGENTS: Record<AgentId, AgentSpec> = {
  ideal: {
    id: 'ideal', thetaStart: 2.8, thetaMax: 2.8, thetaMaxSd: 0, tau: 1, slip: 0, guess: false,
    itemsPerDay: 24, activeDayProb: 1, rapidRate: 0, hintRate: 0, selfFP: 0.05, selfFN: 0.05,
    overconfidence: 0, randomConfidence: false, alwaysC3: false,
    caseMu: 3.5, caseSd: 0.25, teachMu: 0.92, teachSd: 0.04, artMu: 3.4, artSd: 0.25, defendProb: 1, d4Prob: 0.95,
    selfTeachInflation: 0.03,
  },
  realistic: {
    id: 'realistic', thetaStart: -0.5, thetaMax: 2.3, thetaMaxSd: 0.5, tau: 10, slip: 0.04, guess: false,
    itemsPerDay: 14, activeDayProb: 5 / 7, rapidRate: 0.08, hintRate: 0.10, selfFP: 0.15, selfFN: 0.05,
    overconfidence: 0.08, randomConfidence: false, alwaysC3: false,
    caseMu: 2.9, caseSd: 0.55, teachMu: 0.78, teachSd: 0.10, artMu: 2.9, artSd: 0.40, defendProb: 0.7, d4Prob: 0.55,
    selfTeachInflation: 0.08,
  },
  random: {
    id: 'random', thetaStart: -9, thetaMax: -9, thetaMaxSd: 0, tau: 1, slip: 0, guess: true,
    itemsPerDay: 60, activeDayProb: 1, rapidRate: 0, /* slow, gaming-aware guesser (worst case for w) */ hintRate: 0,
    selfFP: 0, selfFN: 0, overconfidence: 0, randomConfidence: true, alwaysC3: false,
    caseMu: 0.4, caseSd: 0.3, teachMu: 0.1, teachSd: 0.05, artMu: 0.4, artSd: 0.3, defendProb: 0, d4Prob: 0,
    selfTeachInflation: 0,
  },
  random_ox: {
    // pure guesser that farms the highest-chance format (OX sprint, 50% floor)
    id: 'random_ox', thetaStart: -9, thetaMax: -9, thetaMaxSd: 0, tau: 1, slip: 0, guess: true,
    itemsPerDay: 60, activeDayProb: 1, rapidRate: 0, hintRate: 0,
    selfFP: 0, selfFN: 0, overconfidence: 0, randomConfidence: true, alwaysC3: false,
    caseMu: 0.4, caseSd: 0.3, teachMu: 0.1, teachSd: 0.05, artMu: 0.4, artSd: 0.3, defendProb: 0, d4Prob: 0,
    selfTeachInflation: 0, favoriteFormats: ['ox'],
  },
  gamer_pure: {
    // dishonest self-grader that farms only self-graded items (OFFLINE blank-note ladder): marks everything correct, C3
    id: 'gamer_pure', thetaStart: -9, thetaMax: -9, thetaMaxSd: 0, tau: 1, slip: 0, guess: true,
    itemsPerDay: 60, activeDayProb: 1, rapidRate: 0, hintRate: 0,
    selfFP: 1, selfFN: 0, overconfidence: 0, randomConfidence: false, alwaysC3: true,
    caseMu: 0.4, caseSd: 0.3, teachMu: 0.1, teachSd: 0.05, artMu: 0.4, artSd: 0.3, defendProb: 0, d4Prob: 0,
    selfTeachInflation: 1, favoriteFormats: ['blank_note'],
  },
  gamer_seq: {
    // two-phase attack: first inflate theta with self-marks (no deterministic baseline exists yet), then guess deterministic formats to collect F>=3 by luck
    id: 'gamer_seq', thetaStart: -9, thetaMax: -9, thetaMaxSd: 0, tau: 1, slip: 0, guess: true,
    itemsPerDay: 60, activeDayProb: 1, rapidRate: 0, hintRate: 0,
    selfFP: 1, selfFN: 0, overconfidence: 0, randomConfidence: false, alwaysC3: true,
    caseMu: 0.4, caseSd: 0.3, teachMu: 0.1, teachSd: 0.05, artMu: 0.4, artSd: 0.3, defendProb: 0, d4Prob: 0,
    selfTeachInflation: 1,
    favoriteFormats: (day: number): FormatId[] => (day <= 30 ? ['blank_note'] : ['mcq', 'matching', 'confusable', 'error_find', 'audit', 'blank_note']),
  },
};

const GRADER_FLIP: Partial<Record<EngineId, number>> = { jev_calibrated: 0.05, jev_uncalibrated: 0.10, llm_judge: 0.10 };
const RUBRIC_NOISE: Partial<Record<EngineId, number>> = { jev_calibrated: 0.25, jev_uncalibrated: 0.4, llm_judge: 0.5 };
const TEACH_NOISE: Partial<Record<EngineId, number>> = { jev_calibrated: 0.05, jev_uncalibrated: 0.08, llm_judge: 0.12 };

/* ------------------------------------------------------------------ run result */
export interface CellResult {
  reached: boolean;
  provisional: boolean;
  day: number | null;
  attempts: number;
  status: string;
  lastGates: string[];
  /** guess-agent diagnostics */
  thetaDeltas?: number[];
  exposures?: number[];
  maxTheta?: number[];
  masteredCount?: number;
  eventCount?: number;
  poolReuse?: number;
}

export interface RunOptions {
  policy: MasteryRules;
  inv: TrackInventory;
  from: Transition;
  mode: AiMode;
  sp1: boolean;
  agent: AgentSpec;
  seed: number;
  horizonDays: number;
}

interface ConceptRun {
  ref: ConceptRef;
  ev: ConceptEvidence;
  thetaMax: number;
  exposures: number;
  used: Partial<Record<FormatId, number>>;
  d4: boolean;
  tries: { d4: number };
  peak: number;
}

/** Run one agent through one (track, transition, mode, sp1) cell. */
export function runCell(o: RunOptions): CellResult {
  const { policy, inv, from, mode, sp1, agent, horizonDays } = o;
  const rng = new Rng(o.seed);
  const P = policy.promotion;
  const prof = policy.aiProfiles[mode];
  const { all, required } = levelConcepts(inv, from);
  const rubricEngine = prof.rubricEngine(sp1);

  const mk = (c: ConceptRef): ConceptRun => ({
    ref: c, ev: newConceptEvidence(policy),
    thetaMax: agent.thetaMax + rng.normal(0, agent.thetaMaxSd),
    exposures: 0, used: {}, d4: false, tries: { d4: 0 }, peak: policy.elo.theta0,
  });
  // concepts that can be studied at this level: A/B always, C only if AI can materialise them
  const studyRefs: ConceptRef[] = [...required];
  if (prof.tierCOnDemand) for (const c of all.filter((x) => x.tier === 'C')) studyRefs.push({ ...c, pool: inv.generatedPool });
  const runs = new Map<string, ConceptRun>(studyRefs.map((c) => [c.id, mk(c)]));
  // D4 candidates: level<=k (or any) concepts whose tier the mode can dig on (uses the full track list)
  const d4Refs = inv.concepts.filter((c) => (P.d4.scope === 'any_level' || c.level <= from) && prof.d4Tiers.includes(c.tier));
  for (const c of d4Refs) if (!runs.has(c.id)) runs.set(c.id, mk(prof.tierCOnDemand && c.tier === 'C' ? { ...c, pool: inv.generatedPool } : c));

  const trueTheta = (r: ConceptRun): number =>
    agent.guess ? -9 : agent.thetaStart + (r.thetaMax - agent.thetaStart) * (1 - Math.exp(-r.exposures / agent.tau));

  // per-track self/deterministic accuracy for the bias tracker
  const bias = { selfCorrect: 0, selfN: 0, detCorrect: 0, detN: 0 };
  let eventCount = 0;
  let poolReuse = 0;

  const pTrue = (r: ConceptRun | null, format: FormatId, nOptions: number, beta: number): number => {
    const floor = guessFloor(format, nOptions);
    if (agent.guess) return floor; // pure chance, open answers ~ 0
    const th = r ? trueTheta(r) : agent.thetaMax;
    const base = sigmoid(th - beta);
    return clamp((floor + (1 - floor) * base) * (1 - agent.slip), 0, 1);
  };

  const gradeReport = (engine: EngineId, actual: boolean): boolean => {
    if (engine === 'deterministic') return actual;
    if (engine === 'self') return actual ? !rng.chance(agent.selfFN) : rng.chance(agent.selfFP);
    const flip = GRADER_FLIP[engine] ?? 0;
    return rng.chance(flip) ? !actual : actual;
  };

  const confidenceFor = (p: number): 1 | 2 | 3 => {
    if (agent.alwaysC3) return 3;
    if (agent.randomConfidence) return (1 + Math.floor(rng.next() * 3)) as 1 | 2 | 3;
    const b = p + agent.overconfidence;
    return b > 0.8 ? 3 : b >= 0.67 ? 2 : 1;
  };

  const respond = (r: ConceptRun, format: FormatId, day: number, opts: { forceEngine?: EngineId } = {}): void => {
    const spec = FORMATS[format];
    const engine = opts.forceEngine ?? resolveEngine(policy, spec, mode, sp1);
    const beta = rng.normal(0, 0.35);
    const nOptions = spec.options;
    const p = pTrue(r, format, nOptions, beta);
    const actual = rng.chance(p);
    const graded = gradeReport(engine, actual);
    const rapid = rng.chance(agent.rapidRate);
    const hints = rng.chance(agent.hintRate) ? 1 : 0;
    const bf = selfBiasFactor(policy, bias);
    const { state } = applyResponse(policy, r.ev, { day, format, engine, correct: graded, beta, nOptions, rapid, hints, selfBiasFactor: bf });
    r.ev = state;
    r.peak = Math.max(r.peak, effectiveTheta(policy, state));
    r.exposures++;
    eventCount++;
    if (engine === 'self') { bias.selfN++; if (graded) bias.selfCorrect++; }
    else if (engine === 'deterministic') { bias.detN++; if (actual) bias.detCorrect++; }
    const u = (r.used[format] ?? 0) + 1;
    r.used[format] = u;
    if (u > (r.ref.pool[format] ?? 0)) poolReuse++;
  };

  const studyFormats = (r: ConceptRun, day: number): FormatId[] => {
    const q = new Set(qualifyingFormats(policy, r.ref, mode, sp1));
    const list: FormatId[] = [];
    for (const [f, n] of Object.entries(r.ref.pool) as [FormatId, number][]) {
      if (!n || f === 'digging_d4_mcq') continue;
      const spec = FORMATS[f];
      if (r.ref.level < spec.minLevel || r.ref.level > spec.maxLevel) continue;
      list.push(f);
    }
    if (agent.favoriteFormats) {
      const want = typeof agent.favoriteFormats === 'function' ? agent.favoriteFormats(day) : agent.favoriteFormats;
      const fav = want.filter((f) => list.includes(f));
      if (fav.length) return fav;
    }
    const missing = list.filter((f) => q.has(f) && !r.ev.qualifiedFormats.includes(f));
    const qual = list.filter((f) => q.has(f));
    const warm = list.filter((f) => !q.has(f));
    return [...missing, ...qual, ...(warm.length ? warm.slice(0, 1) : [])];
  };

  /* ---- state of the promotion evidence */
  const d4Done = new Map<string, D4Result>();
  const cases: CaseResult[] = [];
  const caseAttempts = new Map<number, number>();
  const teaching: TeachingResult[] = [];
  const teachAttempts = new Map<string, number>();
  const artifacts: ArtifactResult[] = [];
  let artifactAttempts = 0;
  let depthEvidence = 0;
  let assessment: PromotionSnapshot['assessment'];
  let nextAssessmentDay = 1;
  let attempts = 0;
  let promoted = false;
  let promotedProvisional = false;
  let promotedDay: number | null = null;
  let lastGates: string[] = [];
  let lastStatus = 'not_ready';
  let rrIdx = 0;

  const studyList = [...runs.values()].filter((r) => required.some((q) => q.id === r.ref.id) || (r.ref.tier === 'C' && prof.tierCOnDemand && all.some((a) => a.id === r.ref.id)));

  const masteredIds = (): string[] => required.filter((c) => masteryStatus(policy, runs.get(c.id)!.ev).mastered).map((c) => c.id);

  const snapshot = (): PromotionSnapshot => {
    const m = masteredIds();
    return {
      from, mode, sp1Calibrated: sp1, masteredIds: m, retainedIds: m /* sim does not model R decay: T4 concept gate is never used (no L4 level has >=3 A/B) */,
      d4: [...d4Done.values()], cases, teaching, artifacts, depthEvidence, assessment,
    };
  };

  const doDigging = (day: number): void => {
    const need = d4Required(policy, d4Possible(policy, inv, from, mode));
    if (d4Done.size >= need) return;
    const cand = d4Refs.filter((c) => !d4Done.has(c.id)).map((c) => runs.get(c.id)!).sort((a, b) => a.tries.d4 - b.tries.d4);
    const r = cand[0];
    if (!r) return;
    r.tries.d4++;
    if (mode === 'OFFLINE') {
      // D1-D3 self branch, then D4 MCQ: N consecutive correct (deterministic evidence, also counts as a format event)
      let ok = true;
      for (let i = 0; i < P.d4.consecutiveMcqOffline; i++) {
        const beta = rng.normal(0, 0.35);
        const actual = rng.chance(pTrue(r, 'digging_d4_mcq', 4, beta));
        const { state } = applyResponse(policy, r.ev, { day, format: 'digging_d4_mcq', engine: 'deterministic', correct: actual, beta, nOptions: 4 });
        r.ev = state; r.peak = Math.max(r.peak, effectiveTheta(policy, state)); r.exposures++; eventCount++;
        if (!actual) { ok = false; break; }
      }
      if (ok) d4Done.set(r.ref.id, { conceptId: r.ref.id, engine: 'deterministic', provisional: false });
    } else {
      const engine = prof.jEngine(sp1);
      const okTrue = agent.guess ? false : rng.chance(agent.d4Prob);
      const ok = gradeReport(engine, okTrue);
      respond(r, 'digging_d4_mcq', day, { forceEngine: engine });
      if (ok) d4Done.set(r.ref.id, { conceptId: r.ref.id, engine, provisional: false });
    }
    // depth-asset evidence: a D>=3 digging chain on a Tier A concept of this level
    if (r.ref.tier === 'A' && r.ref.level === from && (mode === 'OFFLINE' ? true : true)) depthEvidence = Math.max(depthEvidence, agent.guess ? 0 : 1);
  };

  const attemptCase = (day: number): void => {
    const minLevel = from === 3 ? 3 : 4;
    const pool = inv.cases.filter((c) => c.level >= (from >= 3 ? minLevel : from));
    if (!pool.length) return;
    const wantMore = from === 3 ? !cases.some((c) => (c.metric === (mode === 'OFFLINE' ? 'd_fraction' : 'rubric4')) && c.value >= (mode === 'OFFLINE' ? P.caseGate.l3l4OfflineDFraction : P.caseGate.l3l4ScoreMin) - 1e-9) : true;
    if (!wantMore && from === 3) return;
    // prefer L5 Case first for T4, then anything with remaining variants
    const order = [...pool].sort((a, b) => (from === 4 ? b.level - a.level : a.level - b.level) || a.id - b.id);
    const target = order.find((c) => (caseAttempts.get(c.id) ?? 0) < P.caseGate.variantsPerCase &&
      !(from === 4 && cases.some((r) => r.caseId === c.id && r.value >= (mode === 'OFFLINE' ? P.caseGate.l4l5OfflineDFraction : P.caseGate.l4l5ScoreMin) - 1e-9)));
    if (!target) return;
    caseAttempts.set(target.id, (caseAttempts.get(target.id) ?? 0) + 1);
    const trueScore = clamp(rng.normal(agent.caseMu, agent.caseSd), 0, 4);
    if (mode === 'OFFLINE') {
      const pD = agent.guess ? 1 / 3 : clamp(trueScore / 4 + 0.05, 0, 1);
      let hit = 0;
      const nDp = 4;
      for (let i = 0; i < nDp; i++) if (rng.chance(pD)) hit++;
      cases.push({ caseId: target.id, level: target.level, metric: 'd_fraction', value: hit / nDp, provisional: true });
    } else {
      const noise = RUBRIC_NOISE[rubricEngine] ?? 0.3;
      cases.push({ caseId: target.id, level: target.level, metric: 'rubric4', value: clamp(trueScore + rng.normal(0, noise), 0, 4), provisional: false });
    }
    if (!agent.guess) depthEvidence = Math.max(depthEvidence, 1);
  };

  const attemptTeaching = (): void => {
    if (from !== 4) return;
    const done = new Set(teaching.filter((t) => t.score >= P.l5.teachingMin - 1e-9).map((t) => t.conceptId));
    if (done.size >= P.l5.teachingConcepts) return;
    const tierA = inv.concepts.filter((c) => c.tier === 'A' && c.level <= 4 && !done.has(c.id) && (teachAttempts.get(c.id) ?? 0) < 3);
    const c = tierA[0];
    if (!c) return;
    teachAttempts.set(c.id, (teachAttempts.get(c.id) ?? 0) + 1);
    const truth = clamp(rng.normal(agent.teachMu, agent.teachSd), 0, 1);
    if (rubricEngine === 'self') {
      teaching.push({ conceptId: c.id, score: clamp(agent.guess && agent.selfTeachInflation >= 1 ? 1 : truth + agent.selfTeachInflation, 0, 1), provisional: true });
    } else {
      teaching.push({ conceptId: c.id, score: clamp(truth + rng.normal(0, TEACH_NOISE[rubricEngine] ?? 0.08), 0, 1), provisional: false });
    }
  };

  const attemptArtifact = (): void => {
    if (from !== 4) return;
    const done = new Set(teaching.filter((t) => t.score >= P.l5.teachingMin - 1e-9).map((t) => t.conceptId));
    const teachDone = done.size >= P.l5.teachingConcepts;
    const teachExhausted = inv.concepts.filter((c) => c.tier === 'A' && c.level <= 4).every((c) => done.has(c.id) || (teachAttempts.get(c.id) ?? 0) >= 3);
    const needCase = mode === 'OFFLINE' ? P.caseGate.l4l5OfflineDFraction : P.caseGate.l4l5ScoreMin;
    const l5CaseDone = cases.some((c) => c.level >= 5 && c.value >= needCase - 1e-9);
    const l5Exhausted = inv.cases.filter((c) => c.level >= 5).every((c) => (caseAttempts.get(c.id) ?? 0) >= P.caseGate.variantsPerCase);
    const needForG6 = !teachDone && teachExhausted;
    const needForG5 = !l5CaseDone && l5Exhausted;
    if (!needForG5 && !needForG6) return;
    if (artifactAttempts >= 6 || artifacts.filter((a) => a.score >= P.l5.artifactAvgMin - 1e-9).length >= P.l5.artifactCount) return;
    artifactAttempts++;
    const truth = clamp(rng.normal(agent.artMu, agent.artSd), 0, 4);
    const defended = rng.chance(agent.defendProb);
    if (rubricEngine === 'self') {
      const gamer = agent.guess && agent.selfTeachInflation >= 1;
      artifacts.push({ score: gamer ? 4 : clamp(truth + (agent.selfTeachInflation > 0 ? 0.3 : 0), 0, 4), rebuttalDefended: gamer ? true : defended, provisional: true });
    } else {
      artifacts.push({ score: clamp(truth + rng.normal(0, RUBRIC_NOISE[rubricEngine] ?? 0.3), 0, 4), rebuttalDefended: defended, provisional: false });
    }
  };

  const takeAssessment = (day: number): void => {
    const pool: Pool = {};
    for (const c of required) for (const [f, n] of Object.entries(c.pool) as [FormatId, number][]) pool[f] = (pool[f] ?? 0) + n;
    if (prof.tierCOnDemand) for (const c of all.filter((x) => x.tier === 'C')) for (const [f, n] of Object.entries(inv.generatedPool) as [FormatId, number][]) pool[f] = (pool[f] ?? 0) + n;
    let comp = composeAssessment(policy, pool, from as Level, mode, sp1);
    if (!comp.ok && P.sparse.fallbackPool === 'adjacent_level_ab' && from > 1) {
      for (const c of levelConcepts(inv, (from - 1) as Level).required) for (const [f, n] of Object.entries(c.pool) as [FormatId, number][]) pool[f] = (pool[f] ?? 0) + n;
      comp = composeAssessment(policy, pool, from as Level, mode, sp1);
    }
    attempts++;
    if (!comp.ok) { assessment = { cbmPct: 0, lkAccuracy: 0, distinctFormats: comp.distinctFormats, engineOk: false }; return; }
    const results: AssessmentItemResult[] = [];
    const src = studyList.length ? studyList : [...runs.values()];
    comp.plan.forEach((f, i) => {
      const r = src.length ? src[i % src.length]! : null;
      const spec = FORMATS[f];
      const engine = resolveEngine(policy, spec, mode, sp1);
      const beta = rng.normal(0, 0.35);
      const p = pTrue(r, f, spec.options, beta);
      const actual = rng.chance(p);
      const graded = gradeReport(engine, actual);
      results.push({ format: f, correct: graded, confidence: confidenceFor(p) });
      if (r) { r.exposures++; }
    });
    const cbm = cbmPercent(results);
    assessment = {
      cbmPct: cbm.pct, lkAccuracy: results.filter((r) => r.correct).length / results.length,
      distinctFormats: new Set(results.map((r) => r.format)).size, engineOk: true,
    };
    void day;
  };

  /* ---- main loop */
  for (let day = 1; day <= horizonDays && !promoted; day++) {
    if (!rng.chance(agent.activeDayProb) && day > 1) continue;
    // 1. study required concepts (round robin over the not-yet-mastered)
    let budget = agent.itemsPerDay;
    const open = studyList.filter((r) => !masteryStatus(policy, r.ev).mastered);
    const targets = open.length ? open : studyList;
    // learners also need >=2 distinct days: ensure the router spreads the work over days
    const perConceptCap = Math.max(6, Math.ceil(budget / Math.max(1, targets.length)));
    for (const r of targets) {
      const fm = studyFormats(r, day);
      if (!fm.length) continue;
      const n = Math.min(perConceptCap, budget);
      for (let i = 0; i < n && budget > 0; i++, budget--) respond(r, fm[(rrIdx + i) % fm.length]!, day);
      rrIdx++;
      if (budget <= 0) break;
    }
    // 2. gate activities
    if (from === 2) doDigging(day);
    if (from >= 3 && day % 3 === 0) attemptCase(day);
    if (from === 4 && day % 3 === 1) { attemptTeaching(); attemptArtifact(); }
    if (!agent.guess && P.sparse.depthScope === 'track' && day >= 2 && (inv.concepts.some((c) => c.tier === 'A') || inv.cases.length > 0)) depthEvidence = Math.max(depthEvidence, 1);
    // depth evidence for sparse levels backed by a mastered Tier A concept
    if (!agent.guess && required.some((c) => c.tier === 'A' && masteryStatus(policy, runs.get(c.id)!.ev).mastered)) depthEvidence = Math.max(depthEvidence, 1);
    // 3. decide
    let d = decidePromotion(policy, inv, snapshot());
    lastStatus = d.status; lastGates = d.gates.filter((g) => !g.ok).map((g) => `${g.id}:${g.detail}`);
    if (d.status === 'blocked_cap') break;
    if (d.canStartAssessment && day >= nextAssessmentDay) {
      takeAssessment(day);
      d = decidePromotion(policy, inv, snapshot());
      lastStatus = d.status; lastGates = d.gates.filter((g) => !g.ok).map((g) => `${g.id}:${g.detail}`);
      if (d.status === 'promoted') { promoted = true; promotedProvisional = d.provisional; promotedDay = day; break; }
      assessment = undefined; // a failed attempt does not persist; retry after cool-down
      nextAssessmentDay = day + P.assessment.retryDays;
    } else if (d.status === 'promoted') { promoted = true; promotedProvisional = d.provisional; promotedDay = day; break; }
  }

  const res: CellResult = {
    reached: promoted, provisional: promotedProvisional, day: promotedDay, attempts, status: lastStatus, lastGates, eventCount, poolReuse,
  };
  if (agent.guess) {
    const cs = [...runs.values()].filter((r) => required.some((q) => q.id === r.ref.id) || studyList.includes(r));
    res.thetaDeltas = cs.map((r) => effectiveTheta(policy, r.ev) - policy.elo.theta0);
    res.maxTheta = cs.map((r) => r.peak - policy.elo.theta0);
    res.exposures = cs.map((r) => r.exposures);
    res.masteredCount = cs.filter((r) => masteryStatus(policy, r.ev).mastered).length;
  }
  return res;
}
