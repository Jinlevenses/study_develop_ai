import { describe, expect, it } from 'vitest';
import { AutostartView, PutAutostartBody } from '../../../src/http/ops/v1/autostart.js';
import {
  BackupDetail,
  BackupSummary,
  PutSecondaryBody,
  RestoreBody,
  RunBackupBody,
  SecondaryTarget,
  UnlockSecondaryBody,
} from '../../../src/http/ops/v1/backups.js';
import { DoctorItemId, DoctorReport, RunDoctorBody } from '../../../src/http/ops/v1/doctor.js';
import { Banner, BannerCode, HealthBoard } from '../../../src/http/ops/v1/health.js';
import { LogLevel, LogLine, LogQuery, LogTail, LogTailQuery } from '../../../src/http/ops/v1/logs.js';
import { Operation, OperationKind, OperationListQuery, OperationResult } from '../../../src/http/ops/v1/operations.js';
import { SystemShutdownBody } from '../../../src/http/ops/v1/system.js';
import { SloView, TripwireSettings, TripwireView } from '../../../src/http/ops/v1/telemetry.js';
import { TimelineQuery, TimelineView } from '../../../src/http/ops/v1/timeline.js';
import { ExportBody, ImportBody } from '../../../src/http/ops/v1/transfer.js';
import { RollbackBody, UpgradeBody, UpgradeStatus } from '../../../src/http/ops/v1/upgrade.js';
import { banner, operation, SHA, ULID, ULID_B } from './samples.js';

const board = {
  generated_at: 1,
  overall: 'ok',
  app_version: '0.1.0',
  services: [
    { svc: 'supervisor', state: 'ready', pid: 100, port: null, restarts_60s: 0, started_at: 1, degraded_reason: null },
    { svc: 'gateway', state: 'ready', pid: 101, port: 4747, restarts_60s: 0, started_at: 1, degraded_reason: null },
  ],
  ai: { mode: 'OFFLINE', providers: [{ id: 'jev', status: 'unconsented' }] },
  backup: { last_ok_at: null, rpo_hours: null, secondary_configured: false, last_outcome: null },
  outbox: [{ svc: 'content', dest: 'learning', pending: 0, oldest_age_ms: 0 }],
  inbox: { dead_total: 0, halted: [] },
  runner: { enabled: true, queue_length: 0, platform_reason: null },
  eventloop_p99_ms: { gateway: 3, content: 4, learning: 5, 'ai-gateway': 2, 'ops-api': 1 },
  rss_mb: { gateway: 80.5, supervisor: 40 },
  disk: { free_mb: 50_000, warn: false },
  integrity: { ledger_alarm: false, projection_match: null, last_full_check_at: null },
  banners: [banner],
};

describe('ops health.ts', () => {
  it('UT-CON-160 BannerCode 28, Banner, HealthBoard(svc supervisor 통과·eventloop_p99_ms 4키 거부) [FR-SET-001][FR-SET-017]', () => {
    expect(BannerCode.options).toHaveLength(28);
    expect(BannerCode.safeParse('maintenance').success).toBe(true);
    expect(BannerCode.safeParse('everything_fine').success).toBe(false);
    expect(Banner.safeParse(banner).success).toBe(true);
    expect(Banner.safeParse({ ...banner, action: null }).success).toBe(true);
    expect(Banner.safeParse({ ...banner, severity: 'fatal' }).success).toBe(false);
    expect(Banner.safeParse({ ...banner, message_ko: 'a'.repeat(301) }).success).toBe(false);
    expect(Banner.safeParse({ ...banner, extra: 1 }).success).toBe(false);

    expect(HealthBoard.safeParse(board).success).toBe(true);
    expect(board.services[0]?.svc).toBe('supervisor'); // ServiceName ∪ 'supervisor'
    expect(HealthBoard.safeParse({ ...board, services: [{ ...board.services[0], svc: 'browser' }] }).success).toBe(
      false,
    );
    // zod 4: z.record(ServiceName, …)은 전 키(5개) 필수
    const { 'ops-api': _omit, ...four } = board.eventloop_p99_ms;
    expect(HealthBoard.safeParse({ ...board, eventloop_p99_ms: four }).success).toBe(false);
    expect(
      HealthBoard.safeParse({ ...board, eventloop_p99_ms: { ...board.eventloop_p99_ms, supervisor: 1 } }).success,
    ).toBe(false);
    // rss_mb는 문자열 키(비전수)
    expect(HealthBoard.safeParse({ ...board, rss_mb: {} }).success).toBe(true);
    expect(HealthBoard.safeParse({ ...board, overall: 'broken' }).success).toBe(false);
    expect(HealthBoard.safeParse({ ...board, banners: Array(21).fill(banner) }).success).toBe(false);
    expect(HealthBoard.safeParse({ ...board, services: Array(9).fill(board.services[0]) }).success).toBe(false);
    expect(HealthBoard.safeParse({ ...board, extra: 1 }).success).toBe(false);
  });
});

