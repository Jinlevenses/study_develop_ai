import { AsyncLocalStorage } from 'node:async_hooks';
import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import type { ServiceName } from '@fathom/contracts/common/ids';
import type { RouteDef } from '@fathom/contracts/common/route';
import { createCallerAuth } from '@fathom/shared-kernel/auth/auth';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import { createJobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { Logger } from '@fathom/shared-kernel/log/log';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { createMetrics } from '@fathom/shared-kernel/metrics/metrics';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify, { LogController } from 'fastify';
import type { InboxProcessor } from '../eventing/inbox.js';
import { inboxPlugin } from '../eventing/inbox.js';
import type { Outbox } from '../eventing/outbox.js';
import { createOutbox } from '../eventing/outbox.js';
import type { IdempotencyStore } from '../idempotency/idempotency.js';
import { createIdempotencyStore } from '../idempotency/idempotency.js';
import { registerAdminRoutes } from './admin-routes.js';
import { registerCommonRoutes } from './common-routes.js';
import type { Pipeline, RequestContext } from './pipeline.js';
import { genRequestId, installPipeline } from './pipeline.js';
import { buildErrorRegistry } from './problem.js';
import type { EventLoopProbe } from './process-port.js';
import { startEventLoopProbe } from './process-port.js';
import { toFastifyPath } from './route-path.js';
import type { InternalHandler, InternalStreamHandler } from './route-runner.js';
import { createRouteRunner } from './route-runner.js';
import type { ServiceState } from './service-state.js';
import { createServiceState } from './service-state.js';
import type {
  RouteContext,
  RouteReply,
  ServiceApp,
  ServiceAppHandle,
  ServiceAppRuntime,
  ServiceDefinition,
  ServiceDeps,
} from './types.js';
import type { WriteGate } from './write-gate.js';
import { createWriteGate } from './write-gate.js';

// §4.4 앱 조립 — Fastify 인스턴스·훅·공통/admin 라우트·`def.register`. listen·IPC는 하지 않는다(boot.ts).
// buildServiceApp = 테스트·계약 하네스의 입구, createService = 같은 조립 + IPC·DB·relay.

const ADMIN_SERVICES: ReadonlySet<ServiceName> = new Set<ServiceName>(['content', 'learning', 'ai-gateway']);
const SHUTDOWN_SERVICES: ReadonlySet<ServiceName> = new Set<ServiceName>([
  'gateway',
  'content',
  'learning',
  'ai-gateway',
]);
const BODY_LIMIT_BYTES = 262_144;
const MAX_PARAM_LENGTH = 512;
const NDJSON = 'application/x-ndjson';

/** createService가 더하는 런타임 값(없으면 buildServiceApp이 기본값을 채운다). */
export type AssembleExtras<P> = {
  readonly profile?: RuntimeProfile;
  readonly appVersion?: string;
  readonly bootId?: string;
  readonly flags?: ServiceDeps<P>['flags'];
  readonly policies?: P | null;
  readonly state?: ServiceState;
  readonly als?: AsyncLocalStorage<RequestContext>;
  readonly peerMissing?: () => readonly ServiceName[];
  readonly requestShutdown?: (graceMs: number) => void;
  readonly onGateChange?: (s: 'open' | 'closed') => void;
  /** 테스트 전용: 쓰기 게이트의 대기·자동 재개 시간(기본 3s·60s). */
  readonly gate?: { readonly waitMs?: number; readonly autoReopenMs?: number };
};
export type AppInternals = {
  readonly handle: ServiceAppHandle;
  readonly state: ServiceState;
  readonly gate: WriteGate;
  readonly outbox: Outbox | null;
  readonly inbox: InboxProcessor | null;
  readonly idempotency: IdempotencyStore;
  readonly shutdownHooks: (() => void | Promise<void>)[];
  readonly probe: EventLoopProbe;
  readonly jobs: JobRunner;
  readonly log: Logger;
  readonly dbs: Readonly<Record<string, SqlitePort>>;
  readonly pipeline: Pipeline;
};

/** 핸들러의 라우트별 타입은 등록 시점에 이미 검증된 파트(`safeParse`)를 가리키므로 이 한 곳에서만 좁힌다. */
function narrowHandler<R extends RouteDef, S extends keyof R['response'] & number>(
  handler: (ctx: RouteContext<R>) => Promise<RouteReply<R, S>>,
): InternalHandler {
  return handler as unknown as InternalHandler;
}
function narrowStreamHandler<R extends RouteDef>(
  handler: (ctx: RouteContext<R>, reply: FastifyReply) => Promise<void>,
): InternalStreamHandler {
  return handler as unknown as InternalStreamHandler;
}

function fullDatabase<P>(def: ServiceDefinition<P>): { file: string } | null {
  const fulls = def.databases.filter((d) => d.profile === 'full');
  if (fulls.length > 1) {
    throw new Error('invariant: a service may declare at most one full database');
  }
  return fulls[0] ?? null;
}

type RouteRecord = { method: string; url: string };

/** Fastify 인스턴스(고정 옵션) · onRoute 수집 · 콘텐츠 파서 구성. `routes`는 `registeredRoutes()`의 원천이다. */
function createFastify(log: Logger): { fastify: FastifyInstance; routes: RouteRecord[] } {
  const frameworkLog: FastifyBaseLogger = log; // pino Logger → Fastify 기본 로거 타입(app.fastify가 `FastifyInstance` 기본형이 되도록)
  const fastify: FastifyInstance = Fastify({
    loggerInstance: frameworkLog,
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'req_id' }),
    genReqId: genRequestId,
    bodyLimit: BODY_LIMIT_BYTES,
    onProtoPoisoning: 'error',
    onConstructorPoisoning: 'error',
    return503OnClosing: true,
    forceCloseConnections: 'idle',
    routerOptions: { maxParamLength: MAX_PARAM_LENGTH },
  });
  const routes: RouteRecord[] = [];
  fastify.addHook('onRoute', (opts) => {
    for (const method of Array.isArray(opts.method) ? opts.method : [opts.method]) {
      routes.push({ method, url: opts.url });
    }
  });
  fastify.removeContentTypeParser('text/plain');
  fastify.addContentTypeParser(
    NDJSON,
    (_req: FastifyRequest, payload: unknown, done: (err: Error | null, body?: unknown) => void) => {
      done(null, payload);
    },
  );
  return { fastify, routes };
}

