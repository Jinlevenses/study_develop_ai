/**
 * policy.ts - SP-6 reference policy object.
 *
 * Mirrors the shape of `mastery_rules@v1` (mastery, elo, weights, promotion, ai_profiles)
 * and the slice of `method_policy@v1` that matters for evidence (format catalog).
 * Every number carries a provenance tag:
 *   [SPEC]   value written in 03-convergence.md / 04-requirements-spec.md
 *   [ASSUME] value the spec does not pin down; chosen by this spike, must be ratified (DEC-*)
 *   [FIX]    value changed by an SP-6 proposed fix (see `withFixes`)
 */

export type AiMode = 'FULL' | 'JUDGE_ONLY' | 'LLM_ONLY' | 'OFFLINE';
export const AI_MODES: readonly AiMode[] = ['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE'];

export type EngineId =
  | 'deterministic'
  | 'jev_calibrated'
  | 'jev_uncalibrated'
  | 'jev_low_conf'
  | 'llm_judge'
  | 'heuristic'
  | 'self'
  | 'pending';

export type Tier = 'A' | 'B' | 'C';
export type Level = 1 | 2 | 3 | 4 | 5;
export type Transition = 1 | 2 | 3 | 4; // Lk -> Lk+1

export type FormatId =
  | 'embedded'
  | 'ox'
  | 'mcq'
  | 'cloze'
  | 'short'
  | 'matching'
  | 'code_task'
  | 'blank_note'
  | 'digging_d4_mcq'
  | 'error_find'
  | 'confusable'
  | 'fermi'
  | 'cond_reversal'
  | 'infra_lite'
  | 'kata'
  | 'audit'
  | 'case_decision';

export interface FormatSpec {
  id: FormatId;
  /** w_format from CNV section 6.1 (mid-point of the published range where a range is given). */
  wFormat: number;
  minLevel: Level;
  maxLevel: Level;
  /** D = deterministic key/test; J = needs a judge (Jev / LLM-judge / self ladder). */
  gradeClass: 'D' | 'J';
  /** J-class formats that have a deterministic OFFLINE alternative (FR-STD-020 D4 MCQ, Case decision points). */
  offlineDeterministicAlt?: boolean;
  /** Default number of answer options for guess-floor purposes; 0 = open answer (floor ~0). */
  options: number;
  /** Spec reference for the numbers above. */
  src: string;
}

export const FORMATS: Record<FormatId, FormatSpec> = {
  embedded:       { id: 'embedded',       wFormat: 0.5, minLevel: 1, maxLevel: 5, gradeClass: 'D', options: 4, src: 'FR-CUR-008 (w 0.5)' },
  ox:             { id: 'ox',             wFormat: 0.5, minLevel: 1, maxLevel: 5, gradeClass: 'D', options: 2, src: 'M-03 (w 0.5; warm-up at every level)' },
  mcq:            { id: 'mcq',            wFormat: 0.7, minLevel: 1, maxLevel: 4, gradeClass: 'D', options: 4, src: 'M-04 0.7~0.9, FR-PRG-009 test (MCQ counts)' },
  cloze:          { id: 'cloze',          wFormat: 0.8, minLevel: 1, maxLevel: 4, gradeClass: 'D', options: 0, src: 'M-04 0.7~0.9' },
  short:          { id: 'short',          wFormat: 0.9, minLevel: 1, maxLevel: 4, gradeClass: 'D', options: 0, src: 'M-04 0.7~0.9' },
  matching:       { id: 'matching',       wFormat: 0.7, minLevel: 1, maxLevel: 4, gradeClass: 'D', options: 24, src: 'M-04 / T2 matching (4 pairs -> 4! = 24)' },
  code_task:      { id: 'code_task',      wFormat: 0.9, minLevel: 1, maxLevel: 4, gradeClass: 'D', options: 0, src: 'M-05/M-10 0.7~1.0 (tests)' },
  blank_note:     { id: 'blank_note',     wFormat: 0.9, minLevel: 1, maxLevel: 5, gradeClass: 'J', options: 0, src: 'M-13 (Jev BPS -> LJ -> heuristic + self)' },
  digging_d4_mcq: { id: 'digging_d4_mcq', wFormat: 0.8, minLevel: 2, maxLevel: 5, gradeClass: 'J', offlineDeterministicAlt: true, options: 4, src: 'FR-STD-020 (OFFLINE D4/D5 MCQ, w_format 0.8 x w_grader 1.0)' },
  error_find:     { id: 'error_find',     wFormat: 0.9, minLevel: 2, maxLevel: 4, gradeClass: 'D', options: 10, src: 'M-06 (position deterministic)' },
  confusable:     { id: 'confusable',     wFormat: 0.7, minLevel: 2, maxLevel: 5, gradeClass: 'D', options: 4, src: 'M-07' },
  fermi:          { id: 'fermi',          wFormat: 1.0, minLevel: 3, maxLevel: 5, gradeClass: 'D', options: 20, src: 'M-08 (log tolerance band)' },
  cond_reversal:  { id: 'cond_reversal',  wFormat: 1.0, minLevel: 3, maxLevel: 5, gradeClass: 'D', options: 10, src: 'M-09 (cell/pair consistency)' },
  infra_lite:     { id: 'infra_lite',     wFormat: 0.9, minLevel: 2, maxLevel: 4, gradeClass: 'D', options: 0, src: 'M-12 (static rules)' },
  kata:           { id: 'kata',           wFormat: 1.0, minLevel: 1, maxLevel: 4, gradeClass: 'D', options: 0, src: 'M-11 (hidden tests)' },
  audit:          { id: 'audit',          wFormat: 1.0, minLevel: 1, maxLevel: 5, gradeClass: 'D', options: 10, src: 'M-16 (injected position deterministic)' },
  case_decision:  { id: 'case_decision',  wFormat: 1.0, minLevel: 3, maxLevel: 5, gradeClass: 'J', offlineDeterministicAlt: true, options: 3, src: 'M-19 decision points (D)' },
};

