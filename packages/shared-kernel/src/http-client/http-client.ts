import { randomBytes, randomInt } from 'node:crypto';
import http from 'node:http';
import type { Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { Problem } from '@fathom/contracts/common/problem';
import type { RouteDef } from '@fathom/contracts/common/route';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { isUlid, ulid } from '@fathom/shared-kernel/ids/ids';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { z } from 'zod';

// IF-01 §2.2(헤더)·§2.9(데드라인·재시도·서킷) — 서비스 간 호출은 피어 1개당 `PeerClient` 1개로만 한다(STD-ARC-10).
// [Brief 결정] 전송은 `node:http`(keep-alive Agent) — 연결 300ms 타이머를 'socket'→'connect' 사이에 직접 건다. `fetch`·`undici` 사용 금지.

// ───────── 타입(T-00-03 testkit `fakes/peers`와 글자 그대로 같은 모양) ─────────

export type PeerInput = {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  readonly body?: unknown;
};
export type PeerCallOptions = {
  readonly idempotencyKey?: string;
  readonly deadlineAt?: number;
  readonly requestId?: string;
  readonly traceparent?: string | null;
};
export type PeerFailure =
  | {
      readonly kind: 'connect_failed' | 'connect_timeout' | 'circuit_open' | 'deadline_exhausted' | 'timeout';
      readonly dependency: ServiceName;
    }
  | { readonly kind: 'problem'; readonly dependency: ServiceName; readonly status: number; readonly problem: Problem }
  | {
      readonly kind: 'contract_violation';
      readonly dependency: ServiceName;
      readonly status: number;
      readonly detail: string;
    };
/**
 * [Brief §4.3 deviation, T-00-03 supplement과 동일] 라우트 객체의 `response[status]`는 런타임에 고른 스키마라 출력 타입이 합집합으로만 보인다.
 * `safeParse`를 통과한 값이므로 호출자가 정한 라우트 리터럴 타입 `ResponseOf<R>`로 좁히는 단언은 이 함수 한 곳에만 둔다.
 */
function narrowParsedResponse<R extends RouteDef>(parsed: unknown): ResponseOf<R> {
  return parsed as ResponseOf<R>;
}

export type ResponseOf<R extends RouteDef> = z.output<R['response'][keyof R['response'] & number]>;
export type PeerSuccess<T = unknown> = { readonly status: number; readonly body: T; readonly replayed: boolean };
export interface PeerClientPort {
  call<R extends RouteDef>(
    route: R,
    input: PeerInput,
    opts?: PeerCallOptions,
  ): Promise<Result<PeerSuccess<ResponseOf<R>>, PeerFailure>>;
}

export type PeerClientOptions = {
  readonly self: ServiceName;
  readonly peer: ServiceName;
  readonly baseUrl: () => string | null;
  readonly token: string;
  readonly clock: Clock;
  readonly rng?: () => number;
  readonly httpRequest?: typeof import('node:http').request;
  readonly metrics?: MetricsRegistry;
};

// ───────── 상수 ─────────

const DEFAULT_DEADLINE_MS = 2000;
const NETWORK_MARGIN_MS = 10;
const CONNECT_TIMEOUT_MS = 300;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const RETRY_DELAYS_MS: readonly number[] = [100, 300];
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 5000;
const CALL_BUCKETS_MS: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-[0-9a-f]{16}-([0-9a-f]{2})$/;

type CircuitState = 'closed' | 'open' | 'half_open';
type Retryable = PeerFailure;

type Transport =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly headers: http.IncomingHttpHeaders;
      readonly body: Buffer;
    }
  | { readonly kind: 'fail'; readonly failure: 'connect_failed' | 'connect_timeout' | 'timeout' | 'too_large' };

// ───────── 요청 조립 ─────────