function isStreamRoute(route: RouteDef): boolean {
  return route.responseKind === 'sse' || route.responseKind === 'ndjson' || route.request.bodyKind === 'ndjson';
}

/** `app.route()`·`app.stream()` — 등록 시점 검사(공개 라우트 인증 훅·스트림 구분)와 라우트 실행기 연결. */
function createServiceApi<P>(
  def: ServiceDefinition<P>,
  fastify: FastifyInstance,
  runner: ReturnType<typeof createRouteRunner>,
): ServiceApp {
  const requireRegistrable = (route: RouteDef): void => {
    if (route.path.startsWith('/api/') && def.publicAuth === undefined) {
      throw new Error(`invariant: ${route.id} is a public route but the service has no publicAuth hook`);
    }
  };
  const routeOptions = (route: RouteDef): { bodyLimit?: number } =>
    route.bodyLimitBytes === undefined ? {} : { bodyLimit: route.bodyLimitBytes };
  return {
    fastify,
    route(route, handler): void {
      requireRegistrable(route);
      if (isStreamRoute(route)) {
        throw new Error(`invariant: ${route.id} streams — register it with app.stream()`);
      }
      const internal = narrowHandler(handler);
      fastify.route({
        method: route.method,
        url: toFastifyPath(route.path),
        config: { route },
        ...routeOptions(route),
        handler: (req: FastifyRequest, reply: FastifyReply) => runner.runJson(route, internal, req, reply),
      });
    },
    stream(route, handler): void {
      requireRegistrable(route);
      if (!isStreamRoute(route)) {
        throw new Error(`invariant: ${route.id} does not stream — register it with app.route()`);
      }
      const internal = narrowStreamHandler(handler);
      fastify.route({
        method: route.method,
        url: toFastifyPath(route.path),
        config: { route },
        ...routeOptions(route),
        handler: (req: FastifyRequest, reply: FastifyReply) => runner.runStream(route, internal, req, reply),
      });
    },
  };
}

