import { z } from 'zod';
import { Confidence, FsrsRating } from '../../../common/domain.js';
import { ItemId, ObjKey, Sha256Hex, Ulid } from '../../../common/ids.js';
import { AttemptResponse } from '../../../common/practice.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { AppealReason } from '../../content/v1/grading.js';

export const SubmitAttemptBody = S({
  attempt_id: Ulid, block_id: Ulid, item_id: ItemId, item_content_hash: Sha256Hex,
  response: AttemptResponse, confidence: Confidence.nullable(),
  presented_at: EpochMs, answered_at: EpochMs,                                   // 서버가 [session.started_at, now]로 클램프(ADR-011 §2)
  hints_used: z.number().int().min(0).max(4), timer_extended: z.boolean(),
});
export type SubmitAttemptBody = z.infer<typeof SubmitAttemptBody>;
export const SelfGradeBody = z.discriminatedUnion('decision', [
  S({ decision: z.literal('grade'), checks: z.record(ObjKey, z.number().int().min(0).max(4)), overall: FsrsRating.nullable() }),
  S({ decision: z.literal('skip') }),                                            // → PENDING Verdict(w 0), 보류 큐
]);
export type SelfGradeBody = z.infer<typeof SelfGradeBody>;
export const ConfirmRatingBody = S({ accept: z.boolean(), rating: FsrsRating });
export type ConfirmRatingBody = z.infer<typeof ConfirmRatingBody>;
export const ConfirmRatingAck = S({ ledger_event_id: Ulid, applied_rating: FsrsRating });
export type ConfirmRatingAck = z.infer<typeof ConfirmRatingAck>;
export const CreateAppealBody = S({ appeal_id: Ulid, verdict_id: Ulid, reason: AppealReason, text: z.string().max(2000).nullable() }); // AppealReason = IF-CT-043
export type CreateAppealBody = z.infer<typeof CreateAppealBody>;
export const AppealBody = S({ appeal_id: Ulid, reason: AppealReason, text: z.string().max(2000).nullable() });                      // 공개(IF-GW-036)
export type AppealBody = z.infer<typeof AppealBody>;
export const SelfAssessmentBody = S({
  assessment_id: Ulid, kind: z.enum(['self_grade', 'bias_probe']),
  target: S({ kind: z.enum(['item', 'attempt']), id: z.string().max(160) }), value: z.number().min(0).max(4),
});
export type SelfAssessmentBody = z.infer<typeof SelfAssessmentBody>;
export const SelfAssessmentAck = S({ ledger_event_id: Ulid });
export type SelfAssessmentAck = z.infer<typeof SelfAssessmentAck>;
