import { AsyncLocalStorage } from 'node:async_hooks';
import { IntegrityResult } from '@fathom/contracts/admin/admin-routes';
import type { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { IpcServiceToSupervisor, IpcSupervisorToService } from '@fathom/contracts/admin/ipc';
import type { ServiceName } from '@fathom/contracts/common/ids';
import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import { createPeerClient } from '@fathom/shared-kernel/http-client/http-client';
import type { JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import { createJobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { Logger } from '@fathom/shared-kernel/log/log';
import { createLogger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import { createMetrics } from '@fathom/shared-kernel/metrics/metrics';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { startRelay } from '../eventing/relay.js';
import { createInboxTransport } from '../eventing/transport.js';
import type { AppInternals } from './app.js';
import { assembleApp } from './app.js';
import type { IpcInbox } from './ipc-inbox.js';
import { createIpcInbox } from './ipc-inbox.js';
import type { RequestContext } from './pipeline.js';
import type { ProcessPort } from './process-port.js';
import { checkEnvironment, openDatabases, receiveEnvelope } from './serve-boot.js';
import { listenOnLoopback } from './serve-listen.js';
import type { ExitCode, OpenedDatabases, ServeRuntime, Step } from './serve-types.js';
import { stepFail, stepOk } from './serve-types.js';
import type { ServiceState } from './service-state.js';
import { createServiceState } from './service-state.js';
import { createShutdown } from './shutdown.js';
import type { SqliteRuntime } from './sqlite-loader.js';
import { startMaintenanceTimers } from './timers.js';
import type { RunningService, ServiceDefinition, ServiceRunResult } from './types.js';

// §4.3.1 serve 흐름(ARC-01 §14.2 · ADR-012 §6) — 각 단계 실패는 `fatal(exit, code)` 한 곳으로 모인다.

const INTEGRITY_TIMEOUT_MS = 120_000;

export type ServeOptions = {
  readonly port: ProcessPort;
  readonly clock: Clock;
  readonly logDestination?: { write(chunk: string): void };
  readonly loader: () => Promise<SqliteRuntime>;
  readonly jobExecArgv?: readonly string[];
};

type Parts<P> = {
  readonly def: ServiceDefinition<P>;
  readonly o: ServeOptions;
  readonly env: BootstrapEnvelope;
  readonly logger: Logger;
  readonly metrics: MetricsRegistry;
  readonly databases: OpenedDatabases;
  readonly opened: SqlitePort[];
  readonly policies: P | null;
  readonly state: ServiceState;
  readonly runtime: ServeRuntime;
  readonly jobs: JobRunner;
};

export async function serve<P>(def: ServiceDefinition<P>, o: ServeOptions): Promise<ServiceRunResult> {
  const { port, clock } = o;
  let log: Logger | null = null;
  const opened: SqlitePort[] = [];
  const fatal = (exit: ExitCode, code: string): ServiceRunResult => {
    if (port.hasIpc) {
      try {
        port.send(IpcServiceToSupervisor.parse({ type: 'fatal', v: 1, exit_code: exit, code }));
      } catch {
        // supervisor 채널이 이미 닫혔으면 보낼 곳이 없다 — 종료 코드가 전달 수단이다.
      }
    }
    log?.fatal({ event: 'service.fatal', code, exit_code: exit }, 'service fatal');
    for (const db of opened.splice(0)) {
      try {
        db.close();
      } catch {
        // 종료 경로 — 닫기 실패는 무시한다.
      }
    }
    port.exit(exit);
    return { kind: 'exited', code: exit };
  };
  port.onFatal((kind, e) => {
    // STD-ASY-09: 처리되지 않은 거부·예외 = fatal 70.
    log?.fatal({ event: 'process.unhandled', kind, err: e }, 'unhandled');
    fatal(70, 'unhandled');
  });
  if (!port.hasIpc) {
    return fatal(78, 'no_ipc');
  }
  const ipc = createIpcInbox(port);
  const runtime = def.databases.length > 0 ? await o.loader() : null;
  const received = await receiveEnvelope(def, ipc);
  if (!received.ok) {
    return fatal(received.failure.exit, received.failure.code);
  }
  const env = received.value;
  const logger = createLogger(def.svc, {
    level: env.log_level,
    bootId: env.boot_id,
    clock,
    ...(o.logDestination === undefined ? {} : { destination: o.logDestination }),
  });
  log = logger;
  const prepared = prepare(def, o, env, runtime, logger, opened);
  if (!prepared.ok) {
    return fatal(prepared.failure.exit, prepared.failure.code);
  }
  const started = await startServing(prepared.value, ipc);
  if (!started.ok) {
    return fatal(started.failure.exit, started.failure.code);
  }
  return { kind: 'serving', service: started.value };
}

/** 3~6단계: 환경 검사 · DB · 정책. */
function prepare<P>(
  def: ServiceDefinition<P>,
  o: ServeOptions,
  env: BootstrapEnvelope,
  runtime: SqliteRuntime | null,
  logger: Logger,
  opened: SqlitePort[],
): Step<Parts<P>> {
  const checked = checkEnvironment(def, o.port, env);
  if (!checked.ok) {
    return checked;
  }
  const metrics = createMetrics();
  const databases = openDatabases(def, runtime, env, { metrics, log: logger, opened });
  if (!databases.ok) {
    return databases;
  }
  let policies: P | null = null;
  if (def.loadPolicies !== undefined) {
    const loaded = def.loadPolicies({ home: env.home, profile: env.profile });
    if (!loaded.ok) {
      return stepFail(78, `policy_${loaded.error.reason}`);
    }
    policies = loaded.value;
  }
  const state = createServiceState({ ready: false });
  state.integrity = env.flags.after_crash ? (databases.value.quickFailed.length > 0 ? 'failed' : 'pending') : 'ok';
  state.integrityFailedFiles = [...databases.value.quickFailed];
  const jobs = createJobRunner({
    entry: def.entry,
    ...(o.jobExecArgv === undefined ? {} : { execArgv: o.jobExecArgv }),
  });
  const runtimeState: ServeRuntime = {
    relay: null,
    paused: false,
    peerUrls: { ...env.peers },
    shutdown: () => Promise.resolve(),
  };
  return stepOk({
    def,
    o,
    env,
    logger,
    metrics,
    databases: databases.value,
    opened,
    policies,
    state,
    runtime: runtimeState,
    jobs,
  });
}

function peerClients<P>(p: Parts<P>): Partial<Record<ServiceName, PeerClientPort>> {
  const clients: Partial<Record<ServiceName, PeerClientPort>> = {};
  for (const peer of p.def.peers) {
    clients[peer] = createPeerClient({
      self: p.def.svc,
      peer,
      baseUrl: () => p.runtime.peerUrls[peer]?.url ?? null,
      token: p.env.self_token,
      clock: p.o.clock,
      metrics: p.metrics,
    });
  }
  return clients;
}

/** 7단계: 런타임 부품 · 앱 조립 · register. */
async function assemble<P>(p: Parts<P>): Promise<Step<AppInternals>> {
  const rt = p.runtime;
  try {
    return stepOk(
      await assembleApp(p.def, {
        callerTokens: p.env.callers,
        clock: p.o.clock,
        home: p.env.home,
        log: p.logger,
        peers: peerClients(p),
        dbs: p.databases.dbs,
        jobs: p.jobs,
        metrics: p.metrics,
        ready: false,
        relay: {
          pause: (): void => rt.relay?.pause(),
          resume: (): void => rt.relay?.resume(),
          kick: (): void => rt.relay?.kick(),
          collectGauges: (): void => rt.relay?.collectGauges(),
        },
        profile: p.env.profile,
        appVersion: p.env.app_version,
        bootId: p.env.boot_id,
        flags: p.env.flags,
        policies: p.policies,
        state: p.state,
        als: new AsyncLocalStorage<RequestContext>(),
        peerMissing: () => p.def.peers.filter((peer) => rt.peerUrls[peer] === undefined),
        requestShutdown: (graceMs) => {
          void rt.shutdown(graceMs);
        },
        onGateChange: (s) => {
          rt.paused = s === 'closed';
        },
      }),
    );
  } catch (e) {
    p.logger.error({ event: 'service.register.failed', err: e }, 'register failed');
    return stepFail(70, 'register_failed');
  }
}

/** 8단계: 이벤트 생산자면 relay 시작(전송은 relay 전용 `node:http` 클라이언트). */
function startEventRelay<P>(p: Parts<P>, internals: AppInternals): Step<null> {
  const { def, env } = p;
  if (def.events === null) {
    return stepOk(null);
  }
  if (p.databases.fullDb === null) {
    return stepFail(70, 'register_failed');
  }
  const transport = createInboxTransport({
    selfToken: env.self_token,
    baseUrl: (d) => p.runtime.peerUrls[d]?.url ?? null,
  });
  p.runtime.relay = startRelay({
    db: p.databases.fullDb,
    svc: def.svc,
    routing: def.events.routing,
    transport,
    clock: p.o.clock,
    log: p.logger,
    metrics: p.metrics,
  });
  internals.shutdownHooks.push(() => {
    transport.close();
  });
  return stepOk(null);
}

/** 11단계: 크래시 뒤 전체 무결성 검사(detached) — 결과로 무결성 상태를 갱신한다. */
function checkIntegrityAfterCrash<P>(p: Parts<P>): void {
  // detached: 크래시 후 전체 검사
  void p.jobs
    .run('integrity', { level: 'full', home: p.env.home }, { timeoutMs: INTEGRITY_TIMEOUT_MS })
    .then((result) => {
      const parsed = result.ok ? IntegrityResult.safeParse(result.value) : null;
      if (parsed?.success) {
        p.state.integrity = parsed.data.ok ? 'ok' : 'failed';
        p.state.integrityFailedFiles = parsed.data.files
          .filter((f) => f.check !== 'ok' || f.foreign_key_violations > 0)
          .map((f) => f.file);
        return;
      }
      p.state.integrity = 'failed';
      p.state.integrityFailedFiles = [];
      p.logger.error(
        { event: 'integrity.job.failed', kind: result.ok ? 'contract' : result.error.kind },
        'post-crash integrity job failed',
      );
    });
}

/** serve 중 IPC: registry.updated → 피어 URL 교체 · log.level · shutdown · 검증 실패 메시지는 warn 후 무시. 연결 끊김 = 유예 0 종료. */
function wireIpc<P>(p: Parts<P>, ipc: IpcInbox): void {
  ipc.onMessage((m) => {
    const parsed = IpcSupervisorToService.safeParse(m);
    if (!parsed.success) {
      p.logger.warn({ event: 'ipc.invalid' }, 'invalid supervisor message ignored');
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case 'registry.updated':
        p.runtime.peerUrls = { ...msg.peers };
        return;
      case 'log.level':
        p.logger.level = msg.level;
        return;
      case 'shutdown':
        void p.runtime.shutdown(msg.grace_ms);
        return;
      case 'bootstrap':
        p.logger.warn({ event: 'ipc.bootstrap.repeated' }, 'repeated bootstrap ignored');
        return;
    }
  });
  ipc.onDisconnect(() => {
    void p.runtime.shutdown(0); // supervisor 사망 — 유예 0으로 종료한다 [Brief 결정]
  });
}

/** 7~12단계. 실패 시 이미 시작한 relay·앱을 정리한 뒤 실패를 돌려준다. */
async function startServing<P>(p: Parts<P>, ipc: IpcInbox): Promise<Step<RunningService>> {
  const assembled = await assemble(p);
  if (!assembled.ok) {
    return assembled;
  }
  const internals = assembled.value;
  const relayStarted = startEventRelay(p, internals);
  if (!relayStarted.ok) {
    return relayStarted;
  }
  const abort = async (failure: Step<never>): Promise<Step<never>> => {
    await p.runtime.relay?.stop();
    await internals.handle.close();
    return failure;
  };
  const listened = await listenOnLoopback(
    internals.handle.fastify,
    [p.env.listen.port, ...(p.def.portFallbacks ?? []), 0],
    p.logger,
  );
  if (!listened.ok) {
    return abort(listened);
  }
  const { port } = p.o;
  port.send(IpcServiceToSupervisor.parse({ type: 'listening', v: 1, port: listened.value }));
  port.send(
    IpcServiceToSupervisor.parse({
      type: 'ready',
      v: 1,
      contracts_hash: p.def.contractsHash ?? p.env.contracts_hash,
      schema_versions: p.databases.schemaVersions,
      app_version: p.env.app_version,
    }),
  );
  p.state.ready = true;
  if (p.env.flags.after_crash) {
    checkIntegrityAfterCrash(p);
  }
  const timers = startMaintenanceTimers({
    clock: p.o.clock,
    log: p.logger,
    fullDb: p.databases.fullDb,
    writeDbs: p.opened,
    isPaused: () => p.runtime.paused,
  });
  p.runtime.shutdown = createShutdown({
    state: p.state,
    relay: p.runtime.relay === null ? null : () => p.runtime.relay,
    stopTimers: () => timers.stop(),
    hooks: internals.shutdownHooks,
    jobs: p.jobs,
    writeDbs: p.opened,
    closeApp: () => internals.handle.close(),
    exit: (code) => port.exit(code),
    log: p.logger,
  });
  wireIpc(p, ipc);
  return stepOk({
    port: listened.value,
    app: internals.handle,
    shutdown: (graceMs: number) => p.runtime.shutdown(graceMs),
  });
}
