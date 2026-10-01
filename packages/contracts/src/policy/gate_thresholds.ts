import { z } from 'zod';
import { S } from '../common/schema.js';

// [Brief 결정 §4.8 — CR-43 T1 저작] policy/gate_thresholds@v1.yaml 의 zod. 구조 원천 = AI-01 §8.20(D9: `gates{…}`·`judge_bands` 중첩).
// G0·G1·G10·G12는 임계가 없어 키가 없다. 값 파일(T-00-15)은 AI-01 §8.20 YAML을 그대로 옮기면 통과해야 한다.
const P = z.number().min(0).max(1); // 비율
const Score3 = z.number().min(0).max(3); // 기대 점수(0~3)
const Band = S({ accept: P, reject: P }).refine((b) => b.reject <= b.accept, 'reject must be <= accept');
const EvidencePolicy = z.enum(['void', 'halve', 'keep']);
const WEIGHT_SUM_EPS = 1e-9;
const sumsToOne = (w: Record<string, number>): boolean =>
  Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) <= WEIGHT_SUM_EPS;
const Weights4 = S({ coverage: P, accuracy: P, structure: P, depth: P }).refine(sumsToOne, 'weights must sum to 1');
const Weights5 = S({ accuracy: P, simplicity: P, examples: P, gaps: P, fixes_mc: P }).refine(
  sumsToOne,
  'weights must sum to 1',
);

export const GateThresholdsV1 = S({
  version: z.literal('gate_thresholds@v1'),
  gates: S({
    G2: S({ grounded_min: P }),
    G3: S({ key_min: P, other_max: P, repair_band: S({ gt: P, le: P }) }),
    G4: S({ require_key_match: z.boolean() }),
    G5: S({ ambiguous_max: P }),
    G6: S({ mean_min: Score3, each_min: Score3 }),
    G7: S({ leak_max: P }),
    G8: S({ duplicate_min: P, judge_band: S({ ge: P, lt: P }), same_knowledge_min: P }),
    G9: S({ target_p_min: P, adjacent_ok: z.boolean() }),
    G11: S({ explanation_min: Score3 }),
    G13: S({ each_max: P }),
    regate: S({ G3: EvidencePolicy, G5: EvidencePolicy }),
    llm_only: S({
      G2: S({ grounded_min: P }),
      G3: S({ key_min: P, other_max: P }),
      G5: S({ ambiguous_max: P }),
      G7: S({ leak_max: P }),
      require_G4: z.boolean(),
    }),
  }),
  judge_bands: S({
    'AI-J01': S({ targets_mc: Band }),
    'AI-J02': S({ equiv: Band }),
    'AI-J03': S({
      cov: Band,
      mc: S({ present: P }),
      bps: S({ w: Weights4, partial_credit: P, deep_level_min: z.number().int().min(1).max(5) }),
    }),
    'AI-J04': S({ kp: Band, defect: Band, mc: S({ present: P }), partial_credit: P }),
    'AI-J05': S({ fixes_mc: S({ accept: P }), teaching: S({ w: Weights5, taught_min: P }) }),
    'AI-J06': S({ which_mc: S({ confidence_min: P }), error_cause: S({ confidence_min: P }) }),
    'AI-J12': S({ same_concept: S({ merge_candidate_min: P }) }),
    'AI-J13': S({ section: S({ auto_min: P }) }),
    'AI-J14': S({ supported: S({ verified_min: P }) }),
    'AI-J15': S({ contradict: S({ conflict_min: P, review_min: P }) }),
    'AI-J16': S({ injection: S({ quarantine_min: P }) }),
    'AI-J17': S({ label: S({ confidence_min: P, below: z.literal('partial') }), asks_answer: S({ flag: P }) }),
    'AI-J18': S({
      gates_as: z
        .array(z.enum(['G2', 'G3', 'G5', 'G6', 'G7', 'G11']))
        .min(1)
        .max(6),
      centrality: S({ min: Score3 }),
    }),
    'AI-J19': S({
      appeal_label: S({
        confidence_min: P,
        confidence_min_judge_only: P,
        below: z.literal('user_decision_required'),
      }),
    }),
    injection: S({ flag: P }),
    jev_low_confidence: P,
  }),
});
export type GateThresholdsV1 = z.infer<typeof GateThresholdsV1>;
