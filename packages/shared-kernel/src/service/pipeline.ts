import type { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { ErrorRegistry } from '@fathom/contracts/common/errors';
import type { CallerName, ServiceName } from '@fathom/contracts/common/ids';
import type { RouteDef } from '@fathom/contracts/common/route';
import type { CallerAuth } from '@fathom/shared-kernel/auth/auth';
import { checkInternalAccess } from '@fathom/shared-kernel/auth/auth';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import { isUlid, ulid } from '@fathom/shared-kernel/ids/ids';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { classOfUrl, isNonCanonicalTarget, type RouteClass, routeClassOf } from './canonical-path.js';
import type { ProblemResult } from './problem.js';
import { appErrorCode, mapFramework, toProblem } from './problem.js';
import type { ServiceState } from './service-state.js';
import type { PublicAuthHook } from './types.js';

// §4.4 요청 파이프라인 1~6단계(request id·traceparent·no-store·종료/준비 게이트·인증·데드라인)는 `onRequest` 훅에서, 오류·404·span은
// 전역 처리기에서 한다. 7~13단계(쓰기 게이트·멱등·검증·핸들러)는 라우트마다 `route-runner.ts`가 한다.

export type RequestContext = { readonly traceparent: string; readonly requestId: string };
export type ReqState = {
  readonly recvAt: number;
  readonly startPerf: number;
  readonly requestId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly traceparent: string;
  readonly log: Logger;
  route: RouteDef | null;
  caller: CallerName;
  deadlineAt: number;
  entered: boolean;
};
export type PipelineDeps = {
  readonly svc: ServiceName;
  readonly clock: Clock;
  readonly log: Logger;
  readonly metrics: MetricsRegistry;
  readonly auth: CallerAuth;
  readonly state: ServiceState;
  readonly registry: ErrorRegistry;
  readonly publicAuth: PublicAuthHook | undefined;
  readonly als: AsyncLocalStorage<RequestContext>;
};
export interface Pipeline {
  stateOf(req: FastifyRequest): ReqState;
  /** 오류를 problem+json으로 응답한다. 이미 응답이 나갔으면 로그만 남긴다. */
  replyProblem(req: FastifyRequest, reply: FastifyReply, e: unknown): ProblemResult;
  /** 요청을 in-flight에서 뺀다(멱등). hijack한 스트림 요청은 응답이 열려 있어도 종료 대기(waitIdle)를 막지 않도록 호출한다(NFR-AVL-004). */
  release(req: FastifyRequest): void;
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/;
const DEFAULT_DEADLINE_MS = 2000;
const MAX_DEADLINE_MS = 600_000;
const DURATION_BUCKETS_MS: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

export function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

export function isRouteDef(x: unknown): x is RouteDef {
  return typeof x === 'object' && x !== null && 'id' in x && 'method' in x && 'path' in x && 'request' in x;
}

/** 유효한 traceparent면 같은 trace id + 새 span id + 같은 flags, 아니면 새 루트(flags 01). */
function nextTrace(incoming: unknown): { traceparent: string; traceId: string; spanId: string } {
  const spanId = randomBytes(8).toString('hex');
  const match = typeof incoming === 'string' ? TRACEPARENT_RE.exec(incoming) : null;
  const traceId = match?.[1] ?? randomBytes(16).toString('hex');
  const flags = match?.[3] ?? '01';
  return { traceparent: `00-${traceId}-${spanId}-${flags}`, traceId, spanId };
}

/** `genReqId`: `/internal/` + 유효 ULID `x-request-id`면 그 값, 아니면 새 ULID(`/api/`는 항상 새 값 — IF-01 §2.2). */
export function genRequestId(raw: {
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, unknown>>;
}): string {
  const header = raw.headers['x-request-id'];
  if (pathOf(raw.url ?? '').startsWith('/internal/') && typeof header === 'string' && isUlid(header)) {
    return header;
  }
  return ulid();
}

function parseDeadline(header: unknown, recvAt: number, svc: ServiceName, routeDeadline: number | undefined): number {
  if (header === undefined) {
    return recvAt + (routeDeadline ?? DEFAULT_DEADLINE_MS);
  }
  const text = Array.isArray(header) ? header.join(',') : String(header);
  if (/^-\d+$/.test(text) || /^0+$/.test(text)) {
    throw new AppError(appErrorCode(svc, 'DEP-902'), 504, '데드라인이 이미 소진됐다.');
  }
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DEADLINE_MS) {
    throw new AppError(appErrorCode(svc, 'VAL-900'), 400, 'x-fathom-deadline-ms가 올바르지 않다.', {
      extra: { errors: [{ path: 'x-fathom-deadline-ms', message: '1~600000 정수여야 한다', rule: 'deadline_header' }] },
    });
  }
  return recvAt + value;
}

export function installPipeline(fastify: FastifyInstance, deps: PipelineDeps): Pipeline {
  const states = new WeakMap<FastifyRequest, ReqState>();
  const durations = deps.metrics.histogram('http_request_duration_ms', 'HTTP 요청 처리 시간(ms)', DURATION_BUCKETS_MS, [
    'route',
    'status',
  ]);

  const stateOf = (req: FastifyRequest): ReqState => {
    const st = states.get(req);
    if (st === undefined) {
      throw new Error('invariant: request state missing (onRequest hook did not run)');
    }
    return st;
  };

  function replyProblem(req: FastifyRequest, reply: FastifyReply, e: unknown): ProblemResult {
    const mapped = mapFramework(e, deps.svc);
    const problem = toProblem(mapped, {
      svc: deps.svc,
      requestId: req.id,
      instance: req.url,
      registry: deps.registry,
      newId: ulid,
    });
    const log = states.get(req)?.log ?? deps.log;
    const fields: Record<string, unknown> = { event: 'http.error', error_id: problem.errorId, code: problem.body.code };
    if (mapped instanceof Error) {
      fields.err = mapped;
    }
    log[problem.level](fields, problem.logMsg);
    if (!reply.sent) {
      reply.code(problem.status).type('application/problem+json');
      if (problem.status === 503 || problem.status === 504) {
        reply.header('retry-after', '1');
      }
      void reply.send(JSON.stringify(problem.body));
    }
    return problem;
  }

  fastify.addHook('onRequest', async (req, reply) => {
    const recvAt = deps.clock.now();
    const trace = nextTrace(req.headers.traceparent);
    const config: unknown = req.routeOptions.config;
    const route =
      typeof config === 'object' && config !== null && 'route' in config && isRouteDef(config.route)
        ? config.route
        : null;
    // 분류(cache-control·health 판정·데드라인·인증)는 일치한 라우트의 선언 경로만 기준으로 한다 — 원문 `req.url` 접두 비교 0(NFR-SEC-003).
    // 라우트가 없으면(404) 디코딩 경로로 cache-control 등급만 정한다.
    const cls: RouteClass = route === null ? classOfUrl(req.url) : routeClassOf(route.path);
    const st: ReqState = {
      recvAt,
      startPerf: performance.now(),
      requestId: req.id,
      ...trace,
      log: deps.log.child({ req_id: req.id }),
      route,
      caller: deps.svc,
      deadlineAt: recvAt + DEFAULT_DEADLINE_MS,
      entered: true,
    };
    states.set(req, st);
    deps.state.enterRequest();
    reply.header('x-request-id', req.id);
    if (cls === 'api' || cls === 'internal') {
      reply.header('cache-control', 'no-store');
    }
    // 비정준 요청 대상(인코딩 접두·비예약 문자 인코딩·absolute-form·asterisk-form)은 인증·핸들러에 닿기 전에 404로 거절한다.
    if (isNonCanonicalTarget(req.url)) {
      throw new AppError(appErrorCode(deps.svc, 'NOTFOUND-900'), 404, '정의되지 않은 경로다.');
    }
    if (cls === 'internal' && !isUlid(req.headers['x-request-id'])) {
      st.log.warn({ event: 'http.request_id.missing' }, 'x-request-id missing or invalid');
    }
    const health = cls === 'health';
    if (!health && deps.state.shuttingDown) {
      throw new AppError(appErrorCode(deps.svc, 'DEP-900'), 503, '종료 중이다.');
    }
    if (!health && !deps.state.ready && route?.id !== 'common.metrics.get') {
      throw new AppError(appErrorCode(deps.svc, 'DEP-901'), 503, '준비되지 않았다.');
    }
    if (route === null) {
      return;
    }
    if (!health) {
      await authenticate(req, route, st, cls);
    }
    // 공개(/api) 요청의 데드라인은 서버가 정한다 — 헤더는 서비스 간 홉(내부·health)에서만 읽는다.
    st.deadlineAt =
      cls === 'api'
        ? recvAt + (route.deadlineMs ?? DEFAULT_DEADLINE_MS)
        : parseDeadline(req.headers['x-fathom-deadline-ms'], recvAt, deps.svc, route.deadlineMs);
  });

  async function authenticate(req: FastifyRequest, route: RouteDef, st: ReqState, cls: RouteClass): Promise<void> {
    // 인증 등급은 원문 req.url이 아니라 일치한 라우트의 선언 경로로 정한다 — find-my-way는 %XX 디코딩·절대형 대상(RFC 9112 3.2.2)을
    // 라우팅하지만 원문 접두어는 그대로라 `/%69nternal/…`·`GET http://host/internal/…`이 인증을 건너뛰었다(INT-1a, T-00-12 보안 에스컬레이션).
    // 비정준 대상은 onRequest 맨 앞에서 이미 404로 거절됐다.
    if (cls === 'internal') {
      const who = checkInternalAccess(deps.auth, req.headers.authorization, route.allowedCallers);
      if (!who.ok) {
        const ok401 = who.error.status === 401;
        throw new AppError(
          appErrorCode(deps.svc, who.error.suffix),
          who.error.status,
          ok401 ? '호출자 토큰이 없거나 무효다.' : '허용되지 않은 호출자다.',
        );
      }
      st.caller = who.value;
      return;
    }
    if (cls === 'api') {
      if (deps.publicAuth === undefined) {
        throw new Error('invariant: /api route served without a publicAuth hook');
      }
      const result = await deps.publicAuth({ headers: req.headers, method: req.method, url: req.url });
      if (!result.ok) {
        throw result.error;
      }
      // 공개 라우트도 선언한 호출자(browser·cli)만 받는다(STD-SEC-20, IF-01 §2.11).
      if (!route.allowedCallers.includes(result.value)) {
        throw new AppError(appErrorCode(deps.svc, 'ACL-900'), 403, '허용되지 않은 호출자다.');
      }
      st.caller = result.value;
    }
  }

  const leave = (req: FastifyRequest): void => {
    const st = states.get(req);
    if (st?.entered) {
      st.entered = false;
      deps.state.leaveRequest();
    }
  };
  fastify.addHook('onRequestAbort', (req, done) => {
    leave(req);
    done();
  });
  fastify.addHook('onResponse', (req, reply, done) => {
    const st = states.get(req);
    if (st !== undefined) {
      const status = reply.statusCode;
      const dur = Math.max(0, Math.round(performance.now() - st.startPerf));
      const route = st.route?.id ?? 'unmatched';
      durations.observe(dur, { route, status: String(status) });
      st.log.info(
        {
          event: 'span',
          'http.route': route,
          'http.status': status,
          dur_ms: dur,
          outcome: status < 400 ? 'ok' : status < 500 ? 'client_error' : 'server_error',
          trace_id: st.traceId,
          span_id: st.spanId,
        },
        'span',
      );
    }
    leave(req);
    done();
  });

  fastify.setErrorHandler((error, req, reply) => {
    replyProblem(req, reply, error);
  });
  fastify.setNotFoundHandler((req, reply) => {
    replyProblem(req, reply, new AppError(appErrorCode(deps.svc, 'NOTFOUND-900'), 404, '정의되지 않은 경로다.'));
  });

  return { stateOf, replyProblem, release: leave };
}