export async function assembleApp<P>(
  def: ServiceDefinition<P>,
  rt: ServiceAppRuntime & AssembleExtras<P>,
): Promise<AppInternals> {
  const clock = rt.clock;
  const log =
    rt.log ?? createLogger(def.svc, { level: 'warn', bootId: null, clock, destination: { write(): void {} } });
  const metrics = rt.metrics ?? createMetrics();
  const dbs = rt.dbs ?? {};
  const fullDef = fullDatabase(def);
  const fullDb = fullDef === null ? null : (dbs[fullDef.file] ?? null);
  if (fullDef !== null && fullDb === null) {
    throw new Error(`invariant: ${def.svc} declares ${fullDef.file} but no connection was provided`);
  }
  const als = rt.als ?? new AsyncLocalStorage<RequestContext>();
  const state = rt.state ?? createServiceState({ ready: rt.ready ?? true });
  const jobs = rt.jobs ?? createJobRunner({ entry: def.entry });
  const peers = rt.peers ?? {};
  const shutdownHooks: (() => void | Promise<void>)[] = [];
  const probe = startEventLoopProbe();

  const gate = createWriteGate({
    clock,
    ...(rt.gate?.waitMs === undefined ? {} : { waitMs: rt.gate.waitMs }),
    ...(rt.gate?.autoReopenMs === undefined ? {} : { autoReopenMs: rt.gate.autoReopenMs }),
    onChange: (s) => {
      if (s === 'closed') {
        rt.relay?.pause();
      } else {
        rt.relay?.resume();
      }
      rt.onGateChange?.(s);
    },
    onAutoReopen: () => {
      log.warn({ event: 'admin.quiesce.auto_reopened' }, 'quiesce auto reopened');
    },
  });

  const { fastify, routes } = createFastify(log);
  const registry = buildErrorRegistry(def.svc, def.errors);
  const pipeline = installPipeline(fastify, {
    svc: def.svc,
    clock,
    log,
    metrics,
    auth: createCallerAuth(rt.callerTokens),
    state,
    registry,
    publicAuth: def.publicAuth,
    als,
  });
  const idempotency = createIdempotencyStore({ db: fullDb, clock });
  const runner = createRouteRunner({ svc: def.svc, pipeline, gate, idempotency, als, log });

  const app = createServiceApi(def, fastify, runner);

  const outbox = def.events === null ? null : buildOutbox(def, rt, fullDb, als);
  const inbox = def.inbox === null ? null : inboxPlugin(def.inbox, { db: fullDb, clock, log, metrics });
  const appVersion = rt.appVersion ?? '0.0.0';
  const bootId = rt.bootId ?? ulid();
  const peerMissing = rt.peerMissing ?? ((): readonly ServiceName[] => def.peers.filter((p) => peers[p] === undefined));

  registerCommonRoutes({
    def,
    app,
    state,
    clock,
    log,
    metrics,
    bootId,
    appVersion,
    startedAt: clock.now(),
    peerMissing,
    relay: rt.relay ?? null,
    probe,
    inbox,
  });
  registerAdminRoutes(
    {
      def,
      app,
      clock,
      log,
      metrics,
      home: rt.home,
      gate,
      jobs,
      fullDb,
      requestShutdown: rt.requestShutdown ?? ((): void => undefined),
    },
    { withState: ADMIN_SERVICES.has(def.svc), withShutdown: SHUTDOWN_SERVICES.has(def.svc) },
  );
  if (ADMIN_SERVICES.has(def.svc) && fullDb === null) {
    throw new Error(`invariant: ${def.svc} serves admin routes but has no full database`);
  }

  await def.register(app, {
    svc: def.svc,
    home: rt.home,
    profile: rt.profile ?? 'test',
    appVersion,
    bootId,
    flags: rt.flags ?? { safe_mode: false, batch_enabled: false, after_crash: false },
    clock,
    log,
    metrics,
    dbs,
    outbox,
    peers,
    jobs,
    policies: rt.policies ?? null,
    onShutdown(fn: () => void | Promise<void>): void {
      shutdownHooks.push(fn);
    },
  });
  await fastify.ready();

  const ownsJobs = rt.jobs === undefined;
  const handle: ServiceAppHandle = {
    fastify,
    registeredRoutes: () => routes.filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS').map((r) => ({ ...r })),
    async close(): Promise<void> {
      await fastify.close();
      probe.stop();
      if (ownsJobs) {
        await jobs.shutdown();
      }
    },
  };
  return { handle, state, gate, outbox, inbox, idempotency, shutdownHooks, probe, jobs, log, dbs, pipeline };
}

function buildOutbox<P>(
  def: ServiceDefinition<P>,
  rt: ServiceAppRuntime & AssembleExtras<P>,
  fullDb: SqlitePort | null,
  als: AsyncLocalStorage<RequestContext>,
): Outbox {
  if (fullDb === null || def.events === null) {
    throw new Error('invariant: an event producer needs a full database');
  }
  return createOutbox({
    db: fullDb,
    svc: def.svc,
    clock: rt.clock,
    payloads: def.events.payloads,
    currentTraceparent: () => als.getStore()?.traceparent ?? null,
    onAppended: () => {
      rt.relay?.kick();
    },
  });
}

export async function buildServiceApp<P>(def: ServiceDefinition<P>, rt: ServiceAppRuntime): Promise<ServiceAppHandle> {
  const internals = await assembleApp(def, rt);
  return internals.handle;
}