const results = {
  backup: {
    kind: 'backup',
    epoch_id: ULID,
    backup_kind: 'snapshot',
    outcome: 'ok',
    reason: null,
    bytes: 10,
    manifest_sha256: SHA,
  },
  restore: { kind: 'restore', epoch_id: ULID, projection_match: true, incrementals_applied: 2, rto_ms: 5000 },
  rehearsal: { kind: 'rehearsal', epoch_id: ULID, checksums_ok: true, row_counts_ok: true, projection_match: null },
  export: { kind: 'export', checkpoint_id: ULID, files: [{ path: '/tmp/ledger.ndjson', sha256: SHA, bytes: 3 }] },
  import: {
    kind: 'import',
    ledger: { import_id: ULID, inserted: 3, skipped_duplicates: 1, violations: 0 },
    overlays: { import_id: ULID, inserted: 1, skipped: 0, conflicts: 0 },
    gold: null,
    held_file: null,
  },
  doctor: { kind: 'doctor', report_id: ULID, fail: 0, warn: 1, fixed: 0 },
  upgrade: { kind: 'upgrade', from_version: '0.1.0', to_version: '0.2.0', pre_epoch_id: ULID, rolled_back: false },
  rollback: { kind: 'rollback', to_version: '0.1.0', restored_epoch_id: ULID, held_events: 0 },
  shutdown: { kind: 'shutdown' },
  service_restart: { kind: 'service_restart', svc: 'learning', pid: null },
} as const;

describe('ops operations.ts', () => {
  it('UT-CON-161 OperationKind 10, OperationResult 10종, Operation, OperationListQuery [FR-SET-004~007]', () => {
    expect(OperationKind.options).toHaveLength(10);
    expect(OperationResult.options).toHaveLength(10);
    expect(Object.keys(results).sort()).toEqual([...OperationKind.options].sort());
    for (const [name, r] of Object.entries(results)) {
      expect(OperationResult.safeParse(r).success, name).toBe(true);
      expect(OperationResult.safeParse({ ...r, extra: 1 }).success, `${name}+extra`).toBe(false);
    }
    expect(OperationResult.safeParse({ kind: 'reboot' }).success).toBe(false);
    expect(OperationResult.safeParse({ ...results.service_restart, svc: 'supervisor' }).success).toBe(false);

    expect(Operation.safeParse(operation).success).toBe(true);
    expect(
      Operation.safeParse({ ...operation, state: 'succeeded', finished_at: 2, result: results.backup }).success,
    ).toBe(true);
    const problem = {
      type: 'urn:fathom:problem:op-dep-001',
      title: 'supervisor IPC 불가',
      status: 503,
      code: 'OP-DEP-001',
      error_id: ULID,
      request_id: ULID_B,
      retryable: true,
    };
    expect(Operation.safeParse({ ...operation, state: 'failed', finished_at: 2, problem }).success).toBe(true);
    expect(Operation.safeParse({ ...operation, state: 'failed', problem: { ...problem, status: 200 } }).success).toBe(
      false,
    );
    expect(Operation.safeParse({ ...operation, progress: { step: 'x', pct: 101 } }).success).toBe(false);
    expect(Operation.safeParse({ ...operation, state: 'paused' }).success).toBe(false);
    expect(Operation.safeParse({ ...operation, kind: 'reboot' }).success).toBe(false);

    expect(OperationListQuery.parse({}).limit).toBe(50);
    expect(OperationListQuery.safeParse({ kind: 'restore', state: 'queued', limit: '200' }).success).toBe(true);
    expect(OperationListQuery.safeParse({ kind: 'bogus' }).success).toBe(false);
    expect(OperationListQuery.safeParse({ limit: '201' }).success).toBe(false);
  });
});

const summary = {
  epoch_id: ULID,
  kind: 'snapshot',
  created_at: 1,
  outcome: 'ok',
  size_bytes: 100,
  app_version: '0.1.0',
  manifest_sha256: null,
  rehearsal: null,
  secondary: { copied_at: null, encrypted: false },
};

