import { z } from 'zod';
import { AiMode, ProviderStatus, ServiceState } from '../../../common/domain.js';
import { ProviderId, SemVer, ServiceName, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';

export const BannerCode = z.enum([
  'service_degraded',
  'service_restarting',
  'ai_offline',
  'ai_budget_80',
  'ai_budget_100',
  'ai_quota',
  'ai_drift',
  'backup_failed',
  'backup_aborted',
  'secondary_missing',
  'secondary_locked',
  'rpo_exceeded',
  'outbox_lag',
  'inbox_dead',
  'ledger_halt',
  'ledger_integrity',
  'projection_mismatch',
  'integrity_check_failed',
  'runner_platform_disabled',
  'policy_lock_mismatch',
  'prompt_lock_mismatch',
  'disk_low',
  'data_path_risk',
  'node_eol',
  'job_failed',
  'slo_violation',
  'tripwire',
  'maintenance',
]);
export type BannerCode = z.infer<typeof BannerCode>;
export const Banner = S({
  banner_id: Ulid,
  code: BannerCode,
  severity: z.enum(['info', 'warn', 'critical']),
  message_ko: z.string().max(300),
  since: EpochMs,
  dismissible: z.boolean(),
  action: S({
    label_ko: z.string().max(40),
    href: z.string().max(200).nullable(),
    cli: z.string().max(120).nullable(),
  }).nullable(),
});
export type Banner = z.infer<typeof Banner>;
export const HealthBoard = S({
  generated_at: EpochMs,
  overall: z.enum(['ok', 'degraded', 'down']),
  app_version: SemVer,
  services: z
    .array(
      S({
        svc: z.union([ServiceName, z.literal('supervisor')]),
        state: ServiceState,
        pid: z.number().int().nullable(),
        port: z.number().int().nullable(),
        restarts_60s: z.number().int().min(0),
        started_at: EpochMs.nullable(),
        degraded_reason: z.string().max(120).nullable(),
      }),
    )
    .max(8),
  ai: S({ mode: AiMode, providers: z.array(S({ id: ProviderId, status: ProviderStatus })).max(32) }),
  backup: S({
    last_ok_at: EpochMs.nullable(),
    rpo_hours: z.number().nullable(),
    secondary_configured: z.boolean(),
    last_outcome: z.enum(['ok', 'aborted', 'failed']).nullable(),
  }),
  outbox: z
    .array(S({ svc: ServiceName, dest: ServiceName, pending: z.number().int(), oldest_age_ms: DurationMs }))
    .max(20),
  inbox: S({
    dead_total: z.number().int(),
    halted: z.array(S({ svc: ServiceName, producer: ServiceName, since: EpochMs })).max(10),
  }),
  runner: S({ enabled: z.boolean(), queue_length: z.number().int(), platform_reason: z.string().max(60).nullable() }),
  eventloop_p99_ms: z.record(ServiceName, z.number()),
  rss_mb: z.record(z.string(), z.number()),
  disk: S({ free_mb: z.number(), warn: z.boolean() }),
  integrity: S({
    ledger_alarm: z.boolean(),
    projection_match: z.boolean().nullable(),
    last_full_check_at: EpochMs.nullable(),
  }),
  banners: z.array(Banner).max(20),
});
export type HealthBoard = z.infer<typeof HealthBoard>;
export const HealthBoardRoute = defineRoute({
  id: 'ops.health.board',
  ifId: 'IF-OP-001',
  method: 'GET',
  path: '/internal/v1/health-board',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: HealthBoard },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-001', 'FR-SET-002', 'FR-SET-017', 'NFR-AVL-005', 'NFR-AVL-006'],
});
export const BannersDismissRoute = defineRoute({
  id: 'ops.banners.dismiss',
  ifId: 'IF-OP-002',
  method: 'POST',
  path: '/internal/v1/banners/{banner_id}:dismiss',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ banner_id: Ulid }) },
  response: { 204: z.null() },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-017'],
});
export const OP_HEALTH_ROUTES = [HealthBoardRoute, BannersDismissRoute] as const;
