import { describe, expect, it } from 'vitest';
import { EpochManifest, ServiceSnapshot } from '../../../src/admin/epoch-manifest.js';
import {
  BootstrapEnvelope,
  IpcOpsToSupervisor,
  IpcServiceToSupervisor,
  IpcSupervisorToOps,
  IpcSupervisorToService,
  RunModeArgs,
  SupervisedService,
  Token,
} from '../../../src/admin/ipc.js';
import { IpcJob, JobName } from '../../../src/admin/jobs.js';

const ULID_A = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';
const ULID_B = '01J0A1B2C3D4E5F6G7H8J9K0M1';
const SHA = 'a'.repeat(64);
const TOKEN = 'b'.repeat(64);

const five = (v: unknown) => ({ gateway: v, content: v, learning: v, 'ai-gateway': v, 'ops-api': v });
const snapshot = (file: string) => ({
  file,
  sha256: SHA,
  bytes: 10,
  schema: { _infra: 1 },
  outbox_head_seq: 0,
  delivery: five(0),
  inbox_watermark: five(0),
});
const manifest = () => ({
  v: 1,
  epoch_id: ULID_A,
  kind: 'snapshot',
  created_at: 1,
  app_version: '0.1.0',
  contracts_hash: SHA,
  device_id: ULID_B,
  policy_lock_sha256: SHA,
  prompts_lock_sha256: SHA,
  packs: [{ pack_id: 'k8s', version: '1.0.0', manifest_hash: SHA }],
  services: {
    content: snapshot('content.db'),
    learning: { ...snapshot('learning.db'), projection_hash: SHA, fsrs_impl: 'ts-fsrs@5.4.2' },
    'ai-gateway': snapshot('ai.db'),
    'ops-api': snapshot('ops.db'),
  },
  excluded: ['insight.db', 'ai-cache.db', 'secrets/ai-keys.enc'],
});
const bootstrap = () => ({
  type: 'bootstrap',
  v: 1,
  svc: 'learning',
  boot_id: ULID_A,
  app_version: '0.1.0',
  contracts_hash: SHA,
  profile: 'dev',
  home: '/home/u/.fathom-dev',
  web_root: null,
  listen: { host: '127.0.0.1', port: 4863 },
  self_token: TOKEN,
  callers: five(TOKEN),
  peers: Object.fromEntries(
    ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'].map((s, i) => [
      s,
      { url: `http://127.0.0.1:${4800 + i}` },
    ]),
  ),
  flags: { safe_mode: false, batch_enabled: true, after_crash: false },
  log_level: 'info',
});

describe('admin/epoch-manifest', () => {
  it('UT-CON-046 EpochManifest.services는 정확히 4키(gateway 제외)이고 ServiceSnapshot은 strict다 [NFR-DATA-012]', () => {
    expect(EpochManifest.safeParse(manifest()).success).toBe(true);
    const m = manifest();
    expect(
      EpochManifest.safeParse({ ...m, services: { ...m.services, gateway: snapshot('content.db') } }).success,
    ).toBe(false);
    const { 'ops-api': _drop, ...three } = m.services;
    expect(EpochManifest.safeParse({ ...m, services: three }).success).toBe(false);
    expect(EpochManifest.safeParse({ ...m, v: 2 }).success).toBe(false);
    expect(EpochManifest.safeParse({ ...m, kind: 'incremental' }).success).toBe(false);
    expect(EpochManifest.safeParse({ ...m, excluded: ['content.db'] }).success).toBe(false);
    expect(EpochManifest.safeParse({ ...m, packs: Array(51).fill(m.packs[0]) }).success).toBe(false);
    expect(ServiceSnapshot.safeParse({ ...snapshot('content.db'), delivery: { gateway: 0 } }).success).toBe(false); // 전수 record
    expect(ServiceSnapshot.safeParse({ ...snapshot('x.db') }).success).toBe(false);
    expect(ServiceSnapshot.safeParse({ ...snapshot('ops.db'), extra: 1 }).success).toBe(false);
  });
});

