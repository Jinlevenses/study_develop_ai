import type { CallerName } from '@fathom/contracts/common/ids';
import { ServiceName } from '@fathom/contracts/common/ids';
import type { RouteDef } from '@fathom/contracts/common/route';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { Injector, InjectRequest, InjectResponse } from '../../../src/contract.js';
import { TEST_CALLER_TOKENS } from '../../../src/contract.js';
import { fixedUlid } from '../../../src/ids.js';

// 하네스 자가 테스트용 가짜 서버. `quirks`로 규칙마다 위반을 하나씩 심는다(적합 서버 = quirks 없음).
export type Quirk =
  | 'bad_c2'
  | 'no_validation'
  | 'no_auth'
  | 'no_conflict'
  | 'no_replay_header'
  | 'stack_leak'
  | 'ignore_deadline'
  | 'array_list'
  | 'plain_error_content_type'
  | 'no_key_required'
  | 'validate_first';

export type Respond = (input: { body: unknown; params: Record<string, string>; caller: CallerName | null }) => {
  status: number;
  body: unknown;
};
export type FakeRoute = { route: RouteDef; respond: Respond };

const TOKEN_OWNER: ReadonlyMap<string, CallerName> = new Map(
  ServiceName.options.map((svc): [string, CallerName] => [TEST_CALLER_TOKENS[svc], svc]),
);

function problem(
  quirks: ReadonlySet<Quirk>,
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
): InjectResponse {
  const body = {
    type: `urn:fathom:problem:${code.toLowerCase()}`,
    title: '오류',
    status,
    detail: quirks.has('stack_leak') ? `${detail}\n    at handler (/home/dev/app/x.ts:1:1)` : detail,
    code,
    error_id: fixedUlid(7),
    request_id: fixedUlid(8),
    retryable: false,
    ...extra,
  };
  const contentType = quirks.has('plain_error_content_type')
    ? 'application/json'
    : 'application/problem+json; charset=utf-8';
  return { statusCode: status, headers: { 'content-type': contentType }, body: JSON.stringify(body) };
}

function matcher(path: string): RegExp {
  return new RegExp(`^${path.replace(/\{[^}]+\}/g, '([^/]+)')}$`);
}

function paramNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '');
}

function bearerOf(headers: Record<string, string>): string | undefined {
  const value = headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined;
}

export function createFakeServer(routes: readonly FakeRoute[], quirks: ReadonlySet<Quirk> = new Set()): Injector {
  const stored = new Map<string, { hash: string; response: InjectResponse }>();
  return {
    inject(req: InjectRequest): Promise<InjectResponse> {
      return Promise.resolve(handle(req));
    },
  };

  function handle(req: InjectRequest): InjectResponse {
    const url = new URL(req.url, 'http://x');
    const found = routes.find(({ route }) => route.method === req.method && matcher(route.path).test(url.pathname));
    if (found === undefined) {
      return problem(quirks, 404, 'LR-NOTFOUND-900', 'unknown route');
    }
    const { route, respond } = found;
    const match = matcher(route.path).exec(url.pathname);
    const params = Object.fromEntries(
      paramNames(route.path).map((name, i) => [name, decodeURIComponent(match?.[i + 1] ?? '')]),
    );
    let caller: CallerName | null = null;
    if (route.allowedCallers.length > 0 && !quirks.has('no_auth')) {
      const token = bearerOf(req.headers);
      caller = token === undefined ? null : (TOKEN_OWNER.get(token) ?? null);
      if (caller === null) {
        return problem(quirks, 401, 'LR-AUTH-900', 'token required');
      }
      if (!route.allowedCallers.includes(caller)) {
        return problem(quirks, 403, 'LR-ACL-900', 'caller not allowed');
      }
    } else if (quirks.has('no_auth')) {
      caller = route.allowedCallers[0] ?? null;
    }
    if (req.headers['x-fathom-deadline-ms'] === '0' && !quirks.has('ignore_deadline')) {
      return problem(quirks, 504, 'LR-DEP-902', 'deadline exhausted');
    }
    const body: unknown = req.payload === undefined ? undefined : JSON.parse(req.payload);
    const key = req.headers['idempotency-key'];
    const hash = canonicalJson(body ?? null);
    const validate = (): InjectResponse | null => {
      if (!quirks.has('no_validation')) {
        const bodyCheck = route.request.body?.safeParse(body);
        const queryCheck = route.request.query?.safeParse(Object.fromEntries(url.searchParams));
        if (bodyCheck?.success === false || queryCheck?.success === false) {
          return problem(quirks, 400, 'LR-VAL-900', 'invalid request', {
            errors: [{ path: 'x', message: 'bad', rule: 'zod' }],
          });
        }
      }
      return null;
    };
    // validate_first: 본문 검증을 멱등 키 조회보다 먼저 한다(IF-01 §2.7은 순서를 고정하지 않는다).
    let validated = false;
    if (quirks.has('validate_first')) {
      validated = true;
      const rejected = validate();
      if (rejected !== null) {
        return rejected;
      }
    }
    if (route.idempotent) {
      if (key === undefined && !quirks.has('no_key_required')) {
        return problem(quirks, 400, 'LR-VAL-901', 'idempotency key required');
      }
      const previous = key === undefined ? undefined : stored.get(key);
      if (previous !== undefined) {
        if (previous.hash !== hash && !quirks.has('no_conflict')) {
          return problem(quirks, 422, 'LR-CONFLICT-001', 'different body');
        }
        const headers = quirks.has('no_replay_header')
          ? previous.response.headers
          : { ...previous.response.headers, 'idempotent-replayed': 'true' };
        return { ...previous.response, headers };
      }
    }
    if (!validated) {
      const rejected = validate();
      if (rejected !== null) {
        return rejected;
      }
    }
    const out = respond({ body, params, caller });
    let payload: unknown = out.body;
    if (quirks.has('bad_c2')) {
      payload = { unexpected: true };
    }
    if (quirks.has('array_list') && route.paginated) {
      payload = [];
    }
    const response: InjectResponse = {
      statusCode: out.status,
      headers: { 'content-type': route.responseKind === 'text' ? 'text/plain' : 'application/json; charset=utf-8' },
      body: out.status === 204 ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload),
    };
    if (route.idempotent && key !== undefined) {
      stored.set(key, { hash, response });
    }
    return response;
  }
}
