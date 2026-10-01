import { ItemId, Ulid } from '../../../common/ids.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { PendingGradeView } from '../../content/v1/grading.js';
import {
  ApproveStagingBody,
  ItemGateView,
  ItemHealthQuery,
  ItemHealthView,
  QuarantineItemBody,
  ReportListQuery,
  ReportView,
  ResolveReportBody,
  StagingItemView,
  StagingListQuery,
  WarmingView,
} from '../../content/v1/itembank.js';
import { ConflictListQuery, ConflictView, ResolveConflictBody } from '../../content/v1/overlays.js';

// 하위 = IF-CT-058
export const CurationReportsRoute = defineRoute({
  id: 'gateway.curation.reports',
  ifId: 'IF-GW-095',
  method: 'GET',
  path: '/api/v1/curation/reports',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: ReportListQuery },
  response: { 200: Page(ReportView) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-016', 'FR-SET-011'],
});
// 하위 = IF-CT-059
export const CurationReportResolveRoute = defineRoute({
  id: 'gateway.curation.report_resolve',
  ifId: 'IF-GW-096',
  method: 'POST',
  path: '/api/v1/curation/reports/{report_id}:resolve',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ report_id: Ulid }), body: ResolveReportBody },
  response: { 200: ReportView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-016', 'FR-CUR-020'],
});
// 하위 = IF-CT-060
export const CurationItemHealthRoute = defineRoute({
  id: 'gateway.curation.item_health',
  ifId: 'IF-GW-097',
  method: 'GET',
  path: '/api/v1/curation/item-health',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: ItemHealthQuery },
  response: { 200: Page(ItemHealthView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-014'],
});
// 하위 = IF-CT-048
export const CurationPendingRoute = defineRoute({
  id: 'gateway.curation.pending',
  ifId: 'IF-GW-098',
  method: 'GET',
  path: '/api/v1/curation/pending',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: PageQuery },
  response: { 200: Page(PendingGradeView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-020'],
});
// 하위 = IF-CT-016
export const CurationConflictsRoute = defineRoute({
  id: 'gateway.curation.conflicts',
  ifId: 'IF-GW-099',
  method: 'GET',
  path: '/api/v1/curation/conflicts',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: ConflictListQuery },
  response: { 200: Page(ConflictView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-CUR-020'],
});
// 하위 = IF-CT-019
export const CurationConflictResolveRoute = defineRoute({
  id: 'gateway.curation.conflict_resolve',
  ifId: 'IF-GW-100',
  method: 'POST',
  path: '/api/v1/curation/conflicts/{conflict_id}:resolve',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ conflict_id: Ulid }), body: ResolveConflictBody },
  response: { 200: ConflictView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-CUR-020'],
});
// 하위 = IF-CT-061
export const CurationItemQuarantineRoute = defineRoute({
  id: 'gateway.curation.item_quarantine',
  ifId: 'IF-GW-101',
  method: 'POST',
  path: '/api/v1/curation/items/{item_id}:quarantine',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ item_id: ItemId }), body: QuarantineItemBody },
  response: { 200: ItemGateView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-011', 'FR-QST-015', 'FR-SET-011'],
});
// 하위 = IF-CT-062
export const CurationWarmingRoute = defineRoute({
  id: 'gateway.curation.warming',
  ifId: 'IF-GW-102',
  method: 'GET',
  path: '/api/v1/curation/warming',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: WarmingView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-013'],
});
// 하위 = IF-CT-063
export const CurationStagingRoute = defineRoute({
  id: 'gateway.curation.staging',
  ifId: 'IF-GW-104',
  method: 'GET',
  path: '/api/v1/curation/staging',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: StagingListQuery },
  response: { 200: Page(StagingItemView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-004'],
});
// 하위 = IF-CT-064
export const CurationStagingApproveRoute = defineRoute({
  id: 'gateway.curation.staging_approve',
  ifId: 'IF-GW-133',
  method: 'POST',
  path: '/api/v1/curation/staging/{staging_id}:approve',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ staging_id: Ulid }), body: ApproveStagingBody },
  response: { 200: StagingItemView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-004'],
});
export const GW_CURATION_ROUTES = [
  CurationReportsRoute,
  CurationReportResolveRoute,
  CurationItemHealthRoute,
  CurationPendingRoute,
  CurationConflictsRoute,
  CurationConflictResolveRoute,
  CurationItemQuarantineRoute,
  CurationWarmingRoute,
  CurationStagingRoute,
  CurationStagingApproveRoute,
] as const;
