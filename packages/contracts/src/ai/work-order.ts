import { z } from 'zod';
import { ContextRef } from './data-class.js';
import { TaskId } from './tasks.js';
import { Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';

export const WorkOrderPurpose = z.enum(['import', 'generation', 'regate', 'tier_promotion', 'pack_refresh', 'calibration', 'canary',
  'warming', 'appeal_regrade', 'pending_regrade']);
export type WorkOrderPurpose = z.infer<typeof WorkOrderPurpose>;
export const WorkOrderEstimate = S({ calls: z.number().int().min(0), krw: z.number().int().min(0), quota_pct: z.number().min(0).max(100), duration_s: z.number().int().min(0) });
export type WorkOrderEstimate = z.infer<typeof WorkOrderEstimate>;
export const CreateWorkOrderBody = S({
  work_order_id: Ulid, purpose: WorkOrderPurpose, requested_by: z.enum(['content', 'user', 'system']), context_ref: ContextRef,
  tasks: z.array(S({ task_id: TaskId, calls: z.number().int().min(1).max(100_000),
    est_input_tokens: z.number().int().min(0).nullable(), est_output_tokens: z.number().int().min(0).nullable() })).min(1).max(20),
});
export type CreateWorkOrderBody = z.infer<typeof CreateWorkOrderBody>;
export const WorkOrderView = S({
  work_order_id: Ulid, purpose: WorkOrderPurpose, requested_by: z.enum(['content', 'user', 'system']),
  state: z.enum(['approval_required', 'approved', 'rejected', 'exhausted', 'expired', 'completed']),
  tasks: z.array(S({ task_id: TaskId, calls: z.number().int() })).max(20),                                          // GLB-WO 'AI-G05 ×80 · AI-J14 ×40'(CR-39)
  estimate: WorkOrderEstimate, threshold_exceeded: S({ calls: z.boolean(), krw: z.boolean(), quota: z.boolean() }),   // 임계(ai_policy@v1.bulk, 엄격 초과): calls > 50 ∨ krw > 1000 ∨ quota_pct > 20
  reservation: S({ calls: z.number().int(), krw: z.number().int(), expires_at: EpochMs }).nullable(),                 // v1 lite: 승인 플래그 + 추정(예약은 Should)
  usage: S({ calls: z.number().int(), krw: z.number().int() }),
  created_at: EpochMs, decided_at: EpochMs.nullable(), decided_by: z.enum(['auto', 'user']).nullable(),
});
export type WorkOrderView = z.infer<typeof WorkOrderView>;
export const DecideWorkOrderBody = S({ decision: z.enum(['approve', 'reject']),
  cap: S({ calls: z.number().int().min(0).nullable(), krw: z.number().int().min(0).nullable() }).nullable() });
export type DecideWorkOrderBody = z.infer<typeof DecideWorkOrderBody>;
