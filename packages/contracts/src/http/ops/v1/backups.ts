import { z } from 'zod';
import { EpochManifest } from '../../../admin/epoch-manifest.js';
import { SemVer, Sha256Hex, Ulid } from '../../../common/ids.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { Operation } from './operations.js';

export const RunBackupBody = S({
  op_id: Ulid,
  kind: z.enum(['snapshot', 'incremental']),
  reason: z.enum(['manual', 'scheduled', 'pre_migration', 'pre_doctor_fix', 'pre_upgrade']),
});
export type RunBackupBody = z.infer<typeof RunBackupBody>;
export const BackupSummary = S({
  epoch_id: Ulid,
  kind: z.enum(['snapshot', 'incremental']),
  created_at: EpochMs,
  outcome: z.enum(['ok', 'aborted', 'failed']),
  size_bytes: z.number().int(),
  app_version: SemVer,
  manifest_sha256: Sha256Hex.nullable(),
  rehearsal: S({ at: EpochMs, ok: z.boolean() }).nullable(),
  secondary: S({ copied_at: EpochMs.nullable(), encrypted: z.boolean() }),
});
export type BackupSummary = z.infer<typeof BackupSummary>;
export const BackupDetail = S({ summary: BackupSummary, manifest: EpochManifest.nullable() });
export type BackupDetail = z.infer<typeof BackupDetail>;
export const RestoreBody = S({
  op_id: Ulid,
  epoch: z.discriminatedUnion('kind', [S({ kind: z.literal('id'), epoch_id: Ulid }), S({ kind: z.literal('latest') })]),
  rehearse: z.boolean(),
  apply_incrementals: z.boolean(),
});
export type RestoreBody = z.infer<typeof RestoreBody>;
export const SecondaryTarget = S({
  path: z.string().max(1024).nullable(),
  encrypt: z.boolean(),
  locked: z.boolean(),
  last_copied_at: EpochMs.nullable(),
  lag_s: z.number().int().nullable(),
  warnings: z.array(z.enum(['inside_fathom_home', 'sync_folder', 'network_path', 'not_writable', 'missing'])).max(5),
});
export type SecondaryTarget = z.infer<typeof SecondaryTarget>;
export const PutSecondaryBody = S({
  path: z.string().min(1).max(1024).nullable(),
  encrypt: z.boolean(),
  passphrase: z.string().min(12).max(1024).nullable(),
}); // encrypt=true일 때만 — 저장하지 않음(메모리에서 키 유도, 재기동 후 잠김)
export type PutSecondaryBody = z.infer<typeof PutSecondaryBody>;
export const UnlockSecondaryBody = S({ passphrase: z.string().min(12).max(1024) });
export type UnlockSecondaryBody = z.infer<typeof UnlockSecondaryBody>;

// idem = op_id
export const BackupsRunRoute = defineRoute({
  id: 'ops.backups.run',
  ifId: 'IF-OP-010',
  method: 'POST',
  path: '/internal/v1/backups:run',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: RunBackupBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'NFR-DATA-012'],
});
export const BackupsListRoute = defineRoute({
  id: 'ops.backups.list',
  ifId: 'IF-OP-011',
  method: 'GET',
  path: '/internal/v1/backups',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { query: PageQuery },
  response: { 200: Page(BackupSummary) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'FR-SET-005'],
});
// idem = op_id
export const RestoresCreateRoute = defineRoute({
  id: 'ops.restores.create',
  ifId: 'IF-OP-012',
  method: 'POST',
  path: '/internal/v1/restores',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: RestoreBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-005', 'NFR-DATA-012'],
});
export const BackupsGetRoute = defineRoute({
  id: 'ops.backups.get',
  ifId: 'IF-OP-013',
  method: 'GET',
  path: '/internal/v1/backups/{epoch_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ epoch_id: Ulid }) },
  response: { 200: BackupDetail },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-005'],
});
export const BackupsSecondaryRoute = defineRoute({
  id: 'ops.backups.secondary',
  ifId: 'IF-OP-014',
  method: 'GET',
  path: '/internal/v1/backups/secondary',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SecondaryTarget },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'FR-SET-025'],
});
export const BackupsSecondaryPutRoute = defineRoute({
  id: 'ops.backups.secondary_put',
  ifId: 'IF-OP-015',
  method: 'PUT',
  path: '/internal/v1/backups/secondary',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PutSecondaryBody },
  response: { 200: SecondaryTarget },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'FR-SET-025', 'NFR-SEC-018'],
});
export const BackupsSecondaryUnlockRoute = defineRoute({
  id: 'ops.backups.secondary_unlock',
  ifId: 'IF-OP-016',
  method: 'POST',
  path: '/internal/v1/backups/secondary:unlock',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: UnlockSecondaryBody },
  response: { 200: SecondaryTarget },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-SEC-018'],
});
export const OP_BACKUPS_ROUTES = [
  BackupsRunRoute,
  BackupsListRoute,
  RestoresCreateRoute,
  BackupsGetRoute,
  BackupsSecondaryRoute,
  BackupsSecondaryPutRoute,
  BackupsSecondaryUnlockRoute,
] as const;
