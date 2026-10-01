import { Problem, type Problem as ProblemT } from '@fathom/contracts/common/problem';
import type { RouteDef } from '@fathom/contracts/common/route';
import { SessionCsrfRoute } from '@fathom/contracts/http/gateway/v1/session';
import type { z } from 'zod';
import { CLIENT_HEADER } from './app-version.js';
import type { CsrfStore } from './csrf.js';

export type ApiFailure =
  | { readonly kind: 'problem'; readonly status: number; readonly problem: ProblemT }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'contract'; readonly status: number | null; readonly detail: string };

export type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T; readonly replayed: boolean }
  | ({ readonly ok: false } & ApiFailure);

type RequestPart<R extends RouteDef, K extends 'params' | 'query' | 'body'> = R['request'] extends {
  readonly [P in K]: infer S extends z.ZodType;
}
  ? { readonly [P in K]?: z.input<S> }
  : Record<never, never>;

/** 라우트 정의에 그 스키마가 있는 키만 받는다(IF-01 §2.2). */
export type RouteInput<R extends RouteDef> = RequestPart<R, 'params'> &
  RequestPart<R, 'query'> &
  RequestPart<R, 'body'>;

/** 2xx 응답 스키마들의 `z.output` 합집합(204 = `null`). */
export type RouteOutput<R extends RouteDef> = {
  [K in keyof R['response']]: R['response'][K] extends z.ZodType ? z.output<R['response'][K]> : never;
}[keyof R['response']];

export class ApiError extends Error {
  readonly failure: ApiFailure;
  constructor(failure: ApiFailure) {
    super(describeFailure(failure));
    this.name = 'ApiError';
    this.failure = failure;
  }
}

function describeFailure(f: ApiFailure): string {
  switch (f.kind) {
    case 'problem':
      return f.problem.code;
    case 'network':
      return f.message;
    case 'contract':
      return f.detail;
  }
}

/** 재시도 가능 여부 — network → true · problem → `problem.retryable` · contract → false (IF-01 §2.5). */
export function isRetryable(f: ApiFailure): boolean {
  switch (f.kind) {
    case 'network':
      return true;
    case 'problem':
      return f.problem.retryable;
    case 'contract':
      return false;
  }
}

export interface ApiClientDeps {
  readonly fetch: typeof fetch;
  readonly csrf: CsrfStore;
  readonly newKey: () => string;
  readonly onSessionLost?: (code: string) => void;
  readonly onVersionMismatch?: () => void;
}

export interface CallOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

export interface ApiClient {
  call<R extends RouteDef>(route: R, input: RouteInput<R>, opts?: CallOptions): Promise<ApiResult<RouteOutput<R>>>;
  /** 실패 = `ApiError` throw (TanStack Query `queryFn`용). */
  query<R extends RouteDef>(
    route: R,
    input: RouteInput<R>,
    opts?: { readonly signal?: AbortSignal },
  ): Promise<RouteOutput<R>>;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_LOST_CODES = new Set(['GW-AUTH-001', 'GW-AUTH-003']);

type LooseInput = { readonly params?: unknown; readonly query?: unknown; readonly body?: unknown };
type Built = { readonly url: string; readonly body: string | undefined };
type BuildResult = { readonly ok: true; readonly built: Built } | { readonly ok: false; readonly detail: string };

function issuePath(error: z.ZodError): string {
  const first = error.issues[0];
  if (first === undefined || first.path.length === 0) {
    return '(root)';
  }
  return first.path.map((p) => String(p)).join('.');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function substitutePath(path: string, params: Record<string, unknown>): string | null {
  let missing = false;
  const out = path.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) {
      missing = true;
      return '';
    }
    return encodeURIComponent(String(v));
  });
  return missing ? null : out;
}

function buildQuery(parsed: unknown): string {
  if (!isRecord(parsed)) {
    return '';
  }
  const usp = new URLSearchParams();
  for (const key of Object.keys(parsed).sort()) {
    const v = parsed[key];
    if (v === undefined) {
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        usp.append(key, String(item));
      }
    } else {
      usp.append(key, String(v));
    }
  }
  const s = usp.toString();
  return s === '' ? '' : `?${s}`;
}

function buildRequest(route: RouteDef, input: LooseInput): BuildResult {
  const { params: paramsSchema, query: querySchema, body: bodySchema } = route.request;
  let path: string = route.path;
  if (paramsSchema !== undefined) {
    const r = paramsSchema.safeParse(input.params);
    if (!r.success) {
      return { ok: false, detail: `request.params ${issuePath(r.error)}` };
    }
    const sub = isRecord(r.data) ? substitutePath(path, r.data) : null;
    if (sub === null) {
      return { ok: false, detail: 'request.params (path)' };
    }
    path = sub;
  }
  let search = '';
  if (querySchema !== undefined) {
    const r = querySchema.safeParse(input.query ?? {});
    if (!r.success) {
      return { ok: false, detail: `request.query ${issuePath(r.error)}` };
    }
    search = buildQuery(r.data);
  }
  let body: string | undefined;
  if (bodySchema !== undefined) {
    const r = bodySchema.safeParse(input.body);
    if (!r.success) {
      return { ok: false, detail: `request.body ${issuePath(r.error)}` };
    }
    body = JSON.stringify(r.data);
  }
  return { ok: true, built: { url: `${path}${search}`, body } };
}

function readJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    // JSON이 아닌 본문 — 호출 측이 contract 실패로 판정한다.
    return { ok: false };
  }
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  async function send(
    route: RouteDef,
    built: Built,
    key: string | null,
    signal: AbortSignal | undefined,
  ): Promise<ApiResult<unknown>> {
    const headers: Record<string, string> = { accept: 'application/json', 'x-fathom-client': CLIENT_HEADER };
    if (built.body !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8';
    }
    const csrf = deps.csrf.get();
    if (MUTATING.has(route.method) && csrf !== null) {
      headers['x-fathom-csrf'] = csrf;
    }
    if (key !== null) {
      headers['idempotency-key'] = key;
    }
    let res: Response;
    try {
      res = await deps.fetch(built.url, {
        method: route.method,
        headers,
        body: built.body,
        credentials: 'same-origin',
        signal,
      });
    } catch (e) {
      return { ok: false, kind: 'network', message: e instanceof Error ? e.message : String(e) };
    }
    return parseResponse(route, res);
  }

  async function parseResponse(route: RouteDef, res: Response): Promise<ApiResult<unknown>> {
    const status = res.status;
    if (status >= 200 && status < 300) {
      const schema = route.response[status];
      if (schema === undefined) {
        return { ok: false, kind: 'contract', status, detail: `response.${String(status)} 정의 없음` };
      }
      const replayed = res.headers.get('idempotent-replayed') === 'true';
      if (status === 204) {
        return { ok: true, status, data: null, replayed };
      }
      const text = await res.text();
      const json = readJson(text);
      if (!json.ok) {
        return { ok: false, kind: 'contract', status, detail: `response.${String(status)} JSON 아님` };
      }
      const parsed = schema.safeParse(json.value);
      if (!parsed.success) {
        return { ok: false, kind: 'contract', status, detail: `response.${String(status)} ${issuePath(parsed.error)}` };
      }
      return { ok: true, status, data: parsed.data, replayed };
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (status >= 400 && contentType.includes('application/problem+json')) {
      const json = readJson(await res.text());
      const parsed = json.ok ? Problem.safeParse(json.value) : null;
      if (parsed === null || !parsed.success) {
        return { ok: false, kind: 'contract', status, detail: 'problem+json 형식 위반' };
      }
      return { ok: false, kind: 'problem', status, problem: parsed.data };
    }
    return { ok: false, kind: 'contract', status, detail: `예상 밖 응답 ${String(status)}` };
  }

  async function refreshCsrf(signal: AbortSignal | undefined): Promise<boolean> {
    const built = buildRequest(SessionCsrfRoute, {});
    if (!built.ok) {
      return false;
    }
    const r = await send(SessionCsrfRoute, built.built, null, signal);
    if (!r.ok) {
      return false;
    }
    const parsed = SessionCsrfRoute.response[200].safeParse(r.data);
    if (!parsed.success) {
      return false;
    }
    try {
      deps.csrf.set(parsed.data.csrf);
    } catch {
      // 형식 위반 토큰 — 저장하지 않고 재시도를 포기한다.
      return false;
    }
    return true;
  }

  function sideEffects(result: ApiResult<unknown>): void {
    if (result.ok || result.kind !== 'problem') {
      return;
    }
    const { status, problem } = result;
    if (status === 401 && SESSION_LOST_CODES.has(problem.code)) {
      deps.onSessionLost?.(problem.code);
    } else if (status === 409 && problem.code === 'GW-CONFLICT-010') {
      deps.onVersionMismatch?.();
    }
  }

  async function execute(route: RouteDef, input: LooseInput, opts: CallOptions | undefined): Promise<ApiResult<unknown>> {
    const built = buildRequest(route, input);
    if (!built.ok) {
      return { ok: false, kind: 'contract', status: null, detail: built.detail };
    }
    const key = route.idempotent ? (opts?.idempotencyKey ?? deps.newKey()) : null;
    let result = await send(route, built.built, key, opts?.signal);
    if (!result.ok && result.kind === 'problem' && result.status === 403 && result.problem.code === 'GW-AUTH-002') {
      if (await refreshCsrf(opts?.signal)) {
        result = await send(route, built.built, key, opts?.signal);
      }
    }
    sideEffects(result);
    return result;
  }

  return {
    async call<R extends RouteDef>(route: R, input: RouteInput<R>, opts?: CallOptions): Promise<ApiResult<RouteOutput<R>>> {
      const result = await execute(route, input, opts);
      return result as ApiResult<RouteOutput<R>>;
    },
    async query<R extends RouteDef>(route: R, input: RouteInput<R>, opts?: { readonly signal?: AbortSignal }): Promise<RouteOutput<R>> {
      const result = await execute(route, input, opts);
      if (!result.ok) {
        throw new ApiError(result);
      }
      return result.data as RouteOutput<R>;
    },
  };
}
