import { z } from 'zod';
import { FormatId, GraderEngine, Level, Stakes } from '../../../common/domain.js';
import { ConceptId, ItemId, ObjKey, Ulid } from '../../../common/ids.js';
import { Cursor, Page } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { OverlayPatchBody } from './overlays.js';
import { HintQuery, HintViewPreSubmit } from './pre-submit/hint.js';
import { SelectItemsRequest, SelectItemsResponse } from './pre-submit/item.js';

export const GateStatus = z.enum([
  'authored',
  'seed_reviewed',
  'draft',
  'deferred',
  'gated_pass',
  'gated_fail',
  'jev_verified',
  'flagged',
  'demoted',
  'quarantined',
  'retired',
]); // 출제 가능 = {seed_reviewed, jev_verified, gated_pass}
export type GateStatus = z.infer<typeof GateStatus>;
export const ReportReason = z.enum(['key_wrong', 'ambiguous', 'outdated', 'other']);
export type ReportReason = z.infer<typeof ReportReason>;
export const CreateReportBody = S({
  report_id: Ulid,
  reason: ReportReason,
  text: z.string().max(2000).nullable(),
  attempt_id: Ulid.nullable(),
  session_id: Ulid.nullable(),
});
export type CreateReportBody = z.infer<typeof CreateReportBody>;
export const CreateReportRequest = S({
  report_id: Ulid,
  item_id: ItemId,
  reason: ReportReason,
  text: z.string().max(2000).nullable(),
  attempt_id: Ulid.nullable(),
  session_id: Ulid.nullable(),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequest>;
export const ReportView = S({
  report_id: Ulid,
  item_id: ItemId,
  reason: ReportReason,
  text: z.string().nullable(),
  state: z.enum(['received', 'classified', 'resolved']),
  classification: S({
    label: z.enum(['key_wrong', 'ambiguous', 'outdated', 'learner_wrong']),
    engine: GraderEngine,
    confidence: z.number().nullable(),
  }).nullable(),
  resolution: S({
    kind: z.enum(['fixed_overlay', 'retired', 'kept']),
    reason_ko: z.string(),
    patch_id: Ulid.nullable(),
  }).nullable(),
  excluded_from_queue: z.literal(true),
  evidence_voided: z.boolean(),
  created_at: EpochMs,
  resolved_at: EpochMs.nullable(),
});
export type ReportView = z.infer<typeof ReportView>;
export const ResolveReportBody = S({
  resolution: z.enum(['fixed_overlay', 'retired', 'kept']),
  reason_ko: z.string().min(1).max(500),
  patch: OverlayPatchBody.nullable(),
});
export type ResolveReportBody = z.infer<typeof ResolveReportBody>;
export const ItemHealthView = S({
  item_id: ItemId,
  concept_id: ConceptId,
  format: FormatId,
  gate_status: GateStatus,
  flags: z.array(
    z.enum(['too_easy', 'too_hard', 'distractor_dead', 'discrimination_low', 'key_suspect', 'latency_outlier']),
  ),
  stats: S({
    n: z.number().int(),
    p_correct: z.number().nullable(),
    mean_latency_ms: z.number().nullable(),
    option_freq: z.record(ObjKey, z.number()),
  }),
  updated_at: EpochMs,
});
export type ItemHealthView = z.infer<typeof ItemHealthView>;
export const QuarantineItemBody = S({
  reason_ko: z.string().min(1).max(500),
  scope: z.enum(['item', 'family']),
  evidence_policy: z.enum(['void', 'halve', 'keep']),
});
export type QuarantineItemBody = z.infer<typeof QuarantineItemBody>;
export const ItemGateView = S({
  item_id: ItemId,
  gate_status: GateStatus,
  stem_family: z.string().max(80).nullable(),
  changed_at: EpochMs,
  affected_items: z.number().int().min(1),
});
export type ItemGateView = z.infer<typeof ItemGateView>;
export const S2Approval = S({
  cross_judge_id: Ulid.nullable(),
  span_check_id: Ulid.nullable(), // = ib_gate_result.gate_result_id(AI-J07 교차 계열 · AI-J14)
  curator_decision: z.enum(['pending', 'approved', 'rejected']),
  s2_mode: z.enum(['cross_family', 'same_family', 'v7_review']).nullable(),
});
export type S2Approval = z.infer<typeof S2Approval>;
export const StagingItemView = S({
  staging_id: Ulid,
  origin: z.enum(['t1', 't2', 't3', 't4', 'user_authored', 'model_sample', 'gap']),
  concept_id: ConceptId,
  format: FormatId,
  stakes: Stakes,
  status: z.enum(['draft', 'deferred', 'gated_pass', 'gated_fail', 'discarded', 'review']),
  preview_md: z.string().max(20_000),
  s2: S2Approval.nullable(),
  updated_at: EpochMs,
});
export type StagingItemView = z.infer<typeof StagingItemView>;
export const StagingListQuery = S({
  status: z.enum(['review', 'deferred', 'gated_fail']).optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type StagingListQuery = z.infer<typeof StagingListQuery>;
export const ApproveStagingBody = S({
  decision: z.enum(['approve', 'reject']),
  reason_ko: z.string().max(500).nullable(),
});
export type ApproveStagingBody = z.infer<typeof ApproveStagingBody>;
export const WarmingView = S({
  pools: z
    .array(S({ concept_id: ConceptId, format: FormatId, level: Level, have: z.number().int(), need: z.number().int() }))
    .max(5000),
  last_forecast_at: EpochMs.nullable(),
  last_computed_at: EpochMs,
});
export type WarmingView = z.infer<typeof WarmingView>;
export const ReportListQuery = S({
  state: ReportView.shape.state.optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ReportListQuery = z.infer<typeof ReportListQuery>;
export const ItemHealthQuery = S({
  flag: ItemHealthView.shape.flags.element.optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ItemHealthQuery = z.infer<typeof ItemHealthQuery>;
export const ItembankItemsSelectRoute = defineRoute({
  id: 'content.itembank.items.select',
  ifId: 'IF-CT-055',
  method: 'POST',
  path: '/internal/v1/itembank/items:select',
  allowedCallers: ['learning'],
  idempotent: false,
  paginated: false,
  request: { body: SelectItemsRequest },
  response: { 200: SelectItemsResponse },
  deadlineMs: 1500,
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-002~009', 'FR-STD-032', 'FR-QST-001', 'FR-QST-002', 'FR-QST-006', 'FR-QST-013', 'FR-LAB-012'],
});
export const ItembankItemsHintRoute = defineRoute({
  id: 'content.itembank.items.hint',
  ifId: 'IF-CT-056',
  method: 'GET',
  path: '/internal/v1/itembank/items/{item_id}/hints/{step}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ item_id: ItemId, step: z.coerce.number().int().min(1).max(4) }), query: HintQuery },
  response: { 200: HintViewPreSubmit },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-LAB-005'],
});
// idem = report_id
export const ItembankReportsCreateRoute = defineRoute({
  id: 'content.itembank.reports.create',
  ifId: 'IF-CT-057',
  method: 'POST',
  path: '/internal/v1/itembank/reports',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: CreateReportRequest },
  response: { 201: ReportView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-016'],
});
export const ItembankReportsListRoute = defineRoute({
  id: 'content.itembank.reports.list',
  ifId: 'IF-CT-058',
  method: 'GET',
  path: '/internal/v1/itembank/reports',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { query: ReportListQuery },
  response: { 200: Page(ReportView) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-016', 'FR-SET-011'],
});
export const ItembankReportsResolveRoute = defineRoute({
  id: 'content.itembank.reports.resolve',
  ifId: 'IF-CT-059',
  method: 'POST',
  path: '/internal/v1/itembank/reports/{report_id}:resolve',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ report_id: Ulid }), body: ResolveReportBody },
  response: { 200: ReportView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-016', 'FR-CUR-020'],
});
export const ItembankHealthRoute = defineRoute({
  id: 'content.itembank.health',
  ifId: 'IF-CT-060',
  method: 'GET',
  path: '/internal/v1/itembank/health',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { query: ItemHealthQuery },
  response: { 200: Page(ItemHealthView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-014'],
});
export const ItembankItemsQuarantineRoute = defineRoute({
  id: 'content.itembank.items.quarantine',
  ifId: 'IF-CT-061',
  method: 'POST',
  path: '/internal/v1/itembank/items/{item_id}:quarantine',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ item_id: ItemId }), body: QuarantineItemBody },
  response: { 200: ItemGateView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-011', 'FR-QST-015'],
});
export const ItembankWarmingRoute = defineRoute({
  id: 'content.itembank.warming',
  ifId: 'IF-CT-062',
  method: 'GET',
  path: '/internal/v1/itembank/warming',
  allowedCallers: ['gateway', 'ops-api'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: WarmingView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-013'],
});
export const ItembankStagingListRoute = defineRoute({
  id: 'content.itembank.staging.list',
  ifId: 'IF-CT-063',
  method: 'GET',
  path: '/internal/v1/itembank/staging',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { query: StagingListQuery },
  response: { 200: Page(StagingItemView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-004'],
});
export const ItembankStagingApproveRoute = defineRoute({
  id: 'content.itembank.staging.approve',
  ifId: 'IF-CT-064',
  method: 'POST',
  path: '/internal/v1/itembank/staging/{staging_id}:approve',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ staging_id: Ulid }), body: ApproveStagingBody },
  response: { 200: StagingItemView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-004'],
});
export const CT_ITEMBANK_ROUTES = [
  ItembankItemsSelectRoute,
  ItembankItemsHintRoute,
  ItembankReportsCreateRoute,
  ItembankReportsListRoute,
  ItembankReportsResolveRoute,
  ItembankHealthRoute,
  ItembankItemsQuarantineRoute,
  ItembankWarmingRoute,
  ItembankStagingListRoute,
  ItembankStagingApproveRoute,
] as const;
