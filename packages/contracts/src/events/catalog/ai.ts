import { z } from 'zod';
import { JudgeTaskId, TaskId } from '../../ai/tasks.js';
import { WorkOrderEstimate, WorkOrderPurpose } from '../../ai/work-order.js';
import { AiMode, ProviderKind, ProviderStatus } from '../../common/domain.js';
import { ProviderId, SemVer, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { EpochMs } from '../../common/time.js';
import { ModeReason } from '../../http/ai-gateway/v1/mode.js';

export const AiModeChangedV1 = S({                              // IF-EV-14
  mode: AiMode, previous_mode: AiMode.nullable(), reasons: z.array(ModeReason).max(10),
  providers: z.array(S({ id: ProviderId, kind: ProviderKind, status: ProviderStatus })).max(32), changed_at: EpochMs,
});
export type AiModeChangedV1 = z.infer<typeof AiModeChangedV1>;
export const AiProviderStatusChangedV1 = S({                    // IF-EV-15
  provider_id: ProviderId, status: ProviderStatus, breaker: z.enum(['closed', 'open', 'half_open']), reason_code: z.string().max(60).nullable(),
});
export type AiProviderStatusChangedV1 = z.infer<typeof AiProviderStatusChangedV1>;
export const AiJobCompletedV1 = S({                             // IF-EV-16
  job_id: Ulid, task_id: TaskId, work_order_id: Ulid, outcome: z.enum(['ok', 'failed', 'cancelled', 'deferred']),
  result_ref: Ulid.nullable(), prompt_version: SemVer.nullable(),
});
export type AiJobCompletedV1 = z.infer<typeof AiJobCompletedV1>;
export const AiWorkOrderApprovalRequestedV1 = S({              // IF-EV-17
  work_order_id: Ulid, purpose: WorkOrderPurpose, estimate: WorkOrderEstimate, requested_by: z.enum(['content', 'user', 'system']),
});
export type AiWorkOrderApprovalRequestedV1 = z.infer<typeof AiWorkOrderApprovalRequestedV1>;
export const AiWorkOrderDecidedV1 = S({                         // IF-EV-18
  work_order_id: Ulid, decision: z.enum(['approved', 'rejected', 'exhausted', 'expired']),
  reservation: S({ calls: z.number().int(), krw: z.number().int(), expires_at: EpochMs }).nullable(),
});
export type AiWorkOrderDecidedV1 = z.infer<typeof AiWorkOrderDecidedV1>;
export const AiBudgetThresholdReachedV1 = S({                   // IF-EV-19 (FR-AI-007)
  scope: z.enum(['money', 'quota']), provider_id: ProviderId.nullable(), ratio: z.union([z.literal(0.8), z.literal(1)]),
  period: z.string().regex(/^(\d{4}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}|\d{4}-W\d{2})$/),   // 월 'YYYY-MM' · 5h 창 시작 'YYYY-MM-DDTHH' · 주 'YYYY-Www'
});
export type AiBudgetThresholdReachedV1 = z.infer<typeof AiBudgetThresholdReachedV1>;
export const AiJudgeDriftDetectedV1 = S({                       // IF-EV-20
  provider_id: ProviderId, task_id: JudgeTaskId, model_version_prev: z.string().max(80), model_version_new: z.string().max(80),
});
export type AiJudgeDriftDetectedV1 = z.infer<typeof AiJudgeDriftDetectedV1>;
