import type { SupervisedService } from '@fathom/contracts/admin/ipc';
import { IpcSupervisorToService } from '@fathom/contracts/admin/ipc';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { peerUrls } from './ports.js';
import type { Row } from './process-table.js';
import { createRow, overallState, registryEntry, SERVICE_ORDER } from './process-table.js';
import type { RegistryFile, RegistryServiceEntry } from './runtime-files.js';
import { createCallerTokens } from './tokens.js';
import type { SupervisorDeps, SupervisorOptions } from './types.js';

// supervisor 내부 공유 상태·헬퍼(행 표, registry 스냅샷, IPC 송신). 상태 전이는 lifecycle.ts·messages.ts가 한다.
export type SupervisorState = {
  shuttingDown: boolean;
  portNoticeDone: boolean;
  logLevel: SupervisorOptions['logLevel'];
  startedAtMs: number | null;
};
export type Ctx = {
  readonly opts: SupervisorOptions;
  readonly deps: SupervisorDeps;
  readonly dev: boolean;
  readonly managed: readonly SupervisedService[];
  readonly tokens: Readonly<Record<ServiceName, string>>;
  readonly notices: string[];
  readonly state: SupervisorState;
  rowOf(svc: SupervisedService): Row;
  allRows(): Row[];
  persist(final?: boolean): void;
  sendTo(row: Row, body: Record<string, unknown>): boolean;
  broadcast(body: Record<string, unknown>): void;
  knownPorts(): Partial<Record<ServiceName, number | null>>;
};

export function createCtx(opts: SupervisorOptions, deps: SupervisorDeps): Ctx {
  const dev = opts.profile === 'dev';
  const managed = SERVICE_ORDER.filter((s) => s !== 'vite' || dev);
  const rows = new Map<SupervisedService, Row>();
  for (const svc of managed) {
    rows.set(svc, createRow(svc, 'stopped', svc === 'gateway' ? 'waiting_deps' : null));
  }
  const state: SupervisorState = {
    shuttingDown: false,
    portNoticeDone: false,
    logLevel: opts.logLevel,
    startedAtMs: null,
  };
  const notices: string[] = [];
  const rowOf = (svc: SupervisedService): Row => {
    const row = rows.get(svc);
    if (row === undefined) {
      throw new Error(`invariant: supervisor does not manage ${svc}`);
    }
    return row;
  };
  const allRows = (): Row[] => managed.map(rowOf);

  function snapshot(final: boolean): RegistryFile {
    const services: Partial<Record<SupervisedService, RegistryServiceEntry>> = {};
    for (const row of allRows()) {
      services[row.svc] = registryEntry(final ? { ...row, state: 'stopped', pid: null, port: null } : row);
    }
    return {
      v: 1,
      boot_id: opts.bootId,
      profile: opts.profile,
      app_version: opts.bundle.appVersion,
      supervisor_pid: process.pid,
      state: final ? 'stopped' : overallState(allRows(), state.shuttingDown),
      updated_at: deps.clock.now(),
      services,
      notices: [...notices],
    };
  }
  function sendTo(row: Row, body: Record<string, unknown>): boolean {
    return row.handle === null ? false : row.handle.send(IpcSupervisorToService.parse({ v: 1, ...body }));
  }
  function knownPorts(): Partial<Record<ServiceName, number | null>> {
    const known: Partial<Record<ServiceName, number | null>> = {};
    for (const row of allRows()) {
      if (row.svc !== 'vite') {
        known[row.svc] = row.port;
      }
    }
    return known;
  }
  return {
    opts,
    deps,
    dev,
    managed,
    tokens: createCallerTokens(deps.randomBytes),
    notices,
    state,
    rowOf,
    allRows,
    persist: (final = false): void => deps.files.writeRegistry(snapshot(final)),
    sendTo,
    broadcast(body): void {
      for (const row of allRows()) {
        if (row.svc !== 'vite') {
          sendTo(row, body);
        }
      }
    },
    knownPorts,
  };
}

export function peersOf(ctx: Ctx): ReturnType<typeof peerUrls> {
  return peerUrls(ctx.opts.profile, ctx.knownPorts());
}
