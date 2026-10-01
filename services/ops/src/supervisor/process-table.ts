import type { IpcSupervisorToOps, SupervisedService } from '@fathom/contracts/admin/ipc';
import type { ServiceState } from '@fathom/contracts/common/domain';
import type { ChildHandle } from './child.js';
import type { ReadyInfo } from './handshake.js';
import { CRASH_WINDOW_MS } from './restart-policy.js';
import type { RegistryFile, RegistryServiceEntry } from './runtime-files.js';

// Brief §4.1.8 — 서비스별 행(가변 상태). 상태 전이는 supervisor.ts가 하고, 여기는 행 생성과 순수 투영만 둔다.
export type Row = {
  readonly svc: SupervisedService;
  state: ServiceState;
  pid: number | null;
  port: number | null;
  lastPort: number | null;
  startedAt: number | null;
  crashTimes: readonly number[];
  restarts: number;
  lastExitCode: number | null;
  reason: string | null;
  fatalCode: string | null;
  afterCrash: boolean;
  requestedStop: boolean;
  handshakeRejected: boolean;
  everForked: boolean;
  handle: ChildHandle | null;
  exitOnce: ((code: number | null, signal: string | null) => void) | null;
  readyInfo: ReadyInfo | null;
  exitWaiters: (() => void)[];
  cancelTimers: (() => void)[];
  chain: Promise<void>;
};

export type StatusRow = Extract<IpcSupervisorToOps, { type: 'status' }>['services'][number];

/** 상태 표시 순서(IPC `status`·registry 공통). */
export const SERVICE_ORDER: readonly SupervisedService[] = [
  'gateway',
  'content',
  'learning',
  'ai-gateway',
  'ops-api',
  'vite',
];

export function createRow(svc: SupervisedService, state: ServiceState, reason: string | null): Row {
  return {
    svc,
    state,
    pid: null,
    port: null,
    lastPort: null,
    startedAt: null,
    crashTimes: [],
    restarts: 0,
    lastExitCode: null,
    reason,
    fatalCode: null,
    afterCrash: false,
    requestedStop: false,
    handshakeRejected: false,
    everForked: false,
    handle: null,
    exitOnce: null,
    readyInfo: null,
    exitWaiters: [],
    cancelTimers: [],
    chain: Promise.resolve(),
  };
}

export function recentCrashes(row: Row, now: number): number {
  return row.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS).length;
}

/** 의도적으로 기동하지 않은 행(Safe Mode·운영자 정지)은 전체 상태 판정에서 제외한다. */
function isTarget(row: Row): boolean {
  return !(row.state === 'stopped' && (row.reason === 'safe_mode' || row.reason === 'requested'));
}

export type OverallState = RegistryFile['state'];

export function overallState(rows: readonly Row[], stopping: boolean): OverallState {
  if (stopping) {
    return 'stopping';
  }
  if (rows.some((r) => r.state === 'degraded')) {
    return 'degraded';
  }
  const targets = rows.filter(isTarget);
  return targets.length > 0 && targets.every((r) => r.state === 'ready') ? 'ready' : 'starting';
}

export function registryEntry(row: Row): RegistryServiceEntry {
  return {
    pid: row.pid,
    port: row.port,
    state: row.state,
    started_at: row.startedAt,
    restarts: row.restarts,
    last_exit_code: row.lastExitCode,
    reason: row.reason === null ? null : row.reason.slice(0, 120),
  };
}

export function statusRowOf(row: Row, now: number): StatusRow {
  return {
    svc: row.svc,
    state: row.state,
    pid: row.pid,
    port: row.port,
    restarts_60s: recentCrashes(row, now),
    started_at: row.startedAt,
    last_exit_code: row.lastExitCode,
  };
}
