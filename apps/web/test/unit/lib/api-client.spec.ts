import { defineRoute } from '@fathom/contracts/common/route';
import { EvidenceEventsRoute } from '@fathom/contracts/http/gateway/v1/evidence';
import { SessionCsrfRoute, SessionLogoutRoute, SessionStatusRoute } from '@fathom/contracts/http/gateway/v1/session';
import { SessionsAttemptsSubmitRoute } from '@fathom/contracts/http/gateway/v1/sessions';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient, isRetryable } from '../../../src/lib/api-client.js';
import { APP_VERSION } from '../../../src/lib/app-version.js';
import { createCsrfStore } from '../../../src/lib/csrf.js';
import { createQueryClient, shouldRetryQuery } from '../../../src/lib/query-client.js';
import { CSRF_43, fakeFetch, jsonResponse, problemBody, problemResponse, ULID_A } from './support/fixtures.js';

const STATUS_BODY = {
  authenticated: true,
  port: 4747,
  app_version: '0.0.0',
  boot_id: ULID_A,
  profile: 'dev',
  safe_mode: false,
  maintenance: 'none',
};

const PARAM_ROUTE = defineRoute({
  id: 'gateway.test.params',
  ifId: 'IF-GW-999',
  method: 'GET',
  path: '/api/v1/t/{name}:verb',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {
    params: z.object({ name: z.string() }).strict(),
    query: z.object({ b: z.array(z.string()).optional(), a: z.string().optional(), c: z.string().optional() }).strict(),
  },
  response: { 200: z.object({ ok: z.literal(true) }).strict() },
  freeze: 'D',
  slice: 'R0',
  fr: ['TEST'],
});

const IDEM_ROUTE = defineRoute({
  id: 'gateway.test.idem',
  ifId: 'IF-GW-998',
  method: 'POST',
  path: '/api/v1/t/idem',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: z.object({ n: z.number() }).strict() },
  response: { 200: z.object({ ok: z.literal(true) }).strict() },
  freeze: 'D',
  slice: 'R0',
  fr: ['TEST'],
});

const PLAIN_POST = defineRoute({
  id: 'gateway.test.plain',
  ifId: 'IF-GW-997',
  method: 'PUT',
  path: '/api/v1/t/plain',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { body: z.object({ n: z.number() }).strict() },
  response: { 200: z.object({ ok: z.literal(true) }).strict() },
  freeze: 'D',
  slice: 'R0',
  fr: ['TEST'],
});

function setup(fetchImpl: typeof fetch, extra: Partial<Parameters<typeof createApiClient>[0]> = {}) {
  const csrf = createCsrfStore();
  let n = 0;
  const api = createApiClient({
    fetch: fetchImpl,
    csrf,
    newKey: () => {
      n += 1;
      return `KEY-${String(n)}`;
    },
    ...extra,
  });
  return { api, csrf };
}

const OK = (): Response => jsonResponse(200, { ok: true });