function expandPath(route: RouteDef, params: Readonly<Record<string, unknown>> | undefined): string {
  return route.path.replace(/\{([A-Za-z0-9_]+)\}/g, (_whole, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null) {
      throw new Error(`invariant: peer call ${route.id} missing path param ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildQuery(query: Readonly<Record<string, unknown>> | undefined): string {
  if (query === undefined) {
    return '';
  }
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined) {
      continue;
    }
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `request.<part>` 스키마로 입력을 파싱한다. 스키마가 없는데 입력이 있거나 파싱이 실패하면 호출자 결함으로 던진다. */
function checkInput(
  route: RouteDef,
  part: 'params' | 'query' | 'body',
  value: unknown,
): { readonly present: boolean; readonly value: unknown } {
  const schema = route.request[part];
  if (schema === undefined) {
    if (value !== undefined) {
      throw new Error(`invariant: peer call ${route.id} has no request.${part} schema but input.${part} was given`);
    }
    return { present: false, value: undefined };
  }
  const parsed = schema.safeParse(part === 'body' ? value : (value ?? {}));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `invariant: peer call ${route.id} input.${part} invalid at ${issue === undefined ? '(root)' : issue.path.map(String).join('.') || '(root)'}`,
    );
  }
  return { present: true, value: parsed.data };
}

function nextTraceparent(incoming: string | null | undefined): string | null {
  if (incoming === null || incoming === undefined) {
    return null;
  }
  const match = TRACEPARENT_RE.exec(incoming);
  if (match === null) {
    return null;
  }
  return `00-${match[1] ?? ''}-${randomBytes(8).toString('hex')}-${match[2] ?? '00'}`;
}

function singleHeader(headers: http.IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

// ───────── 전송 ─────────

function transportOnce(
  request: typeof http.request,
  agent: http.Agent,
  target: URL,
  method: string,
  pathAndQuery: string,
  headers: Record<string, string>,
  body: Buffer | null,
  waitMs: number,
): Promise<Transport> {
  return new Promise<Transport>((resolve) => {
    let settled = false;
    let connectTimedOut = false;
    let connectTimer: NodeJS.Timeout | undefined;
    let waitTimer: NodeJS.Timeout | undefined;

    const finish = (t: Transport): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(waitTimer);
      resolve(t);
    };

    const basePath = target.pathname.endsWith('/') ? target.pathname.slice(0, -1) : target.pathname;
    const req = request(
      {
        host: target.hostname,
        port: target.port === '' ? 80 : Number(target.port),
        method,
        path: `${basePath}${pathAndQuery}`,
        headers,
        agent,
      },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            res.destroy();
            req.destroy();
            finish({ kind: 'fail', failure: 'too_large' });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          finish({ kind: 'response', status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on('error', () => {
          finish({ kind: 'fail', failure: 'connect_failed' });
        });
        res.on('close', () => {
          // 본문이 끝나기 전에 연결이 끊김 — 'end' 뒤의 close는 이미 settled라 무시된다.
          finish({ kind: 'fail', failure: 'connect_failed' });
        });
      },
    );
    req.on('socket', (socket: Socket) => {
      if (socket.connecting) {
        connectTimer = setTimeout(() => {
          connectTimedOut = true;
          req.destroy(new Error('connect timeout'));
        }, CONNECT_TIMEOUT_MS);
        connectTimer.unref();
        socket.once('connect', () => {
          clearTimeout(connectTimer);
        });
      }
    });
    req.on('error', () => {
      finish({ kind: 'fail', failure: connectTimedOut ? 'connect_timeout' : 'connect_failed' });
    });
    waitTimer = setTimeout(
      () => {
        finish({ kind: 'fail', failure: 'timeout' });
        req.destroy(new Error('response timeout'));
      },
      Math.max(1, waitMs),
    );
    waitTimer.unref();
    req.end(body ?? undefined);
  });
}

// ───────── 클라이언트 ─────────

/**
 * 피어 1개당 클라이언트 1개. 사전 검사 위반(결함)은 던지고(= 거절된 Promise), 예상 가능한 실패는 `Result`로 돌려준다.
 */
export function createPeerClient(opts: PeerClientOptions): PeerClientPort & { circuitState(): CircuitState } {
  const request = opts.httpRequest ?? http.request;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
  const rng = opts.rng ?? ((): number => randomInt(0, 1_000_000) / 1_000_000);
  const durations = opts.metrics?.histogram(
    'peer_call_duration_ms',
    'PeerClient call duration including retries',
    CALL_BUCKETS_MS,
    ['peer', 'route'],
  );
  const circuitOpened = opts.metrics?.counter('peer_circuit_open_total', 'PeerClient circuit open transitions', [
    'peer',
  ]);

  // 서킷(피어 단위) — 연속 연결 실패 3회 → open 5s → half_open 시험 1건.
  let state: 'closed' | 'open' = 'closed';
  let openedAt = 0;
  let failures = 0;
  let probeInFlight = false;

  function currentState(): CircuitState {
    if (state === 'open') {
      return opts.clock.now() - openedAt >= CIRCUIT_OPEN_MS ? 'half_open' : 'open';
    }
    return 'closed';
  }

  function tripOpen(): void {
    state = 'open';
    openedAt = opts.clock.now();
    failures = 0;
    probeInFlight = false;
    circuitOpened?.inc({ peer: opts.peer });
  }

  /** 시도 직전 승인. `null`이면 요청하지 않는다. half_open이면 시험 호출(`'probe'`) 1건만 점유한다. */
  function admit(): 'normal' | 'probe' | null {
    const s = currentState();
    if (s === 'closed') {
      return 'normal';
    }
    if (s === 'open' || probeInFlight) {
      return null;
    }
    probeInFlight = true;
    return 'probe';
  }

  function recordAttempt(wasProbe: boolean, outcome: 'success' | 'connect_failure' | 'other'): void {
    if (wasProbe) {
      // half_open 시험 호출: 연결이 되면(응답이 오류여도) 닫고, 연결 실패면 다시 연다.
      if (outcome === 'connect_failure') {
        tripOpen();
      } else {
        state = 'closed';
        failures = 0;
        probeInFlight = false;
      }
      return;
    }
    if (outcome === 'connect_failure') {
      failures += 1;
      if (failures >= CIRCUIT_FAILURE_THRESHOLD) {
        tripOpen();
      }
    } else if (outcome === 'success') {
      failures = 0;
    }
  }

  const fail = (kind: 'circuit_open' | 'deadline_exhausted'): Result<never, PeerFailure> =>
    err({ kind, dependency: opts.peer });

  function interpret(
    route: RouteDef,
    t: Extract<Transport, { kind: 'response' }>,
  ): Result<PeerSuccess<unknown>, PeerFailure> {
    const violation = (detail: string): Result<never, PeerFailure> =>
      err({ kind: 'contract_violation', dependency: opts.peer, status: t.status, detail });
    const contentType = singleHeader(t.headers, 'content-type') ?? '';
    if (t.status >= 200 && t.status < 300) {
      const schema = route.response[t.status];
      if (schema === undefined) {
        return violation(`status ${t.status} not declared by ${route.id}`);
      }
      let json: unknown = null;
      if (t.status !== 204) {
        try {
          json = parseJsonStrict(t.body.toString('utf8'));
        } catch (e) {
          return violation(`response body is not valid json: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return violation(
          `response schema mismatch at ${issue === undefined ? '(root)' : issue.path.map(String).join('.') || '(root)'}`,
        );
      }
      return ok({
        status: t.status,
        body: parsed.data,
        replayed: singleHeader(t.headers, 'idempotent-replayed') === 'true',
      });
    }
    if (t.status >= 400 && contentType.toLowerCase().startsWith('application/problem+json')) {
      let json: unknown;
      try {
        json = parseJsonStrict(t.body.toString('utf8'));
      } catch {
        return violation('problem body is not valid json');
      }
      const problem = Problem.safeParse(json);
      if (!problem.success) {
        return violation('problem body does not match Problem');
      }
      return err({ kind: 'problem', dependency: opts.peer, status: t.status, problem: problem.data });
    }
    return violation(`unexpected status ${t.status} without problem+json`);
  }

  function isRetryable(failure: Retryable): boolean {
    switch (failure.kind) {
      case 'connect_failed':
      case 'connect_timeout':
        return true;
      case 'problem':
        return failure.status === 503 || (failure.status === 409 && failure.problem.code.endsWith('-CONFLICT-002'));
      default:
        return false;
    }
  }

  async function call<R extends RouteDef>(
    route: R,
    input: PeerInput,
    callOpts?: PeerCallOptions,
  ): Promise<Result<PeerSuccess<ResponseOf<R>>, PeerFailure>> {
    // 사전 검사 — 위반은 호출자 결함이다.
    if (!route.path.startsWith('/internal/v1/')) {
      throw new Error(`invariant: peer call ${route.id} path must start with /internal/v1/`);
    }
    if (!route.allowedCallers.includes(opts.self)) {
      throw new Error(`invariant: peer call ${route.id} does not allow caller ${opts.self}`);
    }
    const idempotencyKey = callOpts?.idempotencyKey;
    if (route.idempotent && !isUlid(idempotencyKey)) {
      throw new Error(`invariant: idempotent route ${route.id} called without a ULID idempotencyKey`);
    }
    const params = checkInput(route, 'params', input.params);
    const query = checkInput(route, 'query', input.query);
    const body = checkInput(route, 'body', input.body);
    const pathAndQuery = `${expandPath(route, isRecord(params.value) ? params.value : undefined)}${buildQuery(
      isRecord(query.value) ? query.value : undefined,
    )}`;
    const payload = body.present ? Buffer.from(JSON.stringify(body.value), 'utf8') : null;
    const requestId = callOpts?.requestId ?? ulid();
    const deadlineAt = callOpts?.deadlineAt ?? opts.clock.now() + (route.deadlineMs ?? DEFAULT_DEADLINE_MS);
    const canRetry = route.method === 'GET' || route.idempotent;
    const startedAt = performance.now();

    const finish = (
      result: Result<PeerSuccess<unknown>, PeerFailure>,
    ): Result<PeerSuccess<ResponseOf<R>>, PeerFailure> => {
      durations?.observe(performance.now() - startedAt, { peer: opts.peer, route: route.id });
      return result.ok
        ? ok({
            status: result.value.status,
            body: narrowParsedResponse<R>(result.value.body),
            replayed: result.value.replayed,
          })
        : result;
    };

    let last: Result<PeerSuccess<unknown>, PeerFailure> = fail('deadline_exhausted');
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const remaining = deadlineAt - opts.clock.now() - NETWORK_MARGIN_MS;
      if (remaining <= 0) {
        return finish(attempt === 0 ? fail('deadline_exhausted') : last);
      }
      const admission = admit();
      if (admission === null) {
        // 재시도 중 서킷이 열렸다면 마지막 실제 실패를 가리지 않는다(T-00-04 리뷰 minor).
        return finish(attempt === 0 ? fail('circuit_open') : last);
      }
      const wasProbe = admission === 'probe';
      const base = opts.baseUrl();
      let result: Result<PeerSuccess<unknown>, PeerFailure>;
      let outcome: 'success' | 'connect_failure' | 'other';
      if (base === null) {
        result = err({ kind: 'connect_failed', dependency: opts.peer });
        outcome = 'connect_failure';
      } else {
        try {
          const headers: Record<string, string> = {
            authorization: `Bearer ${opts.token}`,
            accept: 'application/json',
            'x-request-id': requestId,
            'x-fathom-deadline-ms': String(remaining),
          };
          if (payload !== null) {
            headers['content-type'] = 'application/json; charset=utf-8';
            headers['content-length'] = String(payload.length);
          }
          if (idempotencyKey !== undefined) {
            headers['idempotency-key'] = idempotencyKey;
          }
          const traceparent = nextTraceparent(callOpts?.traceparent);
          if (traceparent !== null) {
            headers.traceparent = traceparent;
          }
          const t = await transportOnce(
            request,
            agent,
            new URL(base),
            route.method,
            pathAndQuery,
            headers,
            payload,
            remaining,
          );
          if (t.kind === 'fail') {
            if (t.failure === 'too_large') {
              result = err({
                kind: 'contract_violation',
                dependency: opts.peer,
                status: 0,
                detail: `response exceeded ${MAX_RESPONSE_BYTES} bytes`,
              });
              outcome = 'other';
            } else {
              result = err({ kind: t.failure, dependency: opts.peer });
              outcome = t.failure === 'timeout' ? 'other' : 'connect_failure';
            }
          } else {
            result = interpret(route, t);
            outcome = result.ok ? 'success' : 'other';
          }
        } catch (e) {
          // 예기치 못한 예외가 시험 호출 점유를 남기면 half_open이 영구히 막힌다(T-00-04 리뷰 minor).
          if (wasProbe) {
            probeInFlight = false;
          }
          throw e;
        }
      }
      recordAttempt(wasProbe, outcome);
      last = result;
      if (result.ok || !canRetry || !isRetryable(result.error)) {
        return finish(result);
      }
      const delayBase = RETRY_DELAYS_MS[attempt];
      if (delayBase === undefined) {
        return finish(result);
      }
      const delay = delayBase * (0.8 + 0.4 * rng());
      if (delay >= deadlineAt - opts.clock.now() - NETWORK_MARGIN_MS) {
        return finish(result);
      }
      await sleep(delay);
    }
    return finish(last);
  }

  return { call, circuitState: currentState };
}
