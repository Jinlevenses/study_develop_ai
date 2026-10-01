import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { AutostartView, PutAutostartBody } from '../../ops/v1/autostart.js';
import {
  BackupSummary,
  PutSecondaryBody,
  RestoreBody,
  RunBackupBody,
  SecondaryTarget,
  UnlockSecondaryBody,
} from '../../ops/v1/backups.js';
import { DoctorReport, RunDoctorBody } from '../../ops/v1/doctor.js';
import { HealthBoard } from '../../ops/v1/health.js';
import { LogLine, LogQuery, LogTail, LogTailQuery } from '../../ops/v1/logs.js';
import { Operation, OperationListQuery } from '../../ops/v1/operations.js';
import { SloView, TripwireSettings, TripwireView } from '../../ops/v1/telemetry.js';
import { TimelineQuery, TimelineView } from '../../ops/v1/timeline.js';
import { ExportBody, ImportBody } from '../../ops/v1/transfer.js';

// 하위 = IF-OP-001
export const OpsHealthRoute = defineRoute({
  id: 'gateway.ops.health',
  ifId: 'IF-GW-135',
  method: 'GET',
  path: '/api/v1/ops/health',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: HealthBoard },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-001', 'FR-SET-002', 'FR-SET-017', 'NFR-AVL-005'],
});
// 하위 = IF-OP-002
export const OpsBannerDismissRoute = defineRoute({
  id: 'gateway.ops.banner_dismiss',
  ifId: 'IF-GW-136',
  method: 'POST',
  path: '/api/v1/ops/banners/{banner_id}:dismiss',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ banner_id: Ulid }) },
  response: { 204: z.null() },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-017'],
});
// 하위 = IF-OP-003
export const OpsOperationRoute = defineRoute({
  id: 'gateway.ops.operation',
  ifId: 'IF-GW-137',
  method: 'GET',
  path: '/api/v1/ops/operations/{op_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ op_id: Ulid }) },
  response: { 200: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004~006'],
});
// 하위 = IF-OP-004
export const OpsOperationsRoute = defineRoute({
  id: 'gateway.ops.operations',
  ifId: 'IF-GW-138',
  method: 'GET',
  path: '/api/v1/ops/operations',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: OperationListQuery },
  response: { 200: Page(Operation) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-016'],
});
// 하위 = IF-OP-010
export const OpsBackupRunRoute = defineRoute({
  id: 'gateway.ops.backup_run',
  ifId: 'IF-GW-139',
  method: 'POST',
  path: '/api/v1/ops/backups',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: RunBackupBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004'],
});
// 하위 = IF-OP-011
export const OpsBackupsRoute = defineRoute({
  id: 'gateway.ops.backups',
  ifId: 'IF-GW-140',
  method: 'GET',
  path: '/api/v1/ops/backups',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: PageQuery },
  response: { 200: Page(BackupSummary) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'FR-SET-005'],
});
// 하위 = IF-OP-012
export const OpsRestoreRoute = defineRoute({
  id: 'gateway.ops.restore',
  ifId: 'IF-GW-141',
  method: 'POST',
  path: '/api/v1/ops/restores',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: RestoreBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-005'],
});
// 하위 = IF-OP-014
export const OpsSecondaryRoute = defineRoute({
  id: 'gateway.ops.secondary',
  ifId: 'IF-GW-142',
  method: 'GET',
  path: '/api/v1/ops/backups/secondary',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SecondaryTarget },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'FR-SET-025'],
});
// 하위 = IF-OP-015
export const OpsSecondaryPutRoute = defineRoute({
  id: 'gateway.ops.secondary_put',
  ifId: 'IF-GW-143',
  method: 'PUT',
  path: '/api/v1/ops/backups/secondary',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PutSecondaryBody },
  response: { 200: SecondaryTarget },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'FR-SET-025'],
});
// 하위 = IF-OP-016
export const OpsSecondaryUnlockRoute = defineRoute({
  id: 'gateway.ops.secondary_unlock',
  ifId: 'IF-GW-144',
  method: 'POST',
  path: '/api/v1/ops/backups/secondary:unlock',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: UnlockSecondaryBody },
  response: { 200: SecondaryTarget },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-SEC-018'],
});
// 하위 = IF-OP-020
export const OpsExportRoute = defineRoute({
  id: 'gateway.ops.export',
  ifId: 'IF-GW-145',
  method: 'POST',
  path: '/api/v1/ops/exports',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: ExportBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-006', 'FR-SET-022', 'FR-DSH-014'],
});
// 하위 = IF-OP-021
export const OpsImportRoute = defineRoute({
  id: 'gateway.ops.import',
  ifId: 'IF-GW-146',
  method: 'POST',
  path: '/api/v1/ops/imports',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: ImportBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-006', 'FR-SET-022'],
});
// 하위 = IF-OP-025
export const OpsDoctorRoute = defineRoute({
  id: 'gateway.ops.doctor',
  ifId: 'IF-GW-147',
  method: 'GET',
  path: '/api/v1/ops/doctor',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: DoctorReport },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-003'],
});
// 하위 = IF-OP-026
export const OpsDoctorRunRoute = defineRoute({
  id: 'gateway.ops.doctor_run',
  ifId: 'IF-GW-148',
  method: 'POST',
  path: '/api/v1/ops/doctor:run',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: RunDoctorBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-003'],
});
// 하위 = IF-OP-040
export const OpsTimelineRoute = defineRoute({
  id: 'gateway.ops.timeline',
  ifId: 'IF-GW-149',
  method: 'GET',
  path: '/api/v1/ops/timeline',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: TimelineQuery },
  response: { 200: TimelineView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-016'],
});
// 하위 = IF-OP-041
export const OpsLogsRoute = defineRoute({
  id: 'gateway.ops.logs',
  ifId: 'IF-GW-150',
  method: 'GET',
  path: '/api/v1/ops/logs',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: LogQuery },
  response: { 200: Page(LogLine) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-016'],
});
// 하위 = IF-OP-042
export const OpsLogsTailRoute = defineRoute({
  id: 'gateway.ops.logs_tail',
  ifId: 'IF-GW-151',
  method: 'GET',
  path: '/api/v1/ops/logs/tail',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: LogTailQuery },
  response: { 200: LogTail },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-016'],
});
// 하위 = IF-OP-045
export const OpsTripwiresRoute = defineRoute({
  id: 'gateway.ops.tripwires',
  ifId: 'IF-GW-152',
  method: 'GET',
  path: '/api/v1/ops/tripwires',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: TripwireView },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-AVL-008', 'FR-SET-021'],
});
// 하위 = IF-OP-047
export const OpsTripwireSettingsRoute = defineRoute({
  id: 'gateway.ops.tripwire_settings',
  ifId: 'IF-GW-153',
  method: 'PUT',
  path: '/api/v1/ops/tripwires/settings',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: TripwireSettings },
  response: { 200: TripwireSettings },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-021'],
});
// 하위 = IF-OP-035
export const OpsAutostartRoute = defineRoute({
  id: 'gateway.ops.autostart',
  ifId: 'IF-GW-154',
  method: 'GET',
  path: '/api/v1/ops/autostart',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: AutostartView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-024'],
});
// 하위 = IF-OP-036
export const OpsAutostartPutRoute = defineRoute({
  id: 'gateway.ops.autostart_put',
  ifId: 'IF-GW-155',
  method: 'PUT',
  path: '/api/v1/ops/autostart',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PutAutostartBody },
  response: { 200: AutostartView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-024'],
});
// 하위 = IF-OP-051
export const OpsServiceRestartRoute = defineRoute({
  id: 'gateway.ops.service_restart',
  ifId: 'IF-GW-156',
  method: 'POST',
  path: '/api/v1/ops/services/{svc}:restart',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ svc: z.string().regex(/^[a-z-]{1,40}$/) }) },
  response: { 202: Operation },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-002', 'FR-SET-003'],
});
// 하위 = IF-OP-046
export const OpsSloRoute = defineRoute({
  id: 'gateway.ops.slo',
  ifId: 'IF-GW-157',
  method: 'GET',
  path: '/api/v1/ops/slo',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SloView },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-PERF-*', 'TW-12'],
});
export const GW_OPS_ROUTES = [
  OpsHealthRoute,
  OpsBannerDismissRoute,
  OpsOperationRoute,
  OpsOperationsRoute,
  OpsBackupRunRoute,
  OpsBackupsRoute,
  OpsRestoreRoute,
  OpsSecondaryRoute,
  OpsSecondaryPutRoute,
  OpsSecondaryUnlockRoute,
  OpsExportRoute,
  OpsImportRoute,
  OpsDoctorRoute,
  OpsDoctorRunRoute,
  OpsTimelineRoute,
  OpsLogsRoute,
  OpsLogsTailRoute,
  OpsTripwiresRoute,
  OpsTripwireSettingsRoute,
  OpsAutostartRoute,
  OpsAutostartPutRoute,
  OpsServiceRestartRoute,
  OpsSloRoute,
] as const;
