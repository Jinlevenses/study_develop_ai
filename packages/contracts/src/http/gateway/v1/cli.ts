import { z } from 'zod';
import { RuntimeProfile } from '../../../common/domain.js';
import { SemVer, TrackId, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { CaptureInboxBody, InboxItemView } from '../../content/v1/acquisition.js';
import {
  BlueprintView,
  ImportBlueprintBody,
  InstalledPackList,
  PackInstallView,
  PackSource,
} from '../../content/v1/catalog.js';
import { AutostartView } from '../../ops/v1/autostart.js';
import { RestoreBody, RunBackupBody } from '../../ops/v1/backups.js';
import { RunDoctorBody } from '../../ops/v1/doctor.js';
import { HealthBoard } from '../../ops/v1/health.js';
import { Operation } from '../../ops/v1/operations.js';
import { ExportBody, ImportBody } from '../../ops/v1/transfer.js';
import { BootstrapTokenRequest, BootstrapTokenResponse } from './session.js';

export const CliStatus = S({
  app_version: SemVer,
  profile: RuntimeProfile,
  url: z.string().url(),
  health: HealthBoard,
});
export type CliStatus = z.infer<typeof CliStatus>;
export const CliShutdownBody = S({ op_id: Ulid, grace_ms: z.number().int().min(0).max(10_000) }); // CLI 202 라우트의 op_id = Idempotency-Key
export type CliShutdownBody = z.infer<typeof CliShutdownBody>;
export const SessionKeyRotated = S({ rotated_at: EpochMs, sessions_invalidated: z.literal(true) });
export type SessionKeyRotated = z.infer<typeof SessionKeyRotated>;
export const CliPackBody = z.discriminatedUnion('action', [
  S({ action: z.literal('install'), install_id: Ulid, source: PackSource }), // fathom seed (동봉 .fpack)
  S({ action: z.literal('upgrade'), install_id: Ulid, source: PackSource }), // fathom pack upgrade <file>
  S({ action: z.literal('add'), install_id: Ulid, dir: z.string().min(1).max(1024) }), // R3: 사용자 팩 원천 디렉터리 → packc 자식
  S({ action: z.literal('refresh'), install_id: Ulid, track: TrackId, work_order_id: Ulid.nullable() }), // R3
]);
export type CliPackBody = z.infer<typeof CliPackBody>;
export const CliAutostartBody = S({ action: z.enum(['on', 'off', 'status']) });
export type CliAutostartBody = z.infer<typeof CliAutostartBody>;
export const CliUpgradeBody = z.discriminatedUnion('action', [
  S({ action: z.literal('upgrade'), op_id: Ulid, bundle_path: z.string().min(1).max(1024) }),
  S({ action: z.literal('rollback'), op_id: Ulid }),
]);
export type CliUpgradeBody = z.infer<typeof CliUpgradeBody>;
export const CliBootstrapTokenRoute = defineRoute({
  id: 'gateway.cli.bootstrap_token',
  ifId: 'IF-GW-001',
  method: 'POST',
  path: '/api/v1/cli/bootstrap-token',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: BootstrapTokenRequest },
  response: { 201: BootstrapTokenResponse },
  freeze: 'D',
  slice: 'R0',
  fr: ['NFR-SEC-019', 'FR-SET-023'],
});
// 하위 ⊕ IF-OP-001
export const CliStatusRoute = defineRoute({
  id: 'gateway.cli.status',
  ifId: 'IF-GW-180',
  method: 'GET',
  path: '/api/v1/cli/status',
  allowedCallers: ['cli'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: CliStatus },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-015'],
});
// 하위 = IF-OP-050
export const CliShutdownRoute = defineRoute({
  id: 'gateway.cli.shutdown',
  ifId: 'IF-GW-181',
  method: 'POST',
  path: '/api/v1/cli/shutdown',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: CliShutdownBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-001', 'FR-SET-015'],
});
// 하위 = IF-OP-026
export const CliDoctorRoute = defineRoute({
  id: 'gateway.cli.doctor',
  ifId: 'IF-GW-182',
  method: 'POST',
  path: '/api/v1/cli/doctor',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: RunDoctorBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-003'],
});
// 하위 — (gateway가 `run/session.key` 원자 교체)
export const CliRotateSessionKeyRoute = defineRoute({
  id: 'gateway.cli.rotate_session_key',
  ifId: 'IF-GW-183',
  method: 'POST',
  path: '/api/v1/cli/session-key:rotate',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: {},
  response: { 200: SessionKeyRotated },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-SEC-019'],
});
// 하위 = IF-OP-010
export const CliBackupRoute = defineRoute({
  id: 'gateway.cli.backup',
  ifId: 'IF-GW-184',
  method: 'POST',
  path: '/api/v1/cli/backups',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: RunBackupBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004'],
});
// 하위 = IF-OP-012
export const CliRestoreRoute = defineRoute({
  id: 'gateway.cli.restore',
  ifId: 'IF-GW-185',
  method: 'POST',
  path: '/api/v1/cli/restores',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: RestoreBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-005'],
});
// 하위 = IF-OP-020
export const CliExportRoute = defineRoute({
  id: 'gateway.cli.export',
  ifId: 'IF-GW-186',
  method: 'POST',
  path: '/api/v1/cli/exports',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: ExportBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-006', 'FR-SET-022'],
});
// 하위 = IF-OP-021
export const CliImportRoute = defineRoute({
  id: 'gateway.cli.import',
  ifId: 'IF-GW-187',
  method: 'POST',
  path: '/api/v1/cli/imports',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: ImportBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-006', 'FR-SET-022'],
});
// idem = inbox_id
// 하위 = IF-CT-035
export const CliCaptureRoute = defineRoute({
  id: 'gateway.cli.capture',
  ifId: 'IF-GW-188',
  method: 'POST',
  path: '/api/v1/cli/capture',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: CaptureInboxBody },
  response: { 201: InboxItemView },
  bodyLimitBytes: 4_194_304,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-IMP-013'],
});
// 하위 = IF-CT-003
export const CliPacksRoute = defineRoute({
  id: 'gateway.cli.packs',
  ifId: 'IF-GW-189',
  method: 'GET',
  path: '/api/v1/cli/packs',
  allowedCallers: ['cli'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: InstalledPackList },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-014'],
});
// 하위 install·upgrade·add → IF-CT-001 / refresh → IF-CT-023
export const CliPacksActionRoute = defineRoute({
  id: 'gateway.cli.packs_action',
  ifId: 'IF-GW-190',
  method: 'POST',
  path: '/api/v1/cli/packs',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: CliPackBody },
  response: { 202: PackInstallView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-014', 'FR-CUR-022', 'FR-CUR-023'],
});
// 하위 = IF-CT-002
export const CliPackInstallRoute = defineRoute({
  id: 'gateway.cli.pack_install',
  ifId: 'IF-GW-191',
  method: 'GET',
  path: '/api/v1/cli/packs/installs/{install_id}',
  allowedCallers: ['cli'],
  idempotent: false,
  paginated: false,
  request: { params: S({ install_id: Ulid }) },
  response: { 200: PackInstallView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-014'],
});
// 하위 on/off = IF-OP-036, status = IF-OP-035
export const CliAutostartRoute = defineRoute({
  id: 'gateway.cli.autostart',
  ifId: 'IF-GW-192',
  method: 'POST',
  path: '/api/v1/cli/autostart',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: CliAutostartBody },
  response: { 200: AutostartView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-024'],
});
// 하위 upgrade = IF-OP-030, rollback = IF-OP-031
export const CliUpgradeRoute = defineRoute({
  id: 'gateway.cli.upgrade',
  ifId: 'IF-GW-193',
  method: 'POST',
  path: '/api/v1/cli/upgrade',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: CliUpgradeBody },
  response: { 202: Operation },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-007', 'CR-17'],
});
// 하위 = IF-OP-003
export const CliOperationRoute = defineRoute({
  id: 'gateway.cli.operation',
  ifId: 'IF-GW-194',
  method: 'GET',
  path: '/api/v1/cli/operations/{op_id}',
  allowedCallers: ['cli'],
  idempotent: false,
  paginated: false,
  request: { params: S({ op_id: Ulid }) },
  response: { 200: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-015'],
});
// 하위 = IF-CT-021
export const CliBlueprintImportRoute = defineRoute({
  id: 'gateway.cli.blueprint_import',
  ifId: 'IF-GW-195',
  method: 'POST',
  path: '/api/v1/cli/blueprints',
  allowedCallers: ['cli'],
  idempotent: true,
  paginated: false,
  request: { body: ImportBlueprintBody },
  response: { 201: BlueprintView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-CUR-024', 'AQ-13'],
});
export const GW_CLI_ROUTES = [
  CliBootstrapTokenRoute,
  CliStatusRoute,
  CliShutdownRoute,
  CliDoctorRoute,
  CliRotateSessionKeyRoute,
  CliBackupRoute,
  CliRestoreRoute,
  CliExportRoute,
  CliImportRoute,
  CliCaptureRoute,
  CliPacksRoute,
  CliPacksActionRoute,
  CliPackInstallRoute,
  CliAutostartRoute,
  CliUpgradeRoute,
  CliOperationRoute,
  CliBlueprintImportRoute,
] as const;
