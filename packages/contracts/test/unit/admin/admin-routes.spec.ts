import { describe, expect, it } from 'vitest';
import {
  AdminEventsQuery,
  AdminEventsRoute,
  AdminEventsView,
  AdminIntegrityRoute,
  AdminQuiesceRoute,
  AdminResumeRoute,
  AdminShutdownRoute,
  AdminSnapshotRoute,
  COMMON_ADMIN_ROUTES,
  HealthLiveRoute,
  HealthReadyRoute,
  Healthz,
  IntegrityRequest,
  IntegrityResult,
  LedgerHead,
  MetricsGetRoute,
  ModuleSchemaVersions,
  QuiesceAck,
  QuiesceRequest,
  Readyz,
  ResumeAck,
  ResumeRequest,
  ShutdownAck,
  ShutdownRequest,
  SnapshotRequest,
  SnapshotResult,
} from '../../../src/admin/admin-routes.js';
import { InboxDeliverRoute } from '../../../src/events/inbox.js';

const ULID_A = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';
const ULID_B = '01J0A1B2C3D4E5F6G7H8J9K0M1';
const SHA = 'a'.repeat(64);

const snapshotResult = (over: Record<string, unknown> = {}) => ({
  epoch_id: ULID_A,
  svc: 'content',
  files: [{ file: 'content.db', sha256: SHA, bytes: 4096 }],
  schema: { _infra: 1, catalog: 3 },
  outbox_head_seq: 10,
  delivery: { gateway: 0, content: 0, learning: 7, 'ai-gateway': 0, 'ops-api': 0 },
  inbox_watermark: { gateway: 0, content: 0, learning: 0, 'ai-gateway': 2, 'ops-api': 0 },
  duration_ms: 120,
  ...over,
});

