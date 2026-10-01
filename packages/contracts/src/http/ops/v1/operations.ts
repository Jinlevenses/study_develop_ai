import { z } from 'zod';
import { SemVer, ServiceName, Sha256Hex, Ulid } from '../../../common/ids.js';
import { Cursor } from '../../../common/pagination.js';
import { Problem } from '../../../common/problem.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';
import { GoldImportResult } from '../../ai-gateway/v1/calibration.js';
import { OverlayImportResult } from '../../content/v1/overlays.js';

export const OperationKind = z.enum(['backup', 'restore', 'rehearsal', 'export', 'import', 'doctor', 'upgrade', 'rollback', 'shutdown', 'service_restart']);
export type OperationKind = z.infer<typeof OperationKind>;
export const OperationResult = z.discriminatedUnion('kind', [
  S({ kind: z.literal('backup'), epoch_id: Ulid, backup_kind: z.enum(['snapshot', 'incremental']), outcome: z.enum(['ok', 'aborted', 'failed']),
      reason: z.string().max(200).nullable(), bytes: z.number().int(), manifest_sha256: Sha256Hex.nullable() }),
  S({ kind: z.literal('restore'), epoch_id: Ulid, projection_match: z.boolean().nullable(), incrementals_applied: z.number().int(), rto_ms: DurationMs }),
  S({ kind: z.literal('rehearsal'), epoch_id: Ulid, checksums_ok: z.boolean(), row_counts_ok: z.boolean(), projection_match: z.boolean().nullable() }),
  S({ kind: z.literal('export'), checkpoint_id: Ulid, files: z.array(S({ path: z.string().max(1024), sha256: Sha256Hex, bytes: z.number().int() })).max(20) }),
  S({ kind: z.literal('import'), ledger: S({ import_id: Ulid, inserted: z.number().int(), skipped_duplicates: z.number().int(), violations: z.number().int() }),
      overlays: OverlayImportResult.nullable(), gold: GoldImportResult.nullable(), held_file: z.string().max(1024).nullable() }),
  S({ kind: z.literal('doctor'), report_id: Ulid, fail: z.number().int(), warn: z.number().int(), fixed: z.number().int() }),
  S({ kind: z.literal('upgrade'), from_version: SemVer, to_version: SemVer, pre_epoch_id: Ulid, rolled_back: z.boolean() }),
  S({ kind: z.literal('rollback'), to_version: SemVer, restored_epoch_id: Ulid, held_events: z.number().int() }),
  S({ kind: z.literal('shutdown') }),
  S({ kind: z.literal('service_restart'), svc: ServiceName, pid: z.number().int().nullable() }),
]);
export type OperationResult = z.infer<typeof OperationResult>;
export const Operation = S({
  op_id: Ulid, kind: OperationKind, state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  progress: S({ step: z.string().max(60), pct: z.number().min(0).max(100).nullable() }), correlation_id: Ulid,
  started_at: EpochMs, finished_at: EpochMs.nullable(), result: OperationResult.nullable(), problem: Problem.nullable(),
});
export type Operation = z.infer<typeof Operation>;
export const OperationListQuery = S({ kind: OperationKind.optional(), state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
  cursor: Cursor.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export type OperationListQuery = z.infer<typeof OperationListQuery>;
