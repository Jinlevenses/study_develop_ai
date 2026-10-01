import { z } from 'zod';
import { DeviceId, SemVer, ServiceName, Sha256Hex, Ulid } from '../common/ids.js';
import { defineRoute } from '../common/route.js';
import { S } from '../common/schema.js';
import { DurationMs, EpochMs } from '../common/time.js';
import { EventType } from '../events/envelope.js';

export const Healthz = S({
  ok: z.literal(true),
  svc: ServiceName,
  version: SemVer,
  boot_id: Ulid,
  uptime_ms: DurationMs,
});
export type Healthz = z.infer<typeof Healthz>;
export const Readyz = S({
  ready: z.boolean(),
  svc: ServiceName,
  checks: S({
    db: z.boolean(),
    schema: z.boolean(),
    policy: z.boolean(),
    peers: z.boolean(),
    integrity: z.enum(['ok', 'pending', 'failed']),
  }),
  reasons: z.array(z.string().max(200)).max(20), // 코드형 문자열: 'schema_mismatch:learning.ledger', 'policy_lock_mismatch:fsrs_params@v1'
});
export type Readyz = z.infer<typeof Readyz>;

export const QuiesceRequest = S({
  epoch_id: Ulid,
  ack_deadline_ms: z.number().int().min(100).max(10_000).default(2000),
});
export type QuiesceRequest = z.infer<typeof QuiesceRequest>;
export const QuiesceAck = S({ epoch_id: Ulid, quiesced_at: EpochMs, in_flight_drained: z.literal(true) });
export type QuiesceAck = z.infer<typeof QuiesceAck>;
export const SnapshotRequest = S({ epoch_id: Ulid, dir: z.string().min(1).max(1024) }); // 절대 경로, FATHOM_HOME/backups/snap/<epoch_id> 아래만(아니면 VAL-900)
export type SnapshotRequest = z.infer<typeof SnapshotRequest>;
export const ModuleSchemaVersions = z.record(z.string().regex(/^[a-z_][a-z0-9_-]{1,40}$/), z.number().int().min(0)); // {'_infra':1,'catalog':3}
export type ModuleSchemaVersions = z.infer<typeof ModuleSchemaVersions>;
export const LedgerHead = z.record(DeviceId, S({ seq: z.number().int().min(1), hash: Sha256Hex }));
export type LedgerHead = z.infer<typeof LedgerHead>;
export const SnapshotResult = S({
  epoch_id: Ulid,
  svc: ServiceName,
  files: z
    .array(
      S({
        file: z.enum(['content.db', 'learning.db', 'ai.db', 'ops.db']),
        sha256: Sha256Hex,
        bytes: z.number().int().min(0),
      }),
    )
    .min(1),
  schema: ModuleSchemaVersions,
  outbox_head_seq: z.number().int().min(0),
  delivery: z.record(ServiceName, z.number().int().min(0)), // durable 목적지별 last_acked_seq (사본에서 읽음)
  inbox_watermark: z.record(ServiceName, z.number().int().min(0)), // 생산자별 last_producer_seq (사본에서 읽음)
  // learning만:
  projection_hash: Sha256Hex.optional(),
  fsrs_impl: z.literal('ts-fsrs@5.4.2').optional(),
  ledger_head: LedgerHead.optional(),
  duration_ms: DurationMs,
});
export type SnapshotResult = z.infer<typeof SnapshotResult>;
export const ResumeRequest = S({ epoch_id: Ulid, outcome: z.enum(['completed', 'aborted']) });
export type ResumeRequest = z.infer<typeof ResumeRequest>;
export const ResumeAck = S({ epoch_id: Ulid, resumed_at: EpochMs });
export type ResumeAck = z.infer<typeof ResumeAck>;
export const ShutdownRequest = S({ grace_ms: z.number().int().min(0).max(10_000).default(3000) });
export type ShutdownRequest = z.infer<typeof ShutdownRequest>;
export const ShutdownAck = S({ accepted_at: EpochMs, grace_ms: z.number().int() });
export type ShutdownAck = z.infer<typeof ShutdownAck>;
export const AdminEventsQuery = S({ correlation_id: Ulid });
export type AdminEventsQuery = z.infer<typeof AdminEventsQuery>;
export const AdminEventsView = S({
  svc: ServiceName,
  outbox: z
    .array(
      S({
        seq: z.number().int(),
        event_id: Ulid,
        type: EventType,
        occurred_at: EpochMs,
        causation_id: Ulid.nullable(),
        delivered: z.record(ServiceName, z.boolean()),
      }),
    )
    .max(500),
  inbox: z
    .array(
      S({
        event_id: Ulid,
        producer: ServiceName,
        producer_seq: z.number().int(),
        type: EventType,
        received_at: EpochMs,
      }),
    )
    .max(500),
  dead: z
    .array(
      S({
        event_id: Ulid,
        producer: ServiceName,
        type: EventType,
        error_code: z.string(),
        failed_at: EpochMs,
        resolution: z.enum(['replayed', 'discarded']).nullable(),
      }),
    )
    .max(100),
});
export type AdminEventsView = z.infer<typeof AdminEventsView>;
export const IntegrityRequest = S({ level: z.enum(['quick', 'full']) });
export type IntegrityRequest = z.infer<typeof IntegrityRequest>;
export const IntegrityResult = S({
  svc: ServiceName,
  level: z.enum(['quick', 'full']),
  ok: z.boolean(),
  files: z.array(
    S({
      file: z.string(),
      check: z.union([z.literal('ok'), z.array(z.string().max(300)).max(100)]),
      foreign_key_violations: z.number().int().min(0),
    }),
  ),
  checked_at: EpochMs,
  duration_ms: DurationMs,
});
export type IntegrityResult = z.infer<typeof IntegrityResult>;

