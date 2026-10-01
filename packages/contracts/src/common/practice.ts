import { z } from 'zod';
import { GraderEngine, JudgeBadge } from './domain.js';
import { MisconceptionId, ObjKey, Ulid } from './ids.js';
import { S } from './schema.js';
import { EpochMs } from './time.js';

// 교차 서비스 공유 어휘 — learning·content·gateway 공용, L-CONTRACTS 소유 (IF-01 §5.1)
export const AttemptPhase = z.enum([
  'practice',
  'pretest',
  'embedded',
  'verify',
  'promotion_exam',
  'placement',
  'boss',
]);
export type AttemptPhase = z.infer<typeof AttemptPhase>;
export const DialogKind = z.enum(['dig', 'feynman', 'artifact_rebuttal']);
export type DialogKind = z.infer<typeof DialogKind>;
export const AttemptResponse = z.discriminatedUnion('kind', [
  S({ kind: z.literal('ox'), value: z.boolean() }),
  S({ kind: z.literal('choice'), option_keys: z.array(ObjKey).min(1).max(10) }), // mcq·confusable·digging_d4_mcq·embedded·micro_judgment·ml_predict
  S({ kind: z.literal('text'), text: z.string().max(2000) }), // short·code_predict
  S({ kind: z.literal('cloze'), blanks: z.record(ObjKey, z.string().max(500)) }),
  S({ kind: z.literal('matching'), pairs: z.record(ObjKey, ObjKey) }),
  S({ kind: z.literal('code'), lang: z.enum(['js', 'ts']), code: z.string().max(65_536) }), // code_task·kata
  S({ kind: z.literal('sql'), sql: z.string().max(65_536) }), // sql_task
  S({ kind: z.literal('positions'), keys: z.array(ObjKey).max(20), notes: z.record(ObjKey, z.string().max(1000)) }), // error_find·audit
  S({ kind: z.literal('numeric'), value: z.number(), unit: z.string().max(40).nullable() }), // fermi
  S({
    kind: z.literal('essay'),
    text: z.string().max(20_000), // blank_note·essay·feynman·artifact·case_postmortem
    uncertain_spans: z.array(S({ start: z.number().int().min(0), end: z.number().int().min(0) })).max(100),
  }),
  S({
    kind: z.literal('cond_pair'),
    answers: S({ a: z.array(ObjKey).min(1).max(10), b: z.array(ObjKey).min(1).max(10) }),
    pivot_text: z.string().max(1000),
  }),
  S({
    kind: z.literal('review'),
    comments: z
      .array(
        S({
          line_key: ObjKey,
          severity: z.enum(['blocker', 'major', 'minor', 'nit']),
          text: z.string().max(2000),
        }),
      )
      .max(50),
  }),
  S({
    kind: z.literal('authoring'),
    item: S({
      // reverse_item (학습자 저작)
      stem_md: z.string().max(4000),
      options: z.record(ObjKey, S({ text_md: z.string().max(1000), mc_id: MisconceptionId.nullable() })),
      chosen_keys: z.array(ObjKey).min(1).max(4),
      rationale_md: z.string().max(4000),
    }),
  }),
  S({ kind: z.literal('case_decision'), option_key: ObjKey, rationale: z.string().max(4000).nullable() }),
]);
export type AttemptResponse = z.infer<typeof AttemptResponse>;

// (계속) IF-01 §5.2
export const DialogMove = z.enum([
  // FR-STD-020 결정적 상태기계의 다음 수(R5 §9.2)
  'probe_why',
  'probe_how',
  'probe_what_if',
  'probe_edge',
  'probe_internal',
  'target_missing_ku',
  'counterexample',
  'hint_concept',
  'hint_ku',
  'hint_example',
  'refocus',
  'switch_to_explain',
  'student_question',
  'rebut',
  'wrap_up',
]);
export type DialogMove = z.infer<typeof DialogMove>;
export const DialogEndReason = z.enum(['turn_limit', 'fail_limit', 'learner', 'completed']);
export type DialogEndReason = z.infer<typeof DialogEndReason>;
export const Utterance = z.discriminatedUnion('kind', [
  S({
    kind: z.literal('static'),
    text_md: z.string().max(4000),
    source: z.enum(['question_bank', 'template', 'rebuttal_bank']),
  }), // OFFLINE·JUDGE_ONLY
  S({
    kind: z.literal('stream'),
    stream_ref: Ulid,
    expires_at: EpochMs,
    fallback_text_md: z.string().max(4000),
  }), // FULL·LLM_ONLY (AI-G07)
]);
export type Utterance = z.infer<typeof Utterance>;
export const TurnJudgement = S({
  label: z.enum(['complete', 'partial', 'misconception', 'off_topic', 'dont_know']),
  mc_id: MisconceptionId.nullable(),
  asks_for_answer: z.boolean(),
  engine: GraderEngine,
  calibrated: z.boolean(),
  badge: JudgeBadge,
});
export type TurnJudgement = z.infer<typeof TurnJudgement>;

// (계속 — §1.2-3 공유 어휘 4종: ArtifactTemplateKind·PromotionGate·FeasibilityBlocker·WGraderTable)
export const ArtifactTemplateKind = z.enum(['adr', 'runbook', 'postmortem', 'design_review', 'standard_clause']);
export type ArtifactTemplateKind = z.infer<typeof ArtifactTemplateKind>;
export const PromotionGate = S({
  gate_id: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/), // 'REQUIRED_MASTERED', 'ASSESSMENT_ACCURACY', 'ASSESSMENT_CBM', 'D4_DEPTH', 'CASE_L4', 'MASTERY_P', 'FORMATS', 'STUDY_DAYS'
  label_ko: z.string().max(80),
  met: z.boolean(),
  value: z.number().nullable(),
  threshold: z.number().nullable(),
  evidence_event_ids: z.array(Ulid).max(50),
  shortfall_ko: z.string().max(300).nullable(),
});
export type PromotionGate = z.infer<typeof PromotionGate>;
export const FeasibilityBlocker = S({
  code: z
    .string()
    .regex(/^(NO_ASSESSMENT_POOL|EMPTY_LEVEL|D4_POSSIBLE<REQUIRED|CASE_L4\+<2|MASTERY_FORMATS<3:[a-z0-9.-]{3,128})$/), // 접미 = concept_id(CR-35 문법)
  detail_ko: z.string().max(300),
});
export type FeasibilityBlocker = z.infer<typeof FeasibilityBlocker>;
export const WGraderTable = S({
  // mastery_rules@v1의 w_grader 표(ARC §11.4)
  D: z.number().min(0).max(1),
  J_calibrated: z.number().min(0).max(1),
  J_uncalibrated: z.number().min(0).max(1),
  J_low_confidence: z.number().min(0).max(1),
  LJ: z.number().min(0).max(1),
  H: z.number().min(0).max(1),
  S: z.number().min(0).max(1),
  PENDING: z.literal(0),
});
export type WGraderTable = z.infer<typeof WGraderTable>;
