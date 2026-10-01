import { z } from 'zod';
import { DeviceId, PackId, SemVer, ServiceName, Sha256Hex, Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';
import { LedgerHead, ModuleSchemaVersions } from './admin-routes.js';

// ADR-013 §1 — 상세 동결
export const ServiceSnapshot = S({
  file: z.enum(['content.db', 'learning.db', 'ai.db', 'ops.db']),
  sha256: Sha256Hex,
  bytes: z.number().int().min(0),
  schema: ModuleSchemaVersions,
  outbox_head_seq: z.number().int().min(0),
  delivery: z.record(ServiceName, z.number().int().min(0)),
  inbox_watermark: z.record(ServiceName, z.number().int().min(0)),
  projection_hash: Sha256Hex.optional(),
  fsrs_impl: z.literal('ts-fsrs@5.4.2').optional(),
  ledger_head: LedgerHead.optional(), // learning만
});
export type ServiceSnapshot = z.infer<typeof ServiceSnapshot>;
export const EpochManifest = S({
  v: z.literal(1),
  epoch_id: Ulid,
  kind: z.literal('snapshot'),
  created_at: EpochMs,
  app_version: SemVer,
  contracts_hash: Sha256Hex,
  device_id: DeviceId,
  policy_lock_sha256: Sha256Hex,
  prompts_lock_sha256: Sha256Hex,
  packs: z.array(S({ pack_id: PackId, version: SemVer, manifest_hash: Sha256Hex })).max(50),
  services: S({
    content: ServiceSnapshot,
    learning: ServiceSnapshot,
    'ai-gateway': ServiceSnapshot,
    'ops-api': ServiceSnapshot,
  }),
  excluded: z.array(z.enum(['insight.db', 'ai-cache.db', 'secrets/ai-keys.enc'])),
});
export type EpochManifest = z.infer<typeof EpochManifest>;
