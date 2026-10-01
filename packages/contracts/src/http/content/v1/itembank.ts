import { z } from 'zod';
import { FormatId, GraderEngine, Level, Stakes } from '../../../common/domain.js';
import { ConceptId, ItemId, ObjKey, Ulid } from '../../../common/ids.js';
import { Cursor } from '../../../common/pagination.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { OverlayPatchBody } from './overlays.js';

export const GateStatus = z.enum(['authored', 'seed_reviewed', 'draft', 'deferred', 'gated_pass', 'gated_fail', 'jev_verified',
  'flagged', 'demoted', 'quarantined', 'retired']);                                 // 출제 가능 = {seed_reviewed, jev_verified, gated_pass}
export type GateStatus = z.infer<typeof GateStatus>;
export const ReportReason = z.enum(['key_wrong', 'ambiguous', 'outdated', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;
export const CreateReportBody = S({ report_id: Ulid, reason: ReportReason, text: z.string().max(2000).nullable(), attempt_id: Ulid.nullable(), session_id: Ulid.nullable() });
export type CreateReportBody = z.infer<typeof CreateReportBody>;
export const CreateReportRequest = S({ report_id: Ulid, item_id: ItemId, reason: ReportReason, text: z.string().max(2000).nullable(),
  attempt_id: Ulid.nullable(), session_id: Ulid.nullable() });
export type CreateReportRequest = z.infer<typeof CreateReportRequest>;
export const ReportView = S({
  report_id: Ulid, item_id: ItemId, reason: ReportReason, text: z.string().nullable(), state: z.enum(['received', 'classified', 'resolved']),
  classification: S({ label: z.enum(['key_wrong', 'ambiguous', 'outdated', 'learner_wrong']), engine: GraderEngine, confidence: z.number().nullable() }).nullable(),
  resolution: S({ kind: z.enum(['fixed_overlay', 'retired', 'kept']), reason_ko: z.string(), patch_id: Ulid.nullable() }).nullable(),
  excluded_from_queue: z.literal(true), evidence_voided: z.boolean(), created_at: EpochMs, resolved_at: EpochMs.nullable(),
});
export type ReportView = z.infer<typeof ReportView>;
export const ResolveReportBody = S({ resolution: z.enum(['fixed_overlay', 'retired', 'kept']), reason_ko: z.string().min(1).max(500), patch: OverlayPatchBody.nullable() });
export type ResolveReportBody = z.infer<typeof ResolveReportBody>;
export const ItemHealthView = S({ item_id: ItemId, concept_id: ConceptId, format: FormatId, gate_status: GateStatus,
  flags: z.array(z.enum(['too_easy', 'too_hard', 'distractor_dead', 'discrimination_low', 'key_suspect', 'latency_outlier'])),
  stats: S({ n: z.number().int(), p_correct: z.number().nullable(), mean_latency_ms: z.number().nullable(), option_freq: z.record(ObjKey, z.number()) }),
  updated_at: EpochMs });
export type ItemHealthView = z.infer<typeof ItemHealthView>;
export const QuarantineItemBody = S({ reason_ko: z.string().min(1).max(500), scope: z.enum(['item', 'family']), evidence_policy: z.enum(['void', 'halve', 'keep']) });
export type QuarantineItemBody = z.infer<typeof QuarantineItemBody>;
export const ItemGateView = S({ item_id: ItemId, gate_status: GateStatus, stem_family: z.string().max(80).nullable(), changed_at: EpochMs, affected_items: z.number().int().min(1) });
export type ItemGateView = z.infer<typeof ItemGateView>;
export const S2Approval = S({ cross_judge_id: Ulid.nullable(), span_check_id: Ulid.nullable(),          // = ib_gate_result.gate_result_id(AI-J07 교차 계열 · AI-J14)
  curator_decision: z.enum(['pending', 'approved', 'rejected']), s2_mode: z.enum(['cross_family', 'same_family', 'v7_review']).nullable() });
export type S2Approval = z.infer<typeof S2Approval>;
export const StagingItemView = S({ staging_id: Ulid, origin: z.enum(['t1', 't2', 't3', 't4', 'user_authored', 'model_sample', 'gap']), concept_id: ConceptId,
  format: FormatId, stakes: Stakes, status: z.enum(['draft', 'deferred', 'gated_pass', 'gated_fail', 'discarded', 'review']),
  preview_md: z.string().max(20_000), s2: S2Approval.nullable(), updated_at: EpochMs });
export type StagingItemView = z.infer<typeof StagingItemView>;
export const StagingListQuery = S({ status: z.enum(['review', 'deferred', 'gated_fail']).optional(), cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50) });
export type StagingListQuery = z.infer<typeof StagingListQuery>;
export const ApproveStagingBody = S({ decision: z.enum(['approve', 'reject']), reason_ko: z.string().max(500).nullable() });
export type ApproveStagingBody = z.infer<typeof ApproveStagingBody>;
export const WarmingView = S({ pools: z.array(S({ concept_id: ConceptId, format: FormatId, level: Level, have: z.number().int(), need: z.number().int() })).max(5000),
  last_forecast_at: EpochMs.nullable(), last_computed_at: EpochMs });
export type WarmingView = z.infer<typeof WarmingView>;
