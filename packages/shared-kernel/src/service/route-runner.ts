import type { AsyncLocalStorage } from 'node:async_hooks';
import type { ServiceName } from '@fathom/contracts/common/ids';
import type { RouteDef } from '@fathom/contracts/common/route';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import { isUlid } from '@fathom/shared-kernel/ids/ids';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { IdempotencyStore, IdemScope } from '../idempotency/idempotency.js';
import { requestHash } from '../idempotency/idempotency.js';
import type { Pipeline, ReqState, RequestContext } from './pipeline.js';
import { appErrorCode, isHygienic } from './problem.js';
import type { WriteGate } from './write-gate.js';

// §4.4 7~13단계 — 쓰기 게이트 · 멱등 키 · 검증(NFC) · 멱등 조회 · 핸들러 · 응답 검증 · 멱등 저장.

/** 라우트 핸들러의 내부 모양(파트는 zod 검증을 거친 값이라 여기서는 `unknown`). */
export type InternalContext = {
  readonly params: unknown;
  readonly query: unknown;
  readonly body: unknown;
  readonly caller: ReqState['caller'];
  readonly requestId: string;
  readonly traceparent: string;
  readonly deadlineAt: number;
  readonly idempotencyKey: string | null;
  readonly log: Logger;
  readonly raw: FastifyRequest;
};
export type InternalReply = {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
};
export type InternalHandler = (ctx: InternalContext) => Promise<InternalReply>;
export type InternalStreamHandler = (ctx: InternalContext, reply: FastifyReply) => Promise<void>;

export type RunnerDeps = {
  readonly svc: ServiceName;
  readonly pipeline: Pipeline;
  readonly gate: WriteGate;
  readonly idempotency: IdempotencyStore;
  readonly als: AsyncLocalStorage<RequestContext>;
  readonly log: Logger;
};

const MAX_NFC_DEPTH = 32;
const MAX_FIELD_ERRORS = 50;
const NO_GATE_PREFIXES: readonly string[] = ['common.admin.', 'common.health.', 'common.metrics.'];
const TEXT_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function validation(svc: ServiceName, errors: { path: string; message: string; rule: string }[]): AppError {
  return new AppError(appErrorCode(svc, 'VAL-900'), 400, '요청이 스키마를 위반했다.', {
    extra: { errors: errors.slice(0, MAX_FIELD_ERRORS) },
  });
}

/** STD-API-35: 문자열 값 전부 NFC. 원 객체는 바꾸지 않고 복사본을 돌려준다(깊이 ≤ 32). */
export function nfcDeep(value: unknown, svc: ServiceName, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (depth >= MAX_NFC_DEPTH) {
    throw validation(svc, [{ path: '', message: '중첩이 너무 깊다', rule: 'depth' }]);
  }
  if (Array.isArray(value)) {
    return value.map((v): unknown => nfcDeep(v, svc, depth + 1));
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = nfcDeep(Reflect.get(value, key), svc, depth + 1);
  }
  return out;
}

type Parts = { params: unknown; query: unknown; body: unknown };

function issuesOf(error: z.ZodError): { path: string; message: string; rule: string }[] {
  return error.issues.slice(0, MAX_FIELD_ERRORS).map((issue) => ({
    path: issue.path.map(String).join('.').slice(0, 200),
    message: isHygienic(issue.message) ? issue.message.slice(0, 300) : 'invalid',
    rule: issue.code.slice(0, 60),
  }));
}

function validateParts(route: RouteDef, req: FastifyRequest, svc: ServiceName): Parts {
  const errors: { path: string; message: string; rule: string }[] = [];
  const out: Parts = { params: undefined, query: undefined, body: undefined };
  const sources: [keyof Parts, z.ZodType | undefined, unknown][] = [
    ['params', route.request.params, req.params],
    ['query', route.request.query, req.query],
    ['body', route.request.bodyKind === 'ndjson' ? undefined : route.request.body, req.body],
  ];
  for (const [part, schema, raw] of sources) {
    if (schema === undefined) {
      continue;
    }
    const parsed = schema.safeParse(nfcDeep(raw, svc));
    if (parsed.success) {
      out[part] = parsed.data;
    } else {
      errors.push(...issuesOf(parsed.error));
    }
  }
  if (errors.length > 0) {
    throw validation(svc, errors);
  }
  return out;
}

function idempotencyKeyOf(route: RouteDef, req: FastifyRequest, svc: ServiceName): string | null {
  const raw = req.headers['idempotency-key'];
  if (!route.idempotent) {
    return typeof raw === 'string' && isUlid(raw) ? raw : null;
  }
  if (typeof raw !== 'string' || !isUlid(raw)) {
    throw new AppError(appErrorCode(svc, 'VAL-901'), 400, 'Idempotency-Key(ULID) 헤더가 필요하다.');
  }
  return raw;
}

function needsGate(route: RouteDef): boolean {
  return route.method !== 'GET' && !NO_GATE_PREFIXES.some((p) => route.id.startsWith(p));
}