describe('admin/ipc', () => {
  it('UT-CON-048 BootstrapEnvelope.listen.host는 127.0.0.1만 받고 callers·peers는 전수 record다 [NFR-SEC-003][IF-IPC-001]', () => {
    expect(Token.safeParse(TOKEN).success).toBe(true);
    expect(Token.safeParse('B'.repeat(64)).success).toBe(false);
    expect(BootstrapEnvelope.safeParse(bootstrap()).success).toBe(true);
    const b = bootstrap();
    for (const host of ['0.0.0.0', 'localhost', '::1', '192.168.0.2']) {
      expect(BootstrapEnvelope.safeParse({ ...b, listen: { host, port: 4863 } }).success, host).toBe(false);
    }
    expect(BootstrapEnvelope.safeParse({ ...b, listen: { host: '127.0.0.1', port: 65_536 } }).success).toBe(false);
    expect(BootstrapEnvelope.safeParse({ ...b, callers: { gateway: TOKEN } }).success).toBe(false);
    expect(BootstrapEnvelope.safeParse({ ...b, peers: { gateway: { url: 'http://127.0.0.1:4747' } } }).success).toBe(
      false,
    );
    expect(BootstrapEnvelope.safeParse({ ...b, self_token: 'short' }).success).toBe(false);
    expect(BootstrapEnvelope.safeParse({ ...b, profile: 'staging' }).success).toBe(false);
    expect(BootstrapEnvelope.safeParse({ ...b, v: 2 }).success).toBe(false);
    expect(BootstrapEnvelope.safeParse({ ...b, id: ULID_B, re: ULID_A }).success).toBe(true);
    expect(BootstrapEnvelope.safeParse({ ...b, extra: 1 }).success).toBe(false);
  });

  it('UT-CON-049 IpcSupervisorToService는 4 type을 각 1건 통과시킨다 [NFR-SEC-003][IF-IPC-001~004]', () => {
    const peers = Object.fromEntries(
      ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'].map((s) => [s, { url: 'http://127.0.0.1:4700' }]),
    );
    const msgs = [
      bootstrap(),
      { type: 'registry.updated', v: 1, peers },
      { type: 'shutdown', v: 1, grace_ms: 3000 },
      { type: 'log.level', v: 1, level: 'debug' },
    ];
    for (const m of msgs) {
      expect(IpcSupervisorToService.safeParse(m).success, m.type).toBe(true);
    }
    expect(IpcSupervisorToService.safeParse({ type: 'shutdown', v: 1, grace_ms: 10_001 }).success).toBe(false);
    expect(IpcSupervisorToService.safeParse({ type: 'log.level', v: 1, level: 'trace' }).success).toBe(false);
    expect(IpcSupervisorToService.safeParse({ type: 'ready', v: 1 }).success).toBe(false);
    expect(IpcSupervisorToService.safeParse({ type: 'shutdown', grace_ms: 1 }).success).toBe(false); // v 필수
  });

  it('UT-CON-050 IpcServiceToSupervisor는 3 type을 통과시키고 fatal.exit_code는 {64,70,75,78}만 받는다 [NFR-SEC-003][IF-IPC-005~007]', () => {
    expect(IpcServiceToSupervisor.safeParse({ type: 'listening', v: 1, port: 4863 }).success).toBe(true);
    expect(IpcServiceToSupervisor.safeParse({ type: 'listening', v: 1, port: 0 }).success).toBe(false);
    expect(
      IpcServiceToSupervisor.safeParse({
        type: 'ready',
        v: 1,
        contracts_hash: SHA,
        schema_versions: { ledger: { _infra: 1, ledger: 2 } },
        app_version: '0.1.0',
      }).success,
    ).toBe(true);
    for (const exit_code of [64, 70, 75, 78]) {
      expect(
        IpcServiceToSupervisor.safeParse({ type: 'fatal', v: 1, exit_code, code: 'CONFIG' }).success,
        String(exit_code),
      ).toBe(true);
    }
    for (const exit_code of [0, 1, 65, 77, 79]) {
      expect(
        IpcServiceToSupervisor.safeParse({ type: 'fatal', v: 1, exit_code, code: 'X' }).success,
        String(exit_code),
      ).toBe(false);
    }
  });

  it('UT-CON-051 IpcOpsToSupervisor 7 type·RunModeArgs 3모드·SupervisedService [NFR-SEC-003][IF-IPC-008~017]', () => {
    const msgs = [
      { type: 'svc.stop', v: 1, svc: 'content' },
      { type: 'svc.start', v: 1, svc: 'vite' },
      { type: 'svc.restart', v: 1, svc: 'gateway' },
      { type: 'svc.run_mode', v: 1, svc: 'learning', args: { mode: 'verify', replay: true, db_copy_dir: null } },
      { type: 'status.get', v: 1 },
      { type: 'logs.tail', v: 1, svc: 'supervisor', n: 100 },
      { type: 'shutdown.all', v: 1, grace_ms: 0 },
    ];
    expect(msgs).toHaveLength(7);
    for (const m of msgs) {
      expect(IpcOpsToSupervisor.safeParse(m).success, m.type).toBe(true);
    }
    expect(
      IpcOpsToSupervisor.safeParse({
        type: 'svc.run_mode',
        v: 1,
        svc: 'vite',
        args: { mode: 'verify', replay: true, db_copy_dir: null },
      }).success,
    ).toBe(false);
    expect(IpcOpsToSupervisor.safeParse({ type: 'logs.tail', v: 1, svc: 'content', n: 5001 }).success).toBe(false);
    expect(IpcOpsToSupervisor.safeParse({ type: 'svc.stop', v: 1, svc: 'supervisor' }).success).toBe(false);

    expect(SupervisedService.safeParse('vite').success).toBe(true);
    expect(SupervisedService.safeParse('ops-api').success).toBe(true);
    expect(SupervisedService.safeParse('browser').success).toBe(false);

    const modes = [
      { mode: 'migrate', dry_run: true, db_copy_dir: '/tmp/x', app_dir: null },
      { mode: 'restore', from: '/home/u/backups/snap/e', rewind_cursors: five(0) },
      { mode: 'verify', replay: false, db_copy_dir: null },
    ];
    for (const m of modes) {
      expect(RunModeArgs.safeParse(m).success, m.mode).toBe(true);
    }
    expect(RunModeArgs.safeParse({ mode: 'restore', from: '/x', rewind_cursors: { gateway: 0 } }).success).toBe(false); // 전수 record
    expect(RunModeArgs.safeParse({ mode: 'repair' }).success).toBe(false);
    expect(RunModeArgs.safeParse({ mode: 'migrate', dry_run: true }).success).toBe(false);
  });

  it('UT-CON-052 IpcSupervisorToOps 4 type을 각 1건 통과시킨다 [NFR-SEC-003][IF-IPC-012~016]', () => {
    const msgs = [
      { type: 'svc.ack', v: 1, ok: false, error: '실패' },
      { type: 'svc.run_mode.result', v: 1, exit_code: 0, tail: ['done'] },
      {
        type: 'status',
        v: 1,
        services: [
          {
            svc: 'supervisor',
            state: 'ready',
            pid: 1,
            port: null,
            restarts_60s: 0,
            started_at: 1,
            last_exit_code: null,
          },
          {
            svc: 'vite',
            state: 'stopped',
            pid: null,
            port: null,
            restarts_60s: 0,
            started_at: null,
            last_exit_code: 0,
          },
        ],
      },
      { type: 'logs.tail.result', v: 1, svc: 'content', lines: ['a', 'b'] },
    ];
    for (const m of msgs) {
      expect(IpcSupervisorToOps.safeParse(m).success, m.type).toBe(true);
    }
    expect(IpcSupervisorToOps.safeParse({ type: 'svc.ack', v: 1, ok: true }).success).toBe(false); // error 필수(null 허용)
    expect(
      IpcSupervisorToOps.safeParse({
        type: 'status',
        v: 1,
        services: [
          { svc: 'content', state: 'crashed', pid: 1, port: 1, restarts_60s: 0, started_at: 1, last_exit_code: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      IpcSupervisorToOps.safeParse({ type: 'logs.tail.result', v: 1, svc: 'x', lines: Array(5001).fill('a') }).success,
    ).toBe(false);
  });
});

describe('admin/jobs', () => {
  it('UT-CON-053 IpcJob 5종 통과 + jobs.ts의 머리 H는 ipc.ts와 동등하다(v: 2 거부) [IF-IPC-018~022]', () => {
    expect(JobName.options).toHaveLength(8);
    const msgs = [
      { type: 'job.start', v: 1, job: 'snapshot', args: { epoch_id: ULID_A } },
      { type: 'job.progress', v: 1, pct: null, step: 'copy' },
      { type: 'job.result', v: 1, result: { ok: true } },
      { type: 'job.error', v: 1, code: 'cancelled', message: '취소됨' },
      { type: 'job.cancel', v: 1 },
    ];
    expect(msgs).toHaveLength(5);
    for (const m of msgs) {
      expect(IpcJob.safeParse(m).success, m.type).toBe(true);
    }
    expect(IpcJob.safeParse({ type: 'job.progress', v: 1, pct: 101, step: 's' }).success).toBe(false);
    expect(IpcJob.safeParse({ type: 'job.start', v: 1, job: 'unknown', args: {} }).success).toBe(false);

    // 두 머리의 동등성: 같은 입력(id·re 포함)은 둘 다 통과, v: 2·잘못된 id는 둘 다 거부.
    const headCases: [Record<string, unknown>, boolean][] = [
      [{ v: 1 }, true],
      [{ v: 1, id: ULID_A, re: ULID_B }, true],
      [{ v: 2 }, false],
      [{}, false],
      [{ v: 1, id: 'not-a-ulid' }, false],
      [{ v: 1, re: 'x' }, false],
    ];
    for (const [head, expected] of headCases) {
      expect(IpcJob.safeParse({ type: 'job.cancel', ...head }).success, JSON.stringify(head)).toBe(expected);
      expect(IpcOpsToSupervisor.safeParse({ type: 'status.get', ...head }).success, JSON.stringify(head)).toBe(
        expected,
      );
    }
  });
});