describe('admin/admin-routes 스키마', () => {
  it('UT-CON-040 Healthz.ok는 literal true이고 Readyz checks는 5항목이다 [NFR-DATA-012][IF-COM-001~002]', () => {
    const ok = { ok: true, svc: 'learning', version: '0.1.0', boot_id: ULID_A, uptime_ms: 5 };
    expect(Healthz.safeParse(ok).success).toBe(true);
    expect(Healthz.safeParse({ ...ok, ok: false }).success).toBe(false);
    expect(Healthz.safeParse({ ...ok, svc: 'cli' }).success).toBe(false);
    expect(Healthz.safeParse({ ...ok, extra: 1 }).success).toBe(false);

    const ready = {
      ready: false,
      svc: 'learning',
      checks: { db: true, schema: false, policy: true, peers: true, integrity: 'pending' },
      reasons: ['schema_mismatch:learning.ledger'],
    };
    expect(Readyz.safeParse(ready).success).toBe(true);
    expect(Readyz.safeParse({ ...ready, checks: { ...ready.checks, integrity: 'done' } }).success).toBe(false);
    expect(Readyz.safeParse({ ...ready, checks: { db: true } }).success).toBe(false);
    expect(Readyz.safeParse({ ...ready, reasons: Array(21).fill('r') }).success).toBe(false);
  });

  it('UT-CON-041 Quiesce·Resume·Shutdown 요청/응답 기본값과 경계 [NFR-DATA-012][IF-COM-005~008]', () => {
    expect(QuiesceRequest.parse({ epoch_id: ULID_A }).ack_deadline_ms).toBe(2000);
    expect(QuiesceRequest.safeParse({ epoch_id: ULID_A, ack_deadline_ms: 99 }).success).toBe(false);
    expect(QuiesceRequest.safeParse({ epoch_id: ULID_A, ack_deadline_ms: 10_001 }).success).toBe(false);
    expect(QuiesceAck.safeParse({ epoch_id: ULID_A, quiesced_at: 1, in_flight_drained: true }).success).toBe(true);
    expect(QuiesceAck.safeParse({ epoch_id: ULID_A, quiesced_at: 1, in_flight_drained: false }).success).toBe(false);
    expect(ResumeRequest.safeParse({ epoch_id: ULID_A, outcome: 'completed' }).success).toBe(true);
    expect(ResumeRequest.safeParse({ epoch_id: ULID_A, outcome: 'failed' }).success).toBe(false);
    expect(ResumeAck.safeParse({ epoch_id: ULID_A, resumed_at: 1 }).success).toBe(true);
    expect(ShutdownRequest.parse({}).grace_ms).toBe(3000);
    expect(ShutdownRequest.safeParse({ grace_ms: 10_001 }).success).toBe(false);
    expect(ShutdownAck.safeParse({ accepted_at: 1, grace_ms: 3000 }).success).toBe(true);
    expect(SnapshotRequest.safeParse({ epoch_id: ULID_A, dir: '' }).success).toBe(false);
    expect(SnapshotRequest.safeParse({ epoch_id: ULID_A, dir: '/home/x/backups/snap/e' }).success).toBe(true);
  });

  it('UT-CON-042 SnapshotResult는 learning 선택 필드와 fsrs_impl literal을 갖는다 [NFR-DATA-012][IF-COM-006]', () => {
    expect(SnapshotResult.safeParse(snapshotResult()).success).toBe(true);
    const learning = snapshotResult({
      svc: 'learning',
      projection_hash: SHA,
      fsrs_impl: 'ts-fsrs@5.4.2',
      ledger_head: { [ULID_A]: { seq: 3, hash: SHA } },
    });
    expect(SnapshotResult.safeParse(learning).success).toBe(true);
    expect(SnapshotResult.safeParse({ ...learning, fsrs_impl: 'ts-fsrs@5.4.3' }).success).toBe(false);
    expect(SnapshotResult.safeParse(snapshotResult({ files: [] })).success).toBe(false);
    expect(
      SnapshotResult.safeParse(snapshotResult({ files: [{ file: 'insight.db', sha256: SHA, bytes: 1 }] })).success,
    ).toBe(false);
    expect(SnapshotResult.safeParse(snapshotResult({ extra: 1 })).success).toBe(false);
  });

  it('UT-CON-043 ModuleSchemaVersions·LedgerHead는 키 정규식 record다(비전수) [NFR-DATA-012]', () => {
    expect(ModuleSchemaVersions.safeParse({ _infra: 1, catalog: 3 }).success).toBe(true);
    expect(ModuleSchemaVersions.safeParse({}).success).toBe(true);
    expect(ModuleSchemaVersions.safeParse({ Catalog: 1 }).success).toBe(false);
    expect(ModuleSchemaVersions.safeParse({ catalog: -1 }).success).toBe(false);
    expect(LedgerHead.safeParse({}).success).toBe(true);
    expect(LedgerHead.safeParse({ [ULID_A]: { seq: 1, hash: SHA } }).success).toBe(true);
    expect(LedgerHead.safeParse({ [ULID_A]: { seq: 0, hash: SHA } }).success).toBe(false);
    expect(LedgerHead.safeParse({ 'device-1': { seq: 1, hash: SHA } }).success).toBe(false);
  });

  it('UT-CON-044 AdminEventsView·Query 모양과 한도 [NFR-DATA-012][IF-COM-009]', () => {
    expect(AdminEventsQuery.safeParse({ correlation_id: ULID_A }).success).toBe(true);
    expect(AdminEventsQuery.safeParse({}).success).toBe(false);
    const delivered = { gateway: true, content: false, learning: true, 'ai-gateway': false, 'ops-api': false };
    const view = {
      svc: 'learning',
      outbox: [
        { seq: 1, event_id: ULID_A, type: 'learning.session.completed', occurred_at: 1, causation_id: null, delivered },
      ],
      inbox: [
        { event_id: ULID_B, producer: 'content', producer_seq: 4, type: 'grading.verdict.issued', received_at: 2 },
      ],
      dead: [
        {
          event_id: ULID_B,
          producer: 'content',
          type: 'grading.verdict.issued',
          error_code: 'X',
          failed_at: 3,
          resolution: null,
        },
      ],
    };
    expect(AdminEventsView.safeParse(view).success).toBe(true);
    expect(AdminEventsView.safeParse({ ...view, outbox: [{ ...view.outbox[0], type: 'BadType' }] }).success).toBe(
      false,
    );
    expect(AdminEventsView.safeParse({ ...view, dead: [{ ...view.dead[0], resolution: 'ignored' }] }).success).toBe(
      false,
    );
    expect(AdminEventsView.safeParse({ ...view, outbox: Array(501).fill(view.outbox[0]) }).success).toBe(false);
  });

  it('UT-CON-045 IntegrityRequest·IntegrityResult check는 "ok" 또는 문자열 배열이다 [NFR-DATA-012][IF-COM-010]', () => {
    expect(IntegrityRequest.safeParse({ level: 'quick' }).success).toBe(true);
    expect(IntegrityRequest.safeParse({ level: 'deep' }).success).toBe(false);
    const res = {
      svc: 'content',
      level: 'full',
      ok: false,
      files: [
        { file: 'content.db', check: 'ok', foreign_key_violations: 0 },
        { file: 'content.db', check: ['row 1 missing from index'], foreign_key_violations: 2 },
      ],
      checked_at: 1,
      duration_ms: 10,
    };
    expect(IntegrityResult.safeParse(res).success).toBe(true);
    expect(
      IntegrityResult.safeParse({ ...res, files: [{ file: 'a', check: 'bad', foreign_key_violations: 0 }] }).success,
    ).toBe(false);
  });

  it('UT-CON-047 zod 4 exhaustive record — delivery에 키 4개면 거부, 5개면 통과 [NFR-DATA-012][IF-COM-006]', () => {
    const four = { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0 }; // ops-api 누락
    const five = { ...four, 'ops-api': 0 };
    expect(SnapshotResult.safeParse(snapshotResult({ delivery: four })).success).toBe(false);
    expect(SnapshotResult.safeParse(snapshotResult({ delivery: five })).success).toBe(true);
    expect(SnapshotResult.safeParse(snapshotResult({ inbox_watermark: four })).success).toBe(false);
    expect(SnapshotResult.safeParse(snapshotResult({ inbox_watermark: five })).success).toBe(true);
    expect(SnapshotResult.safeParse(snapshotResult({ delivery: { ...five, extra: 0 } })).success).toBe(false); // 6번째 키
    // AdminEventsView.outbox[].delivered도 전수 키다.
    const outbox = (delivered: Record<string, boolean>) => [
      { seq: 1, event_id: ULID_A, type: 'a.b.c', occurred_at: 1, causation_id: null, delivered },
    ];
    const f5 = { gateway: false, content: false, learning: false, 'ai-gateway': false, 'ops-api': false };
    expect(AdminEventsView.safeParse({ svc: 'content', outbox: outbox(f5), inbox: [], dead: [] }).success).toBe(true);
    expect(
      AdminEventsView.safeParse({ svc: 'content', outbox: outbox({ gateway: false }), inbox: [], dead: [] }).success,
    ).toBe(false);
  });
});

