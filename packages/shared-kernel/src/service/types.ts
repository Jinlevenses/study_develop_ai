import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import type { ErrorRegistry } from '@fathom/contracts/common/errors';
import type { CallerName, ServiceName } from '@fathom/contracts/common/ids';
import type { RouteDef } from '@fathom/contracts/common/route';
import type { AppError, Result } from '@fathom/shared-kernel/errors/errors';
import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import type { JobDefinition, JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { PolicyLoadFailure } from '@fathom/shared-kernel/policy/policy';
import type { MigrationDir, SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { InboxConfig } from '../eventing/inbox.js';
import type { EventPayloadRegistry, Outbox } from '../eventing/outbox.js';
import type { Relay, RelayRouting } from '../eventing/relay.js';
import type { SqliteRuntime } from './sqlite-loader.js';

// ARC-01 §17.3 `service` · Brief §4.3.0 / §4.4 — 서비스 정의와 런타임 타입.

export type ServiceDatabase = {
  /** `^[a-z][a-z-]*\.db$` */
  readonly file: string;
  readonly applicationId: number;
  readonly profile: 'meta' | 'full';
  readonly synchronous: 'NORMAL' | 'FULL';
  readonly recursiveTriggers: boolean;
  /** `_infra` 제외, 적용 순서. */
  readonly migrations: readonly MigrationDir[];
};

export type PublicAuthHook = (req: {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly method: string;
  readonly url: string;
}) => Promise<Result<'browser' | 'cli', AppError>>;

/** `--mode=verify` 훅에 넘기는 맥락([Brief 결정] 가산 — Brief는 이름만 정했다). */
export type ModeContext = {
  readonly svc: ServiceName;
  readonly home: string;
  readonly replay: boolean;
  readonly dbCopyDir: string | null;
  readonly log: Logger;
  readonly clock: Clock;
  readonly runtime: () => Promise<SqliteRuntime>;
};

export type ServiceDefinition<P = null> = {
  readonly svc: ServiceName;
  /** 자기 main 파일 절대 경로 — job fork 대상. */
  readonly entry: string;
  readonly contractsHash: string | null;
  /** gateway = []; profile 'full'은 최대 1개(= eventing·snapshot·integrity 대상). */
  readonly databases: readonly ServiceDatabase[];
  /** 호출할 피어(= readyz peers 검사 대상). */
  readonly peers: readonly ServiceName[];
  /** 생산자만. */
  readonly events: { readonly payloads: EventPayloadRegistry; readonly routing: RelayRouting } | null;
  readonly inbox: InboxConfig | null;
  /** 서비스 고유 코드(공통 17개는 자동 포함). */
  readonly errors?: ErrorRegistry;
  readonly loadPolicies?: (ctx: {
    readonly home: string;
    readonly profile: RuntimeProfile;
  }) => Result<P, PolicyLoadFailure>;
  /** gateway만: /api/v1/* 인증. */
  readonly publicAuth?: PublicAuthHook;
  /** gateway: 4748~4756(dev 4848~4856). */
  readonly portFallbacks?: readonly number[];
  /** 같은 이름이면 기본 snapshot·integrity를 대체한다. */
  readonly jobs?: readonly JobDefinition[];
  /** learning: projection_hash·fsrs_impl·ledger_head. */
  readonly snapshotExtras?: (copy: SqlitePort) => Readonly<Record<string, unknown>>;
  readonly restoreCheck?: (
    db: SqlitePort,
    ctx: { readonly from: string },
  ) => Result<null, { readonly code: string; readonly detail: string }>;
  /** learning만(IT-03). 없으면 `--mode=verify` = 64. */
  readonly verify?: (ctx: ModeContext) => Promise<number>;
  /** `app.ts`의 `register<Bc>()` 나열. */
  readonly register: (app: ServiceApp, deps: ServiceDeps<P>) => void | Promise<void>;
};

/** 정책 타입 `P`에 의존하지 않는 부분 — 모드 실행기·기본 job·공통 라우트가 읽는다(`ServiceDefinition<P>`는 모두 이 모양을 만족한다). */
export type ServiceDefinitionBase = Omit<ServiceDefinition<unknown>, 'register' | 'loadPolicies'>;

export type ServiceDeps<P> = {
  readonly svc: ServiceName;
  readonly home: string;
  readonly profile: RuntimeProfile;
  readonly appVersion: string;
  readonly bootId: string;
  readonly flags: { readonly safe_mode: boolean; readonly batch_enabled: boolean; readonly after_crash: boolean };
  readonly clock: Clock;
  readonly log: Logger;
  readonly metrics: MetricsRegistry;
  /** 키 = DB 파일 이름(`learning.db`). */
  readonly dbs: Readonly<Record<string, SqlitePort>>;
  readonly outbox: Outbox | null;
  readonly peers: Readonly<Partial<Record<ServiceName, PeerClientPort>>>;
  readonly jobs: JobRunner;
  readonly policies: P | null;
  onShutdown(fn: () => void | Promise<void>): void;
};

// ───────── 라우트 컨텍스트 ─────────

type PartOf<Req, K extends string> =
  Req extends Record<K, infer S> ? (S extends z.ZodType ? z.output<S> : undefined) : undefined;
export type ReqPart<R extends RouteDef, K extends 'params' | 'query' | 'body'> = PartOf<R['request'], K>;

export type RouteContext<R extends RouteDef> = {
  readonly params: ReqPart<R, 'params'>;
  readonly query: ReqPart<R, 'query'>;
  readonly body: ReqPart<R, 'body'>;
  readonly caller: CallerName;
  readonly requestId: string;
  readonly traceparent: string;
  readonly deadlineAt: number;
  readonly idempotencyKey: string | null;
  readonly log: Logger;
  readonly raw: FastifyRequest;
};
/**
 * `S`는 호출부에서 반환 리터럴로 추론된다 — async 블록 본문 핸들러의 `status: 200`이 `number`로 넓어지는 TS 7의 추론 문제를 피하고,
 * 선언되지 않은 상태 코드는 제약(`keyof R['response']`)으로 컴파일 시점에 막는다.
 */
export type RouteReply<R extends RouteDef, S extends keyof R['response'] & number = keyof R['response'] & number> = {
  readonly status: S;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};

export interface ServiceApp {
  /** json·text. */
  route<R extends RouteDef, S extends keyof R['response'] & number>(
    route: R,
    handler: (ctx: RouteContext<R>) => Promise<RouteReply<R, S>>,
  ): void;
  /** `responseKind` 'sse'|'ndjson' 또는 `bodyKind` 'ndjson'. */
  stream<R extends RouteDef>(route: R, handler: (ctx: RouteContext<R>, reply: FastifyReply) => Promise<void>): void;
  /** gateway의 정적 파일·프록시·rate-limit 플러그인용 탈출구(라우트 등록에는 쓰지 않는다 — STD-API-01). */
  readonly fastify: FastifyInstance;
}

export type ServiceAppRuntime = {
  readonly callerTokens: Readonly<Partial<Record<ServiceName, string>>>;
  readonly clock: Clock;
  readonly home: string;
  /** 기본 = `createLogger(svc, {level:'warn', bootId: null, clock, destination: {write(){}}})`. */
  readonly log?: Logger;
  /** 기본 {}. */
  readonly peers?: Readonly<Partial<Record<ServiceName, PeerClientPort>>>;
  /** 기본 {}; def에 full DB가 있는데 없으면 invariant. */
  readonly dbs?: Readonly<Record<string, SqlitePort>>;
  /** 기본 `createJobRunner({entry: def.entry})`. */
  readonly jobs?: JobRunner;
  /** 기본 없음(buildServiceApp은 relay·타이머를 시작하지 않는다). */
  readonly relay?: Pick<Relay, 'pause' | 'resume' | 'kick' | 'collectGauges'>;
  /** 기본 true. */
  readonly ready?: boolean;
  /** 기본 `createMetrics()`. */
  readonly metrics?: MetricsRegistry;
};

export interface ServiceAppHandle {
  readonly fastify: FastifyInstance;
  registeredRoutes(): ReadonlyArray<{ method: string; url: string }>;
  close(): Promise<void>;
}

export interface RunningService {
  readonly port: number;
  readonly app: ServiceAppHandle;
  shutdown(graceMs: number): Promise<void>;
}
export type ServiceRunResult =
  | { readonly kind: 'serving'; readonly service: RunningService }
  | { readonly kind: 'exited'; readonly code: number };