export interface AiProfile {
  /** Engine that grades J-class formats (before the OFFLINE deterministic alternative). */
  jEngine: (sp1Calibrated: boolean) => EngineId;
  /** Engines acceptable for the promotion assessment ("calibrated engine only", FR-PRG-012/013). */
  assessmentEngines: (sp1Calibrated: boolean) => EngineId[];
  /** Tier C concepts can be turned into gated Tier-B-grade items on demand (J03 needs an LLM). */
  tierCOnDemand: boolean;
  /** Which tiers can run a D4-capable digging chain in this mode (FR-STD-020, CNV 8.2 E02). */
  d4Tiers: Tier[];
  /** Descriptive (rubric) evidence engine used for Teaching / Artifact / Case rubric. */
  rubricEngine: (sp1Calibrated: boolean) => EngineId;
}

export interface PromotionRules {
  /** FR-PRG-013 (1): share of required concepts that must be Mastered. */
  requiredMasteredRatio: number;
  /** FR-PRG-013 (1): below this many required concepts the sparse-level rule replaces the concept gate. */
  minRequiredForConceptGate: number;
  sparse: {
    lkAccuracyMin: number; // 0.80
    depthEvidenceMin: number; // 1
    /** [FIX F2] when the level's A/B item pool is empty/short, borrow items from these sources. */
    fallbackPool: 'none' | 'adjacent_level_ab';
  };
  assessment: {
    items: number; // 12
    formatsMin: number; // 4
    /** CBM pass threshold by transition (index 1..4) as fraction of max points. */
    cbmMin: Record<Transition, number>;
    retryDays: number; // 14
  };
  d4: {
    conceptsCap: number; // 5
    conceptsFloor: number; // 2
    /** [ASSUME] which concepts count: level<=k of the track. */
    scope: 'level_le_k' | 'any_level';
    /** [FIX F3] replace the hard floor 2 with min(2, possible). */
    floorMode: 'hard' | 'min_with_possible';
    consecutiveMcqOffline: number; // 2
  };
  caseGate: {
    l3l4ScoreMin: number; // 2.5 / 4
    l3l4OfflineDFraction: number; // 0.60
    l4l5ScoreMin: number; // 3.0 / 4
    /** [ASSUME] OFFLINE D fraction for L4->L5 = 3.0/4 */
    l4l5OfflineDFraction: number;
    l4l5Count: number; // 2
    variantsPerCase: number; // 3 (root_cause_pool >= 3, floor 2)
  };
  l5: {
    teachingMin: number; // 0.8
    teachingConcepts: number; // 2
    artifactCount: number; // 2
    artifactAvgMin: number; // 3.0
    artifactRebuttalTurns: number; // 1
  };
  /** [FIX F1] a level with zero concepts in the track is skipped instead of blocking. */
  emptyLevel: 'block' | 'skip';
}

export interface MasteryRules {
  version: string;
  mastered: {
    pMin: number; // 0.80
    formatsMin: number; // 3
    distinctDaysMin: number; // 2
    formatCounts: { wFormatMin: number; wGraderMin: number }; // 0.7 / 0.6 (DEC-CNV-19)
    /** P is evaluated against a median-difficulty item of the concept level: beta_ref. */
    refBeta: number;
  };
  elo: {
    alpha: number; // 0.8 (R1 7.2)
    b: number; // 0.05
    /** Guess-corrected expectation P = c + (1-c) * sigmoid(theta - beta). */
    guessCorrection: boolean;
    theta0: number; // [ASSUME] prior for an untouched concept relative to median item difficulty
    thetaMin: number;
    thetaMax: number;
  };
  weights: {
    grader: Record<EngineId, number>; // CNV 8.3
    rapid: number; // 0 regardless of correctness (DEC-CNV-33)
    hintFactor: number; // [ASSUME] hint used -> x0.6
    selfBias: { enabled: boolean; slope: number }; // self weight is scaled by 1 - slope * inflation
  };
  promotion: PromotionRules;
  aiProfiles: Record<AiMode, AiProfile>;
}

