import { z } from 'zod';
import { LedgerHead } from '../../../admin/admin-routes.js';
import { DeviceId, PolicyRef, PolicySetId, SemVer, Sha256Hex, Ulid } from '../../../common/ids.js';
import { NdjsonEnd } from '../../../common/ndjson.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';
import { LedgerEventEnvelope, LedgerEventType } from '../../../ledger/envelope.js';

export const LedgerExportQuery = S({ since: Ulid.optional(), device_id: DeviceId.optional() }); // since = checkpoint_id, 없으면 전체
export type LedgerExportQuery = z.infer<typeof LedgerExportQuery>;
export const LedgerExportHeader = S({
  kind: z.literal('header'),
  v: z.literal(1),
  exporting_device_id: DeviceId,
  generated_at: EpochMs,
  app_version: SemVer,
  since_checkpoint_id: Ulid.nullable(),
  devices: z.record(DeviceId, S({ seq: z.number().int().min(1), head_hash: Sha256Hex })), // 체인 헤드 앵커(CR-27)
  schema_versions: z.record(LedgerEventType, z.number().int().min(1)),
});
export type LedgerExportHeader = z.infer<typeof LedgerExportHeader>;
export const LedgerExportPolicySet = S({
  // 이벤트가 참조하는 정책 세트 원문(다른 기기 리플레이용, §15 D-14)
  kind: z.literal('policy_set'),
  policy_version: PolicySetId,
  members: z.record(z.string(), S({ version: PolicyRef, sha256: Sha256Hex })),
  documents: z.record(PolicyRef, S({ sha256: Sha256Hex, yaml: z.string().max(1_000_000) })),
});
export type LedgerExportPolicySet = z.infer<typeof LedgerExportPolicySet>;
export const LedgerExportEvent = S({ kind: z.literal('event'), event: LedgerEventEnvelope }); // = IF-LG §10.1
export type LedgerExportEvent = z.infer<typeof LedgerExportEvent>;
export const LedgerExportLine = z.discriminatedUnion('kind', [
  LedgerExportHeader,
  LedgerExportPolicySet,
  LedgerExportEvent,
  NdjsonEnd,
]);
export type LedgerExportLine = z.infer<typeof LedgerExportLine>;
// 줄 순서: header → policy_set* → event*(ORDER BY client_ts, device_id, device_seq) → end
export const LedgerImportQuery = S({ import_id: Ulid, mode: z.literal('merge') });
export type LedgerImportQuery = z.infer<typeof LedgerImportQuery>;
export const LedgerViolation = S({
  device_id: DeviceId.nullable(),
  device_seq: z.number().int().nullable(),
  kind: z.enum([
    'chain_break',
    'anchor_mismatch',
    'tail_truncated',
    'schema_version_unknown',
    'policy_set_missing',
    'end_line_missing',
    'sha256_mismatch',
    'event_invalid',
  ]),
  detail: z.string().max(300),
});
export type LedgerViolation = z.infer<typeof LedgerViolation>;
export const LedgerImportView = S({
  import_id: Ulid,
  state: z.enum(['receiving', 'verifying', 'inserting', 'replaying', 'swapping', 'done', 'rejected', 'failed']),
  received_lines: z.number().int().min(0),
  inserted: z.number().int().min(0),
  skipped_duplicates: z.number().int().min(0),
  devices: z.record(DeviceId, S({ seq: z.number().int(), head_hash: Sha256Hex })),
  checkpoint_id: Ulid.nullable(),
  projection_hash: Sha256Hex.nullable(),
  violations: z.array(LedgerViolation).max(100),
  started_at: EpochMs,
  finished_at: EpochMs.nullable(),
});
export type LedgerImportView = z.infer<typeof LedgerImportView>;
export const CreateCheckpointBody = S({ checkpoint_id: Ulid, reason: z.enum(['export', 'merge', 'manual']) });
export type CreateCheckpointBody = z.infer<typeof CreateCheckpointBody>;
export const CheckpointView = S({
  checkpoint_id: Ulid,
  devices: z.record(DeviceId, S({ seq: z.number().int(), head_hash: Sha256Hex })),
  root_hash: Sha256Hex,
  source_file_sha256: Sha256Hex.nullable(),
  created_at: EpochMs,
});
export type CheckpointView = z.infer<typeof CheckpointView>;
export const LedgerHeads = S({
  local_device_id: DeviceId,
  event_count: z.number().int().min(0),
  devices: z.record(DeviceId, S({ seq: z.number().int(), head_hash: Sha256Hex, last_client_ts: EpochMs })),
});
export type LedgerHeads = z.infer<typeof LedgerHeads>;
export const VerifyLedgerBody = S({
  verify_id: Ulid,
  replay: z.boolean(),
  anchors: z
    .array(S({ source: z.enum(['epoch', 'checkpoint', 'export_header']), ref: z.string().max(200), heads: LedgerHead }))
    .max(20),
});
export type VerifyLedgerBody = z.infer<typeof VerifyLedgerBody>;
export const VerifyLedgerView = S({
  verify_id: Ulid,
  state: z.enum(['running', 'done', 'failed']),
  chain_ok: z.boolean().nullable(),
  anchors: z.array(
    S({
      source: z.enum(['epoch', 'checkpoint', 'export_header']),
      ref: z.string(),
      ok: z.boolean(),
      mismatches: z
        .array(S({ device_id: DeviceId, expected_seq: z.number().int(), actual_seq: z.number().int().nullable() }))
        .max(20),
    }),
  ),
  projection_hash_live: Sha256Hex.nullable(),
  projection_hash_replay: Sha256Hex.nullable(),
  match: z.boolean().nullable(),
  duration_ms: DurationMs.nullable(),
});
export type VerifyLedgerView = z.infer<typeof VerifyLedgerView>;
// 스트림(무제한, 유휴 30s) — deadlineMs 생략(E4)
export const LedgerExportRoute = defineRoute({
  id: 'learning.ledger.export',
  ifId: 'IF-LR-080',
  method: 'GET',
  path: '/internal/v1/ledger/export',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: { query: LedgerExportQuery },
  response: { 200: LedgerExportLine },
  responseKind: 'ndjson',
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-004', 'FR-SET-006', 'FR-SET-022', 'FR-PRG-003', 'CR-27'],
});
// idem = import_id
// 본문 스트림 — deadlineMs 생략(E4)
export const LedgerImportRoute = defineRoute({
  id: 'learning.ledger.import',
  ifId: 'IF-LR-081',
  method: 'POST',
  path: '/internal/v1/ledger/imports',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { query: LedgerImportQuery, body: LedgerExportLine, bodyKind: 'ndjson' },
  response: { 202: LedgerImportView },
  bodyLimitBytes: 8_589_934_592,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-022', 'FR-PRG-003', 'NFR-DATA-011'],
});
export const LedgerImportGetRoute = defineRoute({
  id: 'learning.ledger.import_get',
  ifId: 'IF-LR-082',
  method: 'GET',
  path: '/internal/v1/ledger/imports/{import_id}',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: { params: S({ import_id: Ulid }) },
  response: { 200: LedgerImportView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-022'],
});
// idem = checkpoint_id
export const LedgerCheckpointCreateRoute = defineRoute({
  id: 'learning.ledger.checkpoint_create',
  ifId: 'IF-LR-083',
  method: 'POST',
  path: '/internal/v1/ledger/checkpoints',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: CreateCheckpointBody },
  response: { 201: CheckpointView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-003', 'FR-SET-022'],
});
export const LedgerCheckpointsRoute = defineRoute({
  id: 'learning.ledger.checkpoints',
  ifId: 'IF-LR-084',
  method: 'GET',
  path: '/internal/v1/ledger/checkpoints',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: true,
  request: { query: PageQuery },
  response: { 200: Page(CheckpointView) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-022'],
});
export const LedgerHeadsRoute = defineRoute({
  id: 'learning.ledger.heads',
  ifId: 'IF-LR-085',
  method: 'GET',
  path: '/internal/v1/ledger/heads',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: LedgerHeads },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-003', 'CR-27'],
});
// idem = verify_id
export const LedgerVerifyRoute = defineRoute({
  id: 'learning.ledger.verify',
  ifId: 'IF-LR-086',
  method: 'POST',
  path: '/internal/v1/ledger/verify',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: VerifyLedgerBody },
  response: { 202: VerifyLedgerView },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-DATA-002', 'NFR-DATA-013', 'FR-SET-003', 'CR-27'],
});
export const LedgerVerifyGetRoute = defineRoute({
  id: 'learning.ledger.verify_get',
  ifId: 'IF-LR-087',
  method: 'GET',
  path: '/internal/v1/ledger/verify/{verify_id}',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: { params: S({ verify_id: Ulid }) },
  response: { 200: VerifyLedgerView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-003'],
});
export const LR_LEDGER_ROUTES = [
  LedgerExportRoute,
  LedgerImportRoute,
  LedgerImportGetRoute,
  LedgerCheckpointCreateRoute,
  LedgerCheckpointsRoute,
  LedgerHeadsRoute,
  LedgerVerifyRoute,
  LedgerVerifyGetRoute,
] as const;