describe('admin IF-COM 라우트 정의', () => {
  const EXPECTED = [
    {
      name: 'HealthLiveRoute',
      route: HealthLiveRoute,
      ifId: 'IF-COM-001',
      method: 'GET',
      path: '/healthz',
      id: 'common.health.live',
      idem: false,
      deadline: undefined,
      slice: 'R0',
    },
    {
      name: 'HealthReadyRoute',
      route: HealthReadyRoute,
      ifId: 'IF-COM-002',
      method: 'GET',
      path: '/readyz',
      id: 'common.health.ready',
      idem: false,
      deadline: undefined,
      slice: 'R0',
    },
    {
      name: 'MetricsGetRoute',
      route: MetricsGetRoute,
      ifId: 'IF-COM-003',
      method: 'GET',
      path: '/internal/v1/metrics',
      id: 'common.metrics.get',
      idem: false,
      deadline: undefined,
      slice: 'R1',
    },
    {
      name: 'InboxDeliverRoute',
      route: InboxDeliverRoute,
      ifId: 'IF-COM-004',
      method: 'POST',
      path: '/internal/v1/inbox',
      id: 'common.inbox.deliver',
      idem: false,
      deadline: undefined,
      slice: 'R0',
    },
    {
      name: 'AdminQuiesceRoute',
      route: AdminQuiesceRoute,
      ifId: 'IF-COM-005',
      method: 'POST',
      path: '/internal/v1/admin/quiesce',
      id: 'common.admin.quiesce',
      idem: true,
      deadline: undefined,
      slice: 'R1',
    },
    {
      name: 'AdminSnapshotRoute',
      route: AdminSnapshotRoute,
      ifId: 'IF-COM-006',
      method: 'POST',
      path: '/internal/v1/admin/snapshot',
      id: 'common.admin.snapshot',
      idem: true,
      deadline: 30000,
      slice: 'R1',
    },
    {
      name: 'AdminResumeRoute',
      route: AdminResumeRoute,
      ifId: 'IF-COM-007',
      method: 'POST',
      path: '/internal/v1/admin/resume',
      id: 'common.admin.resume',
      idem: true,
      deadline: undefined,
      slice: 'R1',
    },
    {
      name: 'AdminShutdownRoute',
      route: AdminShutdownRoute,
      ifId: 'IF-COM-008',
      method: 'POST',
      path: '/internal/v1/admin/shutdown',
      id: 'common.admin.shutdown',
      idem: true,
      deadline: undefined,
      slice: 'R0',
    },
    {
      name: 'AdminEventsRoute',
      route: AdminEventsRoute,
      ifId: 'IF-COM-009',
      method: 'GET',
      path: '/internal/v1/admin/events',
      id: 'common.admin.events',
      idem: false,
      deadline: undefined,
      slice: 'R1',
    },
    {
      name: 'AdminIntegrityRoute',
      route: AdminIntegrityRoute,
      ifId: 'IF-COM-010',
      method: 'POST',
      path: '/internal/v1/admin/integrity',
      id: 'common.admin.integrity',
      idem: true,
      deadline: 120000,
      slice: 'R1',
    },
  ] as const;

  it('UT-CON-054 IF-COM 라우트 10개의 ifId·method·path·idempotent·deadlineMs가 표와 일치한다 [IF-COM-001~010][NFR-SEC-003]', () => {
    expect(EXPECTED).toHaveLength(10);
    for (const e of EXPECTED) {
      const r: {
        ifId: string;
        method: string;
        path: string;
        id: string;
        idempotent: boolean;
        deadlineMs?: number;
        paginated: boolean;
        freeze: string;
        slice: string;
        fr: readonly string[];
      } = e.route;
      expect(r.ifId, e.name).toBe(e.ifId);
      expect(r.method, e.name).toBe(e.method);
      expect(r.path, e.name).toBe(e.path);
      expect(r.id, e.name).toBe(e.id);
      expect(r.idempotent, e.name).toBe(e.idem);
      expect(r.deadlineMs, e.name).toBe(e.deadline);
      expect(r.paginated, e.name).toBe(false);
      expect(r.freeze, e.name).toBe('D');
      expect(r.slice, e.name).toBe(e.slice);
      expect(r.fr, e.name).toEqual([]);
    }
    // 호출자 ACL
    expect(HealthLiveRoute.allowedCallers).toEqual([]);
    expect(HealthReadyRoute.allowedCallers).toEqual([]);
    for (const r of [
      MetricsGetRoute,
      AdminQuiesceRoute,
      AdminSnapshotRoute,
      AdminResumeRoute,
      AdminShutdownRoute,
      AdminEventsRoute,
      AdminIntegrityRoute,
    ]) {
      expect(r.allowedCallers, r.id).toEqual(['ops-api']);
    }
    expect(InboxDeliverRoute.allowedCallers).toEqual(['gateway', 'content', 'learning', 'ai-gateway', 'ops-api']);
    // 응답 상태·특수 키
    expect(Object.keys(HealthReadyRoute.response)).toEqual(['200', '503']);
    expect(Object.keys(AdminShutdownRoute.response)).toEqual(['202']);
    expect(MetricsGetRoute.responseKind).toBe('text');
    expect(InboxDeliverRoute.bodyLimitBytes).toBe(8_388_608);
    // COMMON_ADMIN_ROUTES = 9개(inbox 제외)
    expect(COMMON_ADMIN_ROUTES).toHaveLength(9);
    expect(COMMON_ADMIN_ROUTES.map((r) => r.ifId)).toEqual([
      'IF-COM-001',
      'IF-COM-002',
      'IF-COM-003',
      'IF-COM-005',
      'IF-COM-006',
      'IF-COM-007',
      'IF-COM-008',
      'IF-COM-009',
      'IF-COM-010',
    ]);
    // 요청/응답 스키마 연결
    expect(AdminSnapshotRoute.response[200]).toBe(SnapshotResult);
    expect(AdminEventsRoute.request.query).toBe(AdminEventsQuery);
    expect(AdminIntegrityRoute.request.body).toBe(IntegrityRequest);
    expect(AdminShutdownRoute.response[202]).toBe(ShutdownAck);
  });
});
