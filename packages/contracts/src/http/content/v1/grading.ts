import { z } from 'zod';
import { AiMode, Confidence, FormatId, GraderEngine, Level } from '../../../common/domain.js';
import { ConceptId, ItemId, KuId, MisconceptionId, ObjKey, PolicySetId, Sha256Hex, Ulid } from '../../../common/ids.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import {
  AttemptPhase,
  AttemptResponse,
  DialogEndReason,
  DialogKind,
  DialogMove,
  TurnJudgement,
  Utterance,
  WGraderTable,
} from '../../../common/practice.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';
import { Verdict } from '../../../events/catalog/grading.js';
// biome-ignore lint/suspicious/noImportCycles: [Brief 결정 D1] 순환 import는 getter로 TDZ를 피한다(IF-01 §6 스키마 상호 참조)
import { CreateAppealBody, SelfGradeBody } from '../../learning/v1/attempts.js';
import { GradeAttemptResponse } from './post-submit/grading.js';
// biome-ignore lint/suspicious/noImportCycles: [Brief 결정 D1] 순환 import는 getter로 TDZ를 피한다(IF-01 §6 스키마 상호 참조)
import { JudgeCardPostSubmit } from './post-submit/judge-card.js';
import { ItemDeliveryPreSubmit } from './pre-submit/item.js';

// WGraderTable(정본 common/practice.ts): mastery_rules@v1의 w_grader 표(ARC §11.4) — learning이 이벤트 정책 버전으로 해석해 전달
export const EvidenceParams = S({
  policy_version: PolicySetId,
  w_format: z.number().min(0).max(1), // 보스 챌린지는 learning이 ×0.5 반영한 값(FR-STD-004)
  w_grader_table: WGraderTable,
  rapid: z.boolean(),
  gaming_factor: z.number().min(0).max(1),
});
export type EvidenceParams = z.infer<typeof EvidenceParams>;
export const GradeAttemptRequest = S({
  attempt_id: Ulid,
  session_id: Ulid,
  block_id: Ulid.nullable(),
  run_id: Ulid.nullable(), // run_id = case·artifact 장기 과제
  item_id: ItemId,
  item_content_hash: Sha256Hex,
  phase: AttemptPhase,
  response: AttemptResponse,
  confidence: Confidence.nullable(),
  latency_ms: DurationMs,
  hints_used: z.number().int().min(0).max(4),
  answered_at: EpochMs,
  evidence_params: EvidenceParams,
  engine_constraints: S({ calibrated_only: z.boolean() }), // verify·promotion_exam = true (결정적 + 보정 Jev만)
  ai_mode_observed: AiMode, // learning이 마지막으로 본 모드(정보용; 사다리는 content의 현재 모드로 결정)
});
export type GradeAttemptRequest = z.infer<typeof GradeAttemptRequest>;
export const AppealReason = z.enum(['key_wrong', 'ambiguous', 'outdated', 'learner_right', 'other']);
export type AppealReason = z.infer<typeof AppealReason>;
export const AppealView = S({
  appeal_id: Ulid,
  verdict_id: Ulid,
  reason: AppealReason,
  state: z.enum(['received', 'classifying', 'regrading', 'upheld', 'rejected', 'user_decision_required']),
  classification: S({
    label: z.enum(['key_wrong', 'ambiguous', 'outdated', 'learner_wrong']),
    engine: GraderEngine,
    confidence: z.number().min(0).max(1).nullable(),
  }).nullable(),
  new_verdict_id: Ulid.nullable(),
  rejection_reason_ko: z.string().max(500).nullable(),
  created_at: EpochMs,
  decided_at: EpochMs.nullable(),
});
export type AppealView = z.infer<typeof AppealView>;
export const JudgeTurnRequest = S({
  dialog_id: Ulid,
  turn_id: Ulid,
  dialog_kind: DialogKind,
  concept_id: ConceptId,
  session_id: Ulid.nullable(),
  level: Level,
  depth: z.number().int().min(1).max(7),
  depth_max_allowed: z.number().int().min(1).max(7),
  state_summary: S({
    moves: z.array(DialogMove).max(30),
    covered_ku_ids: z.array(KuId).max(50),
    flagged_mc_ids: z.array(MisconceptionId).max(30),
    fail_streak: z.number().int().min(0),
    asks_for_answer_count: z.number().int().min(0),
    turn_count: z.number().int().min(0),
  }),
  turn_text: z.string().min(1).max(4000),
  d4_choice: S({
    item_id: ItemId,
    item_content_hash: Sha256Hex,
    option_keys: z.array(ObjKey).min(1).max(4),
  }).nullable(),
  artifact_ref: S({ run_id: Ulid, attempt_id: Ulid, verdict_id: Ulid.nullable() }).nullable(), // artifact_rebuttal
  evidence_params: EvidenceParams,
  ai_mode_observed: AiMode,
});
export type JudgeTurnRequest = z.infer<typeof JudgeTurnRequest>;
export const JudgeTurnResponse = S({
  turn_id: Ulid,
  judgement: TurnJudgement,
  next_move: S({
    move: DialogMove,
    target_ku_id: KuId.nullable(),
    target_mc_id: MisconceptionId.nullable(),
    depth: z.number().int().min(1).max(7),
  }),
  utterance: Utterance, // static = 질문 은행·반론 은행, stream = AI-G07 ref(콘텐츠가 120s 뒤에도 영속본 재생)
  d4_item: ItemDeliveryPreSubmit.nullable(),
  verdict: Verdict.nullable(),
  end: S({ ended: z.boolean(), reason: DialogEndReason.nullable() }), // 12턴·3회 실패·완료(FR-STD-020)
});
export type JudgeTurnResponse = z.infer<typeof JudgeTurnResponse>;
export const PendingGradeView = S({
  verdict_id: Ulid,
  attempt_id: Ulid,
  item_id: ItemId,
  format: FormatId,
  queued_at: EpochMs,
  reason: z.enum(['offline', 'deadline', 'provider_down', 'self_grade_skipped', 'low_confidence', 'appeal']),
  attempts: z.number().int().min(0),
  next_try_at: EpochMs.nullable(),
}); // = gr_pending.reason(CR-38)
export type PendingGradeView = z.infer<typeof PendingGradeView>;