export function createRouteRunner(deps: RunnerDeps): {
  runJson(route: RouteDef, handler: InternalHandler, req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply>;
  runStream(
    route: RouteDef,
    handler: InternalStreamHandler,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply>;
} {
  const { svc, pipeline, gate, idempotency, als } = deps;

  function context(st: ReqState, parts: Parts, key: string | null, req: FastifyRequest): InternalContext {
    return {
      ...parts,
      caller: st.caller,
      requestId: st.requestId,
      traceparent: st.traceparent,
      deadlineAt: st.deadlineAt,
      idempotencyKey: key,
      log: st.log,
      raw: req,
    };
  }

  /** 응답 스키마 검증 → 직렬화. 선언되지 않은 상태·스키마 위반은 `INTERNAL-901`(값 없이 이슈 경로만 로그). */
  function serialize(route: RouteDef, out: InternalReply, st: ReqState): string | null {
    const schema = route.response[out.status];
    if (schema === undefined) {
      st.log.error(
        { event: 'response.invalid', route: route.id, status: out.status, reason: 'undeclared_status' },
        'response status not declared',
      );
      throw new AppError(appErrorCode(svc, 'INTERNAL-901'), 500);
    }
    const parsed = schema.safeParse(out.body);
    if (!parsed.success) {
      const paths = parsed.error.issues.slice(0, 10).map((i) => i.path.map(String).join('.'));
      st.log.error(
        { event: 'response.invalid', route: route.id, status: out.status, paths },
        'response violates contract',
      );
      throw new AppError(appErrorCode(svc, 'INTERNAL-901'), 500);
    }
    if (out.status === 204) {
      return null;
    }
    return route.responseKind === 'text' ? String(parsed.data) : JSON.stringify(parsed.data);
  }

  function send(route: RouteDef, out: InternalReply, text: string | null, reply: FastifyReply): void {
    reply.code(out.status);
    for (const [name, value] of Object.entries(out.headers ?? {})) {
      reply.header(name, value);
    }
    if (text === null) {
      void reply.send();
      return;
    }
    reply.type(route.responseKind === 'text' ? TEXT_CONTENT_TYPE : 'application/json; charset=utf-8');
    void reply.send(text);
  }

  function replay(stored: { status: number; responseJson: string }, reply: FastifyReply): void {
    reply.code(stored.status).header('idempotent-replayed', 'true');
    if (stored.status === 204) {
      void reply.send();
      return;
    }
    reply.type(stored.status >= 400 ? 'application/problem+json' : 'application/json; charset=utf-8');
    void reply.send(stored.responseJson);
  }

  async function runJson(
    route: RouteDef,
    handler: InternalHandler,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const st = pipeline.stateOf(req);
    let release: (() => void) | null = null;
    let scope: IdemScope | null = null;
    let hash = '';
    let open = false; // in-flight 점유 중
    const settle = (status: number, json: string): void => {
      if (scope === null || !open) {
        return;
      }
      open = false;
      try {
        if (status < 500) {
          idempotency.complete(scope, hash, status, status === 204 ? '{}' : json);
        } else {
          idempotency.abandon(scope);
        }
      } catch (e) {
        st.log.error({ event: 'idempotency.store_failed', err: e }, 'idempotency store failed');
        idempotency.abandon(scope);
      }
    };
    try {
      if (needsGate(route)) {
        const entered = await gate.enter();
        if (!entered.ok) {
          throw new AppError(appErrorCode(svc, 'DEP-900'), 503, '쓰기 게이트가 닫혀 있다.');
        }
        release = entered.value;
      }
      const key = idempotencyKeyOf(route, req, svc);
      const parts = validateParts(route, req, svc);
      if (route.idempotent && key !== null) {
        scope = { key, caller: st.caller, routeId: route.id };
        hash = requestHash(parts.body);
        const begin = idempotency.begin(scope, hash);
        if (begin.kind === 'replay') {
          scope = null;
          replay(begin, reply);
          return reply;
        }
        if (begin.kind === 'conflict_body') {
          scope = null;
          throw new AppError(appErrorCode(svc, 'CONFLICT-001'), 422, '같은 Idempotency-Key로 다른 본문이 왔다.');
        }
        if (begin.kind === 'in_flight') {
          scope = null;
          throw new AppError(appErrorCode(svc, 'CONFLICT-002'), 409, '같은 키의 요청이 처리 중이다.', {
            extra: { retry_after_ms: 200 },
          });
        }
        open = true;
      }
      const out = await als.run({ traceparent: st.traceparent, requestId: st.requestId }, () =>
        handler(context(st, parts, key, req)),
      );
      const text = serialize(route, out, st);
      settle(out.status, text ?? '{}');
      send(route, out, text, reply);
    } catch (e) {
      const problem = pipeline.replyProblem(req, reply, e);
      settle(problem.status, JSON.stringify(problem.body));
    } finally {
      release?.();
      if (open && scope !== null) {
        idempotency.abandon(scope);
      }
    }
    return reply;
  }

  async function runStream(
    route: RouteDef,
    handler: InternalStreamHandler,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const st = pipeline.stateOf(req);
    let release: (() => void) | null = null;
    try {
      if (needsGate(route)) {
        const entered = await gate.enter();
        if (!entered.ok) {
          throw new AppError(appErrorCode(svc, 'DEP-900'), 503, '쓰기 게이트가 닫혀 있다.');
        }
        release = entered.value;
      }
      const key = idempotencyKeyOf(route, req, svc);
      const parts = validateParts(route, req, svc);
      await als.run({ traceparent: st.traceparent, requestId: st.requestId }, () =>
        handler(context(st, parts, key, req), reply),
      );
      // 핸들러가 응답을 hijack해 열어 둔 스트림(SSE 등, Fastify 5: hijack 시 `sent` = true)은 in-flight에서 뺀다 — 열린 스트림이
      // 종료 대기(waitIdle)를 grace 전체로 늘리지 않게 한다. 스트림은 shutdown 훅(hub.closeAll)이 닫는다(NFR-AVL-004, ADR-012 §8).
      if (reply.sent && !reply.raw.writableEnded) {
        pipeline.release(req);
      }
    } catch (e) {
      pipeline.replyProblem(req, reply, e);
    } finally {
      release?.();
    }
    return reply;
  }

  return { runJson, runStream };
}