describe('ops backups.ts', () => {
  it('UT-CON-162 RunBackupBody.reason 5, BackupDetail.manifest null, RestoreBody.epoch 2종, PutSecondaryBody.passphrase 11자 거부 [FR-SET-004][FR-SET-005][NFR-SEC-018]', () => {
    const run = { op_id: ULID, kind: 'snapshot', reason: 'manual' };
    expect(RunBackupBody.shape.reason.options).toHaveLength(5);
    for (const reason of RunBackupBody.shape.reason.options) {
      expect(RunBackupBody.safeParse({ ...run, reason }).success, reason).toBe(true);
    }
    expect(RunBackupBody.safeParse({ ...run, reason: 'whim' }).success).toBe(false);
    expect(RunBackupBody.safeParse({ ...run, kind: 'rehearsal' }).success).toBe(false);

    expect(BackupSummary.safeParse(summary).success).toBe(true);
    expect(BackupSummary.safeParse({ ...summary, rehearsal: { at: 2, ok: true } }).success).toBe(true);
    expect(BackupSummary.safeParse({ ...summary, outcome: 'pending' }).success).toBe(false);
    expect(BackupDetail.safeParse({ summary, manifest: null }).success).toBe(true);
    expect(BackupDetail.safeParse({ summary, manifest: { not: 'a manifest' } }).success).toBe(false);
    expect(BackupDetail.safeParse({ summary }).success).toBe(false);

    expect(
      RestoreBody.safeParse({ op_id: ULID, epoch: { kind: 'latest' }, rehearse: false, apply_incrementals: true })
        .success,
    ).toBe(true);
    expect(
      RestoreBody.safeParse({
        op_id: ULID,
        epoch: { kind: 'id', epoch_id: ULID_B },
        rehearse: true,
        apply_incrementals: false,
      }).success,
    ).toBe(true);
    expect(
      RestoreBody.safeParse({ op_id: ULID, epoch: { kind: 'id' }, rehearse: true, apply_incrementals: false }).success,
    ).toBe(false);
    expect(
      RestoreBody.safeParse({ op_id: ULID, epoch: { kind: 'oldest' }, rehearse: true, apply_incrementals: false })
        .success,
    ).toBe(false);
    expect(
      RestoreBody.safeParse({
        op_id: ULID,
        epoch: { kind: 'latest', epoch_id: ULID },
        rehearse: true,
        apply_incrementals: false,
      }).success,
    ).toBe(false);

    const sec = { path: '/mnt/backup', encrypt: true, passphrase: 'a'.repeat(12) };
    expect(PutSecondaryBody.safeParse(sec).success).toBe(true);
    expect(PutSecondaryBody.safeParse({ ...sec, passphrase: 'a'.repeat(11) }).success).toBe(false);
    expect(PutSecondaryBody.safeParse({ path: null, encrypt: false, passphrase: null }).success).toBe(true);
    expect(PutSecondaryBody.safeParse({ ...sec, path: '' }).success).toBe(false);
    expect(UnlockSecondaryBody.safeParse({ passphrase: 'a'.repeat(11) }).success).toBe(false);
    expect(UnlockSecondaryBody.safeParse({ passphrase: 'a'.repeat(12) }).success).toBe(true);
    const target = {
      path: null,
      encrypt: false,
      locked: false,
      last_copied_at: null,
      lag_s: null,
      warnings: ['sync_folder'],
    };
    expect(SecondaryTarget.safeParse(target).success).toBe(true);
    expect(SecondaryTarget.safeParse({ ...target, warnings: ['dangerous'] }).success).toBe(false);
  });
});