describe('api-client', () => {
  it('UT-WEB-011 경로 치환·인코딩, query 사전순·undefined 제외·zod 기본값 반영, 요청 스키마 위반은 fetch 0회 contract다 [STD-WEB-12]', async () => {
    const f = fakeFetch(OK);
    const { api } = setup(f.fetch);
    await api.call(PARAM_ROUTE, { params: { name: 'a b/ü' }, query: { c: 'x', b: ['1', '2'], a: undefined } });
    expect(f.calls[0]?.url).toBe('/api/v1/t/a%20b%2F%C3%BC:verb?b=1&b=2&c=x');
    await api.call(PARAM_ROUTE, { params: { name: 'n' } });
    expect(f.calls[1]?.url).toBe('/api/v1/t/n:verb');

    const page = fakeFetch(() => jsonResponse(200, { items: [], next_cursor: null }));
    const { api: api2 } = setup(page.fetch);
    await api2.call(EvidenceEventsRoute, { params: { concept_id: 'k8s.probes' }, query: {} });
    await api2.call(EvidenceEventsRoute, { params: { concept_id: 'k8s.probes' }, query: { limit: 10, cursor: 'abc' } });
    expect(page.calls.map((c) => c.url)).toEqual([
      '/api/v1/evidence/k8s.probes/events?limit=50',
      '/api/v1/evidence/k8s.probes/events?cursor=abc&limit=10',
    ]);

    const none = fakeFetch(OK);
    const { api: api3 } = setup(none.fetch);
    const bad = await api3.call(EvidenceEventsRoute, { params: { concept_id: 'BAD ID' }, query: {} });
    expect(bad).toMatchObject({ ok: false, kind: 'contract', status: null });
    if (!bad.ok && bad.kind === 'contract') {
      expect(bad.detail).toBe('request.params concept_id');
    }
    const badBody = await api3.call(IDEM_ROUTE, { body: { n: 'x' as unknown as number } });
    expect(badBody).toMatchObject({ ok: false, kind: 'contract' });
    expect(none.calls).toHaveLength(0);
    // 컴파일 단언: 라우트 입력·출력 타입이 계약과 맞는다
    const typed = await api3.call(SessionsAttemptsSubmitRoute, { params: { session_id: 'BAD' }, body: undefined });
    expect(typed.ok).toBe(false);
  });

  it('UT-WEB-012 accept·x-fathom-client 항상, 멱등 라우트 키 자동(옵션 키가 이김), 비멱등·GET 키 없음, body는 content-type이다 [IF-GW-020][NFR-MAINT-006]', async () => {
    const f = fakeFetch(OK);
    const { api, csrf } = setup(f.fetch);
    csrf.set(CSRF_43);
    await api.call(IDEM_ROUTE, { body: { n: 1 } });
    await api.call(IDEM_ROUTE, { body: { n: 2 } }, { idempotencyKey: 'MINE' });
    await api.call(PLAIN_POST, { body: { n: 3 } });
    await api.call(PARAM_ROUTE, { params: { name: 'x' } });
    const [a, b, c, d] = f.calls;
    expect(a?.headers['idempotency-key']).toBe('KEY-1');
    expect(b?.headers['idempotency-key']).toBe('MINE');
    expect(c?.headers['idempotency-key']).toBeUndefined();
    expect(d?.headers['idempotency-key']).toBeUndefined();
    for (const call of f.calls) {
      expect(call.headers.accept).toBe('application/json');
      expect(call.headers['x-fathom-client']).toBe(`web/${APP_VERSION}`);
      expect(call.init.credentials).toBe('same-origin');
    }
    expect(a?.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(a?.init.body).toBe('{"n":1}');
    expect(d?.headers['content-type']).toBeUndefined();
    expect(d?.init.body).toBeUndefined();
  });

  it('UT-WEB-004 x-fathom-csrf는 POST·PUT·PATCH·DELETE에만(csrf 설정 시) 붙고 GET·미설정은 없다 [NFR-SEC-002][IF-GW-003]', async () => {
    const f = fakeFetch(OK, () => new Response(null, { status: 204 }), OK, OK);
    const { api, csrf } = setup(f.fetch);
    await api.call(IDEM_ROUTE, { body: { n: 1 } }); // csrf 미설정 POST
    expect(f.calls[0]?.headers['x-fathom-csrf']).toBeUndefined();
    csrf.set(CSRF_43);
    await api.call(SessionLogoutRoute, {}); // POST
    await api.call(PLAIN_POST, { body: { n: 1 } }); // PUT
    await api.call(PARAM_ROUTE, { params: { name: 'x' } }); // GET
    expect(f.calls[1]?.headers['x-fathom-csrf']).toBe(CSRF_43);
    expect(f.calls[2]?.headers['x-fathom-csrf']).toBe(CSRF_43);
    expect(f.calls[3]?.headers['x-fathom-csrf']).toBeUndefined();
  });

  it('UT-WEB-013 2xx 검증·replayed, 204 null, 스키마 불일치·잘못된 Problem은 contract, problem+json은 problem, fetch throw는 network다 [STD-ERR-01]', async () => {
    const f = fakeFetch(
      () => jsonResponse(200, STATUS_BODY, { 'idempotent-replayed': 'true' }),
      () => jsonResponse(200, { authenticated: false }),
      () => new Response(null, { status: 204 }),
      () => problemResponse(404, 'GW-NOTFOUND-001'),
      () =>
        new Response(JSON.stringify({ nope: true }), {
          status: 400,
          headers: { 'content-type': 'application/problem+json' },
        }),
      () => new Response('<html>', { status: 502, headers: { 'content-type': 'text/html' } }),
      new Error('connect ECONNREFUSED'),
    );
    const { api } = setup(f.fetch);
    const ok = await api.call(SessionStatusRoute, {});
    expect(ok).toMatchObject({ ok: true, status: 200, replayed: true });
    expect(await api.call(SessionStatusRoute, {})).toMatchObject({ ok: false, kind: 'contract', status: 200 });
    expect(await api.call(SessionLogoutRoute, {})).toMatchObject({
      ok: true,
      status: 204,
      data: null,
      replayed: false,
    });
    const prob = await api.call(SessionStatusRoute, {});
    expect(prob).toMatchObject({ ok: false, kind: 'problem', status: 404 });
    if (!prob.ok && prob.kind === 'problem') {
      expect(prob.problem.code).toBe('GW-NOTFOUND-001');
    }
    expect(await api.call(SessionStatusRoute, {})).toMatchObject({ ok: false, kind: 'contract', status: 400 });
    expect(await api.call(SessionStatusRoute, {})).toMatchObject({ ok: false, kind: 'contract', status: 502 });
    expect(await api.call(SessionStatusRoute, {})).toMatchObject({
      ok: false,
      kind: 'network',
      message: 'connect ECONNREFUSED',
    });
    // query()는 실패를 ApiError로 던진다
    const g = fakeFetch(() => problemResponse(500, 'GW-INTERNAL-001'));
    const { api: api2 } = setup(g.fetch);
    await expect(api2.query(SessionStatusRoute, {})).rejects.toBeInstanceOf(ApiError);
    const h = fakeFetch(() => jsonResponse(200, STATUS_BODY));
    expect((await setup(h.fetch).api.query(SessionStatusRoute, {})).boot_id).toBe(ULID_A);
  });

  it('UT-WEB-014 401 003·001은 onSessionLost 1회, 409 CONFLICT-010은 onVersionMismatch, 403 AUTH-002는 csrf 재조회 후 같은 키로 1회만 재시도한다 [NFR-SEC-002][FR-SET-023]', async () => {
    const onSessionLost = vi.fn();
    const onVersionMismatch = vi.fn();
    const f = fakeFetch(
      () => problemResponse(401, 'GW-AUTH-001'),
      () => problemResponse(401, 'GW-AUTH-003'),
      () => problemResponse(401, 'GW-AUTH-004'),
      () => problemResponse(409, 'GW-CONFLICT-010'),
    );
    const { api } = setup(f.fetch, { onSessionLost, onVersionMismatch });
    await api.call(SessionStatusRoute, {});
    await api.call(SessionStatusRoute, {});
    await api.call(SessionStatusRoute, {});
    expect(onSessionLost.mock.calls).toEqual([['GW-AUTH-001'], ['GW-AUTH-003']]);
    await api.call(SessionStatusRoute, {});
    expect(onVersionMismatch).toHaveBeenCalledTimes(1);

    // 403 GW-AUTH-002 → csrf 재조회 → 같은 키로 재시도
    const newCsrf = 'n'.repeat(43);
    const g = fakeFetch(
      () => problemResponse(403, 'GW-AUTH-002'),
      () => jsonResponse(200, { csrf: newCsrf }),
      OK,
    );
    const { api: api2, csrf } = setup(g.fetch);
    csrf.set(CSRF_43);
    const r = await api2.call(IDEM_ROUTE, { body: { n: 1 } });
    expect(r.ok).toBe(true);
    expect(g.calls.map((c) => c.url)).toEqual(['/api/v1/t/idem', SessionCsrfRoute.path, '/api/v1/t/idem']);
    expect(g.calls[0]?.headers['idempotency-key']).toBe('KEY-1');
    expect(g.calls[2]?.headers['idempotency-key']).toBe('KEY-1');
    expect(g.calls[2]?.headers['x-fathom-csrf']).toBe(newCsrf);
    expect(csrf.get()).toBe(newCsrf);

    // 2번째도 403이면 그대로 반환(무한 재시도 0)
    const h = fakeFetch(
      () => problemResponse(403, 'GW-AUTH-002'),
      () => jsonResponse(200, { csrf: newCsrf }),
      () => problemResponse(403, 'GW-AUTH-002'),
    );
    const { api: api3 } = setup(h.fetch);
    const r2 = await api3.call(IDEM_ROUTE, { body: { n: 1 } });
    expect(r2).toMatchObject({ ok: false, kind: 'problem', status: 403 });
    expect(h.calls).toHaveLength(3);
  });

  it('UT-WEB-015 isRetryable 표와 createQueryClient retry 함수는 재시도 가능 실패만 2회 재시도한다 [IF-01 §2.5]', () => {
    const prob = (retryable: boolean) => ({
      kind: 'problem' as const,
      status: 503,
      problem: problemBody(503, 'GW-DEP-001', { retryable }),
    });
    expect(isRetryable({ kind: 'network', message: 'x' })).toBe(true);
    expect(isRetryable(prob(true))).toBe(true);
    expect(isRetryable(prob(false))).toBe(false);
    expect(isRetryable({ kind: 'contract', status: null, detail: 'x' })).toBe(false);

    const retry = createQueryClient().getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe('function');
    const err = new ApiError(prob(true));
    expect([0, 1, 2, 3].map((n) => shouldRetryQuery(n, err))).toEqual([true, true, true, false]);
    expect(shouldRetryQuery(0, new ApiError({ kind: 'contract', status: null, detail: 'x' }))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(prob(false)))).toBe(false);
    expect(shouldRetryQuery(0, new Error('plain'))).toBe(false);
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
    const delay = defaults.queries?.retryDelay;
    expect(typeof delay === 'function' ? [0, 1, 5, 9].map((n) => delay(n, err)) : null).toEqual([
      1000, 2000, 30_000, 30_000,
    ]);
  });
});