// ---------------------------------------------------------------------------------------------------------------------
// IF-COM 라우트 정의(IF-01 §3.1 표 전사 — createService()·계약 하네스 C1이 import한다). 공통: paginated false, fr [].
// InboxDeliverRoute(IF-COM-004)는 events/inbox.ts에 있다.
// ---------------------------------------------------------------------------------------------------------------------

// ※ 무인증(IF §2.11 예외 경로) — createService가 경로(/healthz·/readyz)로 예외 처리한다. allowedCallers는 비어 있다.
export const HealthLiveRoute = defineRoute({
  id: 'common.health.live',
  ifId: 'IF-COM-001',
  method: 'GET',
  path: '/healthz',
  allowedCallers: [],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: Healthz },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
// ※ 무인증(IF §2.11 예외 경로) — createService가 경로로 예외 처리한다. 503도 Problem이 아니라 Readyz 본문(프로브 호환).
export const HealthReadyRoute = defineRoute({
  id: 'common.health.ready',
  ifId: 'IF-COM-002',
  method: 'GET',
  path: '/readyz',
  allowedCallers: [],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: Readyz, 503: Readyz },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
export const MetricsGetRoute = defineRoute({
  id: 'common.metrics.get',
  ifId: 'IF-COM-003',
  method: 'GET',
  path: '/internal/v1/metrics',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: z.string() },
  responseKind: 'text',
  freeze: 'D',
  slice: 'R1',
  fr: [],
});
export const AdminQuiesceRoute = defineRoute({
  id: 'common.admin.quiesce',
  ifId: 'IF-COM-005',
  method: 'POST',
  path: '/internal/v1/admin/quiesce',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: QuiesceRequest },
  response: { 200: QuiesceAck },
  freeze: 'D',
  slice: 'R1',
  fr: [],
});
export const AdminSnapshotRoute = defineRoute({
  id: 'common.admin.snapshot',
  ifId: 'IF-COM-006',
  method: 'POST',
  path: '/internal/v1/admin/snapshot',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: SnapshotRequest },
  response: { 200: SnapshotResult },
  deadlineMs: 30000,
  freeze: 'D',
  slice: 'R1',
  fr: [],
});
export const AdminResumeRoute = defineRoute({
  id: 'common.admin.resume',
  ifId: 'IF-COM-007',
  method: 'POST',
  path: '/internal/v1/admin/resume',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: ResumeRequest },
  response: { 200: ResumeAck },
  freeze: 'D',
  slice: 'R1',
  fr: [],
});
export const AdminShutdownRoute = defineRoute({
  id: 'common.admin.shutdown',
  ifId: 'IF-COM-008',
  method: 'POST',
  path: '/internal/v1/admin/shutdown',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: ShutdownRequest },
  response: { 202: ShutdownAck },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
export const AdminEventsRoute = defineRoute({
  id: 'common.admin.events',
  ifId: 'IF-COM-009',
  method: 'GET',
  path: '/internal/v1/admin/events',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: { query: AdminEventsQuery },
  response: { 200: AdminEventsView },
  freeze: 'D',
  slice: 'R1',
  fr: [],
});
export const AdminIntegrityRoute = defineRoute({
  id: 'common.admin.integrity',
  ifId: 'IF-COM-010',
  method: 'POST',
  path: '/internal/v1/admin/integrity',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: IntegrityRequest },
  response: { 200: IntegrityResult },
  deadlineMs: 120000,
  freeze: 'D',
  slice: 'R1',
  fr: [],
});
export const COMMON_ADMIN_ROUTES = [
  HealthLiveRoute,
  HealthReadyRoute,
  MetricsGetRoute,
  AdminQuiesceRoute,
  AdminSnapshotRoute,
  AdminResumeRoute,
  AdminShutdownRoute,
  AdminEventsRoute,
  AdminIntegrityRoute,
] as const;