// idem = attempt_id
export const GradingAttemptsGradeRoute = defineRoute({
  id: 'content.grading.attempts.grade',
  ifId: 'IF-CT-040',
  method: 'POST',
  path: '/internal/v1/grading/attempts',
  allowedCallers: ['learning'],
  idempotent: true,
  paginated: false,
  request: { body: GradeAttemptRequest },
  response: { 200: GradeAttemptResponse },
  deadlineMs: 2900,
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-QST-017~026', 'FR-LAB-004', 'FR-LAB-014', 'FR-LAB-015', 'FR-LAB-016', 'FR-STD-019', 'FR-STD-025'],
});
export const GradingAttemptsSelfGradeRoute = defineRoute({
  id: 'content.grading.attempts.self_grade',
  ifId: 'IF-CT-041',
  method: 'POST',
  path: '/internal/v1/grading/attempts/{attempt_id}/self-grade',
  allowedCallers: ['learning'],
  idempotent: true,
  paginated: false,
  request: {
    params: S({ attempt_id: Ulid }),
    get body() {
      return SelfGradeBody;
    }, // [Brief 결정 D1] 순환 import TDZ 회피
  },
  response: { 200: GradeAttemptResponse },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-017', 'FR-QST-021'],
});
// idem = turn_id
export const GradingTurnsJudgeRoute = defineRoute({
  id: 'content.grading.turns.judge',
  ifId: 'IF-CT-042',
  method: 'POST',
  path: '/internal/v1/grading/turns:judge',
  allowedCallers: ['learning'],
  idempotent: true,
  paginated: false,
  request: { body: JudgeTurnRequest },
  response: { 200: JudgeTurnResponse },
  deadlineMs: 3400,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-STD-021', 'FR-STD-022', 'FR-STD-026', 'FR-AI-017'],
});
// idem = appeal_id
export const GradingAppealsCreateRoute = defineRoute({
  id: 'content.grading.appeals.create',
  ifId: 'IF-CT-043',
  method: 'POST',
  path: '/internal/v1/grading/appeals',
  allowedCallers: ['learning'],
  idempotent: true,
  paginated: false,
  request: {
    get body() {
      return CreateAppealBody;
    }, // [Brief 결정 D1] 순환 import TDZ 회피
  },
  response: { 201: AppealView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-012'],
});
export const GradingAppealsGetRoute = defineRoute({
  id: 'content.grading.appeals.get',
  ifId: 'IF-CT-044',
  method: 'GET',
  path: '/internal/v1/grading/appeals/{appeal_id}',
  allowedCallers: ['gateway', 'learning'],
  idempotent: false,
  paginated: false,
  request: { params: S({ appeal_id: Ulid }) },
  response: { 200: AppealView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-012'],
});
export const GradingVerdictsGetRoute = defineRoute({
  id: 'content.grading.verdicts.get',
  ifId: 'IF-CT-045',
  method: 'GET',
  path: '/internal/v1/grading/verdicts/{verdict_id}',
  allowedCallers: ['gateway', 'learning'],
  idempotent: false,
  paginated: false,
  request: { params: S({ verdict_id: Ulid }) },
  response: {
    get 200() {
      return JudgeCardPostSubmit;
    },
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-AI-011', 'FR-UX-007', 'FR-STD-019'],
});
export const GradingUtterancesStreamRoute = defineRoute({
  id: 'content.grading.utterances.stream',
  ifId: 'IF-CT-046',
  method: 'GET',
  path: '/internal/v1/grading/utterances/{ref}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ ref: Ulid }) },
  response: { 200: z.string() },
  responseKind: 'sse',
  deadlineMs: 60000,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'IR-016'],
});
export const GradingFeedbackStreamRoute = defineRoute({
  id: 'content.grading.feedback.stream',
  ifId: 'IF-CT-047',
  method: 'GET',
  path: '/internal/v1/grading/verdicts/{verdict_id}/feedback',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ verdict_id: Ulid }) },
  response: { 200: z.string() },
  responseKind: 'sse',
  deadlineMs: 60000,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-019', 'FR-QST-023'],
});
export const GradingPendingListRoute = defineRoute({
  id: 'content.grading.pending.list',
  ifId: 'IF-CT-048',
  method: 'GET',
  path: '/internal/v1/grading/pending',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { query: PageQuery },
  response: { 200: Page(PendingGradeView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-020'],
});
export const CT_GRADING_ROUTES = [
  GradingAttemptsGradeRoute,
  GradingAttemptsSelfGradeRoute,
  GradingTurnsJudgeRoute,
  GradingAppealsCreateRoute,
  GradingAppealsGetRoute,
  GradingVerdictsGetRoute,
  GradingUtterancesStreamRoute,
  GradingFeedbackStreamRoute,
  GradingPendingListRoute,
] as const;