describe('ops transfer.ts · doctor.ts', () => {
  it('UT-CON-163 ExportBody.include 0개 거부, ImportBody.mode replace 거부, DoctorItemId 23, DoctorReport [FR-SET-003][FR-SET-006]', () => {
    const exp = { op_id: ULID, since: { kind: 'all' }, out_dir: null, include: ['ledger', 'overlays'] };
    expect(ExportBody.safeParse(exp).success).toBe(true);
    expect(ExportBody.safeParse({ ...exp, include: [] }).success).toBe(false);
    expect(
      ExportBody.safeParse({ ...exp, include: ['ledger', 'overlays', 'settings', 'gold', 'markdown_notes', 'ledger'] })
        .success,
    ).toBe(false);
    expect(ExportBody.safeParse({ ...exp, include: ['secrets'] }).success).toBe(false);
    expect(ExportBody.safeParse({ ...exp, since: { kind: 'checkpoint', checkpoint_id: ULID_B } }).success).toBe(true);
    expect(ExportBody.safeParse({ ...exp, since: { kind: 'checkpoint' } }).success).toBe(false);
    expect(ExportBody.safeParse({ ...exp, out_dir: '' }).success).toBe(false);

    expect(ImportBody.safeParse({ op_id: ULID, path: '/tmp/x', mode: 'merge' }).success).toBe(true);
    expect(ImportBody.safeParse({ op_id: ULID, path: '/tmp/x', mode: 'replace' }).success).toBe(false);
    expect(ImportBody.safeParse({ op_id: ULID, path: '', mode: 'merge' }).success).toBe(false);

    expect(DoctorItemId.options).toHaveLength(23);
    const item = {
      id: 'node_version',
      status: 'ok',
      summary_ko: '정상',
      detail_ko: null,
      fixable: false,
      fix_applied: false,
    };
    const report = { report_id: ULID, generated_at: 1, live: false, fix: false, items: [item] };
    expect(DoctorReport.safeParse(report).success).toBe(true);
    expect(DoctorReport.safeParse({ ...report, items: [{ ...item, id: 'weather' }] }).success).toBe(false);
    expect(DoctorReport.safeParse({ ...report, items: [{ ...item, status: 'meh' }] }).success).toBe(false);
    expect(DoctorReport.safeParse({ ...report, items: Array(41).fill(item) }).success).toBe(false);
    expect(RunDoctorBody.safeParse({ op_id: ULID, fix: true, live: false }).success).toBe(true);
    expect(RunDoctorBody.safeParse({ op_id: ULID, fix: true }).success).toBe(false);
  });
});

describe('ops upgrade·autostart·timeline·logs', () => {
  it('UT-CON-164 UpgradeStatus, AutostartView.method 4, TimelineView, LogLine.trace_id 31자 거부, LogTailQuery.n 기본 200 [FR-SET-007][FR-SET-016]', () => {
    const status = { current_version: '0.1.0', previous_version: null, rollback_available: false, last_op: null };
    expect(UpgradeStatus.safeParse(status).success).toBe(true);
    expect(UpgradeStatus.safeParse({ ...status, last_op: operation }).success).toBe(true);
    expect(UpgradeStatus.safeParse({ ...status, current_version: 'v1' }).success).toBe(false);
    expect(UpgradeBody.safeParse({ op_id: ULID, bundle_path: '/tmp/bundle.tgz' }).success).toBe(true);
    expect(UpgradeBody.safeParse({ op_id: ULID, bundle_path: '' }).success).toBe(false);
    expect(RollbackBody.safeParse({ op_id: ULID }).success).toBe(true);

    expect(AutostartView.shape.method.options).toHaveLength(4);
    expect(
      AutostartView.safeParse({
        enabled: true,
        method: 'systemd_user',
        path: '/home/u/.config/systemd/user/fathom.service',
      }).success,
    ).toBe(true);
    expect(AutostartView.safeParse({ enabled: false, method: 'unsupported', path: null }).success).toBe(true);
    expect(AutostartView.safeParse({ enabled: true, method: 'cron', path: null }).success).toBe(false);
    expect(PutAutostartBody.safeParse({ enabled: true }).success).toBe(true);

    const timeline = {
      correlation_id: ULID,
      entries: [
        {
          ts: 1,
          svc: 'content',
          kind: 'outbox',
          type: 'grading.verdict.issued',
          event_id: ULID_B,
          causation_id: null,
          summary: '발행',
          level: null,
        },
        {
          ts: 2,
          svc: 'learning',
          kind: 'log',
          type: null,
          event_id: null,
          causation_id: null,
          summary: '로그',
          level: 'warn',
        },
      ],
    };
    expect(TimelineView.safeParse(timeline).success).toBe(true);
    expect(TimelineView.safeParse({ ...timeline, entries: [{ ...timeline.entries[0], kind: 'metric' }] }).success).toBe(
      false,
    );
    expect(
      TimelineView.safeParse({ ...timeline, entries: [{ ...timeline.entries[0], type: 'NotAnEvent' }] }).success,
    ).toBe(false);
    expect(TimelineView.safeParse({ ...timeline, entries: Array(1001).fill(timeline.entries[0]) }).success).toBe(false);
    expect(TimelineQuery.safeParse({ correlation_id: ULID }).success).toBe(true);
    expect(TimelineQuery.safeParse({}).success).toBe(false);

    const line = {
      ts: 1,
      level: 'info',
      svc: 'gateway',
      msg: '시작',
      req_id: null,
      event: null,
      err_code: null,
      correlation_id: null,
      trace_id: 'a'.repeat(32),
      job: null,
      raw: false,
    };
    expect(LogLine.safeParse(line).success).toBe(true);
    expect(LogLine.safeParse({ ...line, trace_id: 'a'.repeat(31) }).success).toBe(false);
    expect(LogLine.safeParse({ ...line, trace_id: 'A'.repeat(32) }).success).toBe(false);
    expect(LogLine.safeParse({ ...line, trace_id: null }).success).toBe(true);
    expect(LogLine.safeParse({ ...line, level: 'trace' }).success).toBe(false);
    expect(LogLevel.options).toEqual(['debug', 'info', 'warn', 'error', 'fatal']);
    expect(LogTail.safeParse({ svc: 'supervisor', lines: [line] }).success).toBe(true);

    expect(LogTailQuery.parse({ svc: 'gateway' }).n).toBe(200);
    expect(LogTailQuery.parse({ svc: 'supervisor', n: '5000' }).n).toBe(5000);
    expect(LogTailQuery.safeParse({ svc: 'gateway', n: '5001' }).success).toBe(false);
    expect(LogTailQuery.safeParse({ n: '10' }).success).toBe(false);
    expect(LogQuery.parse({}).limit).toBe(100);
    expect(
      LogQuery.safeParse({
        svc: 'supervisor',
        level: 'warn',
        q: '오류',
        from: '1',
        to: '2',
        correlation_id: ULID,
        limit: '500',
      }).success,
    ).toBe(true);
    expect(LogQuery.safeParse({ limit: '501' }).success).toBe(false);
  });
});

