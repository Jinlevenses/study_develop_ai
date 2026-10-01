import { z } from 'zod';
import { EpochManifest } from '../../../admin/epoch-manifest.js';
import { SemVer, Sha256Hex, Ulid } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const RunBackupBody = S({ op_id: Ulid, kind: z.enum(['snapshot', 'incremental']),
  reason: z.enum(['manual', 'scheduled', 'pre_migration', 'pre_doctor_fix', 'pre_upgrade']) });
export type RunBackupBody = z.infer<typeof RunBackupBody>;
export const BackupSummary = S({ epoch_id: Ulid, kind: z.enum(['snapshot', 'incremental']), created_at: EpochMs, outcome: z.enum(['ok', 'aborted', 'failed']),
  size_bytes: z.number().int(), app_version: SemVer, manifest_sha256: Sha256Hex.nullable(),
  rehearsal: S({ at: EpochMs, ok: z.boolean() }).nullable(), secondary: S({ copied_at: EpochMs.nullable(), encrypted: z.boolean() }) });
export type BackupSummary = z.infer<typeof BackupSummary>;
export const BackupDetail = S({ summary: BackupSummary, manifest: EpochManifest.nullable() });
export type BackupDetail = z.infer<typeof BackupDetail>;
export const RestoreBody = S({ op_id: Ulid, epoch: z.discriminatedUnion('kind', [S({ kind: z.literal('id'), epoch_id: Ulid }), S({ kind: z.literal('latest') })]),
  rehearse: z.boolean(), apply_incrementals: z.boolean() });
export type RestoreBody = z.infer<typeof RestoreBody>;
export const SecondaryTarget = S({ path: z.string().max(1024).nullable(), encrypt: z.boolean(), locked: z.boolean(),
  last_copied_at: EpochMs.nullable(), lag_s: z.number().int().nullable(),
  warnings: z.array(z.enum(['inside_fathom_home', 'sync_folder', 'network_path', 'not_writable', 'missing'])).max(5) });
export type SecondaryTarget = z.infer<typeof SecondaryTarget>;
export const PutSecondaryBody = S({ path: z.string().min(1).max(1024).nullable(), encrypt: z.boolean(),
  passphrase: z.string().min(12).max(1024).nullable() });          // encrypt=true일 때만 — 저장하지 않음(메모리에서 키 유도, 재기동 후 잠김)
export type PutSecondaryBody = z.infer<typeof PutSecondaryBody>;
export const UnlockSecondaryBody = S({ passphrase: z.string().min(12).max(1024) });
export type UnlockSecondaryBody = z.infer<typeof UnlockSecondaryBody>;