const jev = (cal: boolean): EngineId => (cal ? 'jev_calibrated' : 'jev_uncalibrated');

export const DEFAULT_POLICY: MasteryRules = {
  version: 'mastery_rules@v1-sp6',
  mastered: {
    pMin: 0.8,
    formatsMin: 3,
    distinctDaysMin: 2,
    formatCounts: { wFormatMin: 0.7, wGraderMin: 0.6 },
    refBeta: 0,
  },
  elo: { alpha: 0.8, b: 0.05, guessCorrection: true, theta0: -0.5, thetaMin: -4, thetaMax: 4 },
  weights: {
    grader: {
      deterministic: 1.0,
      jev_calibrated: 0.9,
      jev_uncalibrated: 0.7,
      jev_low_conf: 0.4,
      llm_judge: 0.6,
      heuristic: 0.4,
      self: 0.3,
      pending: 0,
    },
    rapid: 0,
    hintFactor: 0.6,
    selfBias: { enabled: true, slope: 2 },
  },
  promotion: {
    requiredMasteredRatio: 0.85,
    minRequiredForConceptGate: 3,
    sparse: { lkAccuracyMin: 0.8, depthEvidenceMin: 1, fallbackPool: 'none' },
    assessment: { items: 12, formatsMin: 4, cbmMin: { 1: 0.7, 2: 0.7, 3: 0.7, 4: 0.75 }, retryDays: 14 },
    d4: { conceptsCap: 5, conceptsFloor: 2, scope: 'level_le_k', floorMode: 'hard', consecutiveMcqOffline: 2 },
    caseGate: {
      l3l4ScoreMin: 2.5,
      l3l4OfflineDFraction: 0.6,
      l4l5ScoreMin: 3.0,
      l4l5OfflineDFraction: 0.75,
      l4l5Count: 2,
      variantsPerCase: 3,
    },
    l5: { teachingMin: 0.8, teachingConcepts: 2, artifactCount: 2, artifactAvgMin: 3.0, artifactRebuttalTurns: 1 },
    emptyLevel: 'block',
  },
  aiProfiles: {
    FULL: {
      jEngine: jev,
      assessmentEngines: (cal) => (cal ? ['deterministic', 'jev_calibrated'] : ['deterministic']),
      tierCOnDemand: true,
      d4Tiers: ['A', 'B', 'C'],
      rubricEngine: jev,
    },
    JUDGE_ONLY: {
      jEngine: jev,
      assessmentEngines: (cal) => (cal ? ['deterministic', 'jev_calibrated'] : ['deterministic']),
      tierCOnDemand: false,
      d4Tiers: ['A', 'B'],
      rubricEngine: jev,
    },
    LLM_ONLY: {
      jEngine: () => 'llm_judge',
      assessmentEngines: () => ['deterministic'],
      tierCOnDemand: true,
      d4Tiers: ['A', 'B', 'C'],
      rubricEngine: () => 'llm_judge',
    },
    OFFLINE: {
      jEngine: () => 'self',
      assessmentEngines: () => ['deterministic'],
      tierCOnDemand: false,
      d4Tiers: ['A'],
      rubricEngine: () => 'self',
    },
  },
};

/** Minimal fixes proposed by SP-6 (each is one policy/parameter flip; content Briefs are handled in inventory). */
export function withFixes(base: MasteryRules, fixes: { F1?: boolean; F2?: boolean; F3?: boolean }): MasteryRules {
  const p: MasteryRules = structuredClone(base) as MasteryRules;
  // structuredClone drops functions; restore ai profiles
  p.aiProfiles = base.aiProfiles;
  if (fixes.F1) p.promotion.emptyLevel = 'skip';
  if (fixes.F2) p.promotion.sparse.fallbackPool = 'adjacent_level_ab';
  if (fixes.F3) p.promotion.d4.floorMode = 'min_with_possible';
  p.version = `${base.version}+fixes[${Object.entries(fixes).filter(([, v]) => v).map(([k]) => k).join(',')}]`;
  return p;
}

/** JSON-serialisable view of the policy (functions expanded) for hashing / the report. */
export function describePolicy(p: MasteryRules): unknown {
  const profiles: Record<string, unknown> = {};
  for (const m of AI_MODES) {
    const a = p.aiProfiles[m];
    profiles[m] = {
      jEngine: { sp1_pass: a.jEngine(true), sp1_fail: a.jEngine(false) },
      assessmentEngines: { sp1_pass: a.assessmentEngines(true), sp1_fail: a.assessmentEngines(false) },
      rubricEngine: { sp1_pass: a.rubricEngine(true), sp1_fail: a.rubricEngine(false) },
      tierCOnDemand: a.tierCOnDemand,
      d4Tiers: a.d4Tiers,
    };
  }
  return { ...p, aiProfiles: profiles, formats: FORMATS };
}
