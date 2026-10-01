import { z } from 'zod';
import { AiMode, Confidence, FormatId, GraderEngine, Level } from '../../../common/domain.js';
import { ConceptId, ItemId, KuId, MisconceptionId, ObjKey, PolicySetId, Sha256Hex, Ulid } from '../../../common/ids.js';
import { AttemptPhase, AttemptResponse, DialogEndReason, DialogKind, DialogMove, TurnJudgement, Utterance, WGraderTable } from '../../../common/practice.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';
import { Verdict } from '../../../events/catalog/grading.js';
import { ItemDeliveryPreSubmit } from './pre-submit/item.js';

// WGraderTable(정본 common/practice.ts): mastery_rules@v1의 w_grader 표(ARC §11.4) — learning이 이벤트 정책 버전으로 해석해 전달
export const EvidenceParams = S({
  policy_version: PolicySetId, w_format: z.number().min(0).max(1),    // 보스 챌린지는 learning이 ×0.5 반영한 값(FR-STD-004)
  w_grader_table: WGraderTable, rapid: z.boolean(), gaming_factor: z.number().min(0).max(1),
});
export type EvidenceParams = z.infer<typeof EvidenceParams>;
export const GradeAttemptRequest = S({
  attempt_id: Ulid, session_id: Ulid, block_id: Ulid.nullable(), run_id: Ulid.nullable(),     // run_id = case·artifact 장기 과제
  item_id: ItemId, item_content_hash: Sha256Hex, phase: AttemptPhase,
  response: AttemptResponse, confidence: Confidence.nullable(), latency_ms: DurationMs, hints_used: z.number().int().min(0).max(4), answered_at: EpochMs,
  evidence_params: EvidenceParams,
  engine_constraints: S({ calibrated_only: z.boolean() }),            // verify·promotion_exam = true (결정적 + 보정 Jev만)
  ai_mode_observed: AiMode,                                           // learning이 마지막으로 본 모드(정보용; 사다리는 content의 현재 모드로 결정)
});
export type GradeAttemptRequest = z.infer<typeof GradeAttemptRequest>;
export const AppealReason = z.enum(['key_wrong', 'ambiguous', 'outdated', 'learner_right', 'other']);
export type AppealReason = z.infer<typeof AppealReason>;
export const AppealView = S({
  appeal_id: Ulid, verdict_id: Ulid, reason: AppealReason,
  state: z.enum(['received', 'classifying', 'regrading', 'upheld', 'rejected', 'user_decision_required']),
  classification: S({ label: z.enum(['key_wrong', 'ambiguous', 'outdated', 'learner_wrong']), engine: GraderEngine, confidence: z.number().min(0).max(1).nullable() }).nullable(),
  new_verdict_id: Ulid.nullable(), rejection_reason_ko: z.string().max(500).nullable(), created_at: EpochMs, decided_at: EpochMs.nullable(),
});
export type AppealView = z.infer<typeof AppealView>;
export const JudgeTurnRequest = S({
  dialog_id: Ulid, turn_id: Ulid, dialog_kind: DialogKind, concept_id: ConceptId, session_id: Ulid.nullable(), level: Level,
  depth: z.number().int().min(1).max(7), depth_max_allowed: z.number().int().min(1).max(7),
  state_summary: S({ moves: z.array(DialogMove).max(30), covered_ku_ids: z.array(KuId).max(50), flagged_mc_ids: z.array(MisconceptionId).max(30),
    fail_streak: z.number().int().min(0), asks_for_answer_count: z.number().int().min(0), turn_count: z.number().int().min(0) }),
  turn_text: z.string().min(1).max(4000),
  d4_choice: S({ item_id: ItemId, item_content_hash: Sha256Hex, option_keys: z.array(ObjKey).min(1).max(4) }).nullable(),
  artifact_ref: S({ run_id: Ulid, attempt_id: Ulid, verdict_id: Ulid.nullable() }).nullable(),     // artifact_rebuttal
  evidence_params: EvidenceParams, ai_mode_observed: AiMode,
});
export type JudgeTurnRequest = z.infer<typeof JudgeTurnRequest>;
export const JudgeTurnResponse = S({
  turn_id: Ulid, judgement: TurnJudgement,
  next_move: S({ move: DialogMove, target_ku_id: KuId.nullable(), target_mc_id: MisconceptionId.nullable(), depth: z.number().int().min(1).max(7) }),
  utterance: Utterance,                                                // static = 질문 은행·반론 은행, stream = AI-G07 ref(콘텐츠가 120s 뒤에도 영속본 재생)
  d4_item: ItemDeliveryPreSubmit.nullable(), verdict: Verdict.nullable(),
  end: S({ ended: z.boolean(), reason: DialogEndReason.nullable() }),  // 12턴·3회 실패·완료(FR-STD-020)
});
export type JudgeTurnResponse = z.infer<typeof JudgeTurnResponse>;
export const PendingGradeView = S({ verdict_id: Ulid, attempt_id: Ulid, item_id: ItemId, format: FormatId, queued_at: EpochMs,
  reason: z.enum(['offline', 'deadline', 'provider_down', 'self_grade_skipped', 'low_confidence', 'appeal']), attempts: z.number().int().min(0), next_try_at: EpochMs.nullable() });   // = gr_pending.reason(CR-38)
export type PendingGradeView = z.infer<typeof PendingGradeView>;
