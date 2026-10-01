import { Ulid } from '../../../common/ids.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import {
  ApproveImportBody,
  CreateImportBody,
  ImportJobView,
  ImportListQuery,
  RejectImportBody,
  StagingDiffPage,
} from '../../content/v1/acquisition.js';

// idem = job_id
// 하위 = IF-CT-030
export const ImportsCreateRoute = defineRoute({
  id: 'gateway.imports.create',
  ifId: 'IF-GW-088',
  method: 'POST',
  path: '/api/v1/imports',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: CreateImportBody },
  response: { 202: ImportJobView },
  bodyLimitBytes: 4_194_304,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-001', 'FR-IMP-002', 'FR-IMP-010'],
});
// 하위 = IF-CT-031
export const ImportsListRoute = defineRoute({
  id: 'gateway.imports.list',
  ifId: 'IF-GW-089',
  method: 'GET',
  path: '/api/v1/imports',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: ImportListQuery },
  response: { 200: Page(ImportJobView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-003', 'FR-IMP-012'],
});
// 하위 = IF-CT-032
export const ImportsGetRoute = defineRoute({
  id: 'gateway.imports.get',
  ifId: 'IF-GW-090',
  method: 'GET',
  path: '/api/v1/imports/{job_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ job_id: Ulid }) },
  response: { 200: ImportJobView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-003'],
});
// 하위 = IF-CT-033
export const ImportsDiffRoute = defineRoute({
  id: 'gateway.imports.diff',
  ifId: 'IF-GW-091',
  method: 'GET',
  path: '/api/v1/imports/{job_id}/diff',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { params: S({ job_id: Ulid }), query: PageQuery },
  response: { 200: StagingDiffPage },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-009'],
});
// 하위 = IF-CT-034
export const ImportsApproveRoute = defineRoute({
  id: 'gateway.imports.approve',
  ifId: 'IF-GW-092',
  method: 'POST',
  path: '/api/v1/imports/{job_id}:approve',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ job_id: Ulid }), body: ApproveImportBody },
  response: { 200: ImportJobView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-009', 'FR-IMP-011'],
});
// 하위 = IF-CT-038
export const ImportsRejectRoute = defineRoute({
  id: 'gateway.imports.reject',
  ifId: 'IF-GW-093',
  method: 'POST',
  path: '/api/v1/imports/{job_id}:reject',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ job_id: Ulid }), body: RejectImportBody },
  response: { 200: ImportJobView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-009'],
});
// 하위 = IF-CT-039
export const ImportsResumeRoute = defineRoute({
  id: 'gateway.imports.resume',
  ifId: 'IF-GW-094',
  method: 'POST',
  path: '/api/v1/imports/{job_id}:resume',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ job_id: Ulid }) },
  response: { 202: ImportJobView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-003'],
});
export const GW_IMPORTS_ROUTES = [
  ImportsCreateRoute,
  ImportsListRoute,
  ImportsGetRoute,
  ImportsDiffRoute,
  ImportsApproveRoute,
  ImportsRejectRoute,
  ImportsResumeRoute,
] as const;