describe('ops telemetry.ts · system.ts', () => {
  it('UT-CON-165 TripwireView.id TW-13 통과·TW-14 거부, SloView.window 리터럴, SystemShutdownBody.grace_ms 10001 거부 [NFR-AVL-008][FR-SET-021]', () => {
    const resource = {
      idle_rss_total_mb: 300,
      idle_rss_limit_mb: 400,
      cold_start_ms: 2000,
      cold_start_limit_ms: 10000,
      disk_projection_15y_mb: null,
    };
    const trip = (id: string) => ({
      computed_at: 1,
      learning: [{ id, value: 1, threshold: 2, state: 'ok' }],
      resource,
    });
    for (const id of ['TW-01', 'TW-09', 'TW-10', 'TW-13', 'GR-01', 'GR-99']) {
      expect(TripwireView.safeParse(trip(id)).success, id).toBe(true);
    }
    for (const id of ['TW-14', 'TW-00', 'TW-1', 'GR-1', 'XX-01']) {
      expect(TripwireView.safeParse(trip(id)).success, id).toBe(false);
    }
    expect(
      TripwireView.safeParse({ ...trip('TW-01'), learning: Array(41).fill(trip('TW-01').learning[0]) }).success,
    ).toBe(false);
    expect(
      TripwireView.safeParse({ ...trip('TW-01'), learning: [{ ...trip('TW-01').learning[0], state: 'panic' }] })
        .success,
    ).toBe(false);
    expect(TripwireSettings.safeParse({ action_strength: 'suggest', muted: ['TW-13'] }).success).toBe(true);
    expect(TripwireSettings.safeParse({ action_strength: 'suggest', muted: ['TW-14'] }).success).toBe(false);
    expect(TripwireSettings.safeParse({ action_strength: 'panic', muted: [] }).success).toBe(false);

    const slo = {
      computed_at: 1,
      window: '1h',
      slos: [{ id: 'first_item_p95', target_ms: 1500, value_ms: null, ok: null }],
    };
    expect(SloView.safeParse(slo).success).toBe(true);
    expect(SloView.safeParse({ ...slo, window: '24h' }).success).toBe(false);
    expect(SloView.safeParse({ ...slo, slos: [{ ...slo.slos[0], id: 'vibes' }] }).success).toBe(false);

    expect(SystemShutdownBody.safeParse({ op_id: ULID, grace_ms: 10_000 }).success).toBe(true);
    expect(SystemShutdownBody.safeParse({ op_id: ULID, grace_ms: 10_001 }).success).toBe(false);
    expect(SystemShutdownBody.safeParse({ op_id: ULID, grace_ms: -1 }).success).toBe(false);
    expect(SystemShutdownBody.safeParse({ op_id: ULID }).success).toBe(false);
  });
});
