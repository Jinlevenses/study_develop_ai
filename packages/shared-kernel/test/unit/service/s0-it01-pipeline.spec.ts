import net from 'node:net';
import { Problem } from '@fathom/contracts/common/problem';
import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ok } from '../../../src/errors/errors.js';
import { DeadlineRoute, EchoRoute, ItemRoute } from './routes.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, LEARNING, rigOf } from './support.js';

// T-01-01 §4.2-1·2 — 인증 분류 = 매칭된 라우트 기준 + 비정준 대상 거부 · 라우터 단계 오류 problem+json.

const base = { ifId: 'IF-GW-001', paginated: false, freeze: 'O', slice: 'R0', fr: [] } as const;
const BrowserOnlyRoute = defineRoute({
  ...base,
  id: 'gateway.test.browser_only',
  method: 'GET',
  path: '/api/v1/test/browser-only',
  allowedCallers: ['browser'],
  idempotent: false,
  request: {},
  response: { 200: S({ caller: z.string(), deadline_at: z.number().int() }) },
});
const BothRoute = defineRoute({
  ...base,
  id: 'gateway.test.both',
  method: 'GET',
  path: '/api/v1/test/both',
  allowedCallers: ['browser', 'cli'],
  idempotent: false,
  request: {},
  deadlineMs: 900,
  response: { 200: S({ caller: z.string(), deadline_at: z.number().int() }) },
});

type Counters = { echo: number; publicAuth: number; browserOnly: number };

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

/** content 서비스 모양 — 핸들러 호출 횟수를 센다. */
async function contentRig(counters: Counters): Promise<Rig> {
  const rig = await rigOf({
    ...defOf('content'),
    register: (app) => {
      app.route(EchoRoute, (ctx) => {
        counters.echo += 1;
        return Promise.resolve({ status: 200, body: { name: ctx.body.name, n: ctx.body.n } });
      });
      app.route(ItemRoute, (ctx) =>
        Promise.resolve({ status: 200, body: { id: ctx.params.id, q: ctx.query.q ?? null } }),
      );
      app.route(DeadlineRoute, (ctx) =>
        Promise.resolve({
          status: 200,
          body: {
            deadline_at: ctx.deadlineAt,
            request_id: ctx.requestId,
            traceparent: ctx.traceparent,
            caller: ctx.caller,
          },
        }),
      );
    },
  });
  rigs.push(rig);
  return rig;
}

/** gateway 모양 — /api 라우트 2종 + publicAuth(헤더 x-test-caller로 호출자를 고른다). */
async function gatewayRig(counters: Counters): Promise<Rig> {
  const rig = await rigOf({
    ...defOf('gateway'),
    publicAuth: (req) => {
      counters.publicAuth += 1;
      const who = req.headers['x-test-caller'];
      return Promise.resolve(who === 'cli' ? ok('cli') : ok('browser'));
    },
    register: (app) => {
      app.route(BrowserOnlyRoute, (ctx) => {
        counters.browserOnly += 1;
        return Promise.resolve({ status: 200, body: { caller: ctx.caller, deadline_at: ctx.deadlineAt } });
      });
      app.route(BothRoute, (ctx) =>
        Promise.resolve({ status: 200, body: { caller: ctx.caller, deadline_at: ctx.deadlineAt } }),
      );
    },
  });
  rigs.push(rig);
  return rig;
}

const fresh = (): Counters => ({ echo: 0, publicAuth: 0, browserOnly: 0 });
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const problemOf = (body: string): Problem => Problem.parse(JSON.parse(body));

/** 실제 listen + 원시 소켓 — light-my-request는 absolute-form·`*` 대상을 정규화해 버린다. */
async function rawRequest(
  rig: Rig,
  requestLine: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  if (!rig.app.fastify.server.listening) {
    await rig.app.fastify.listen({ port: 0, host: '127.0.0.1' });
  }
  const addr = rig.app.fastify.server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('no address');
  }
  const head = Object.entries({ host: `127.0.0.1:${addr.port}`, connection: 'close', ...headers })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
  return new Promise((resolve, reject) => {
    const socket = net.connect(addr.port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (c: string) => {
      data += c;
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? '0');
      resolve({ status, body: data.slice(data.indexOf('\r\n\r\n') + 4) });
    });
    socket.write(`${requestLine} HTTP/1.1\r\n${head}\r\n\r\n`);
  });
}

describe('인증 분류 = 라우트 기준 + 비정준 대상 거부', () => {
  it('UT-SK-200 /%69nternal 접두·인코딩된 비예약 문자·%2F로 위장한 /internal 대상은 인증·핸들러 전에 404 NOTFOUND-900이다 [NFR-SEC-003][IF-COM-001]', async () => {
    const counters = fresh();
    const rig = await contentRig(counters);
    for (const url of [
      '/%69nternal/v1/test/echo',
      '/internal/v1/%74est/echo',
      '/internal/v1/test/%65cho',
      '/internal%2Fv1/test/echo',
      '/internal/v1/test%2Fecho',
    ]) {
      for (const headers of [{}, GATEWAY]) {
        const res = await rig.app.fastify.inject({
          method: 'POST',
          url,
          headers: { ...JSON_HEADERS, ...headers },
          payload: JSON.stringify({ name: 'x' }),
        });
        expect(res.statusCode, url).toBe(404);
        expect(problemOf(res.body).code, url).toBe('CT-NOTFOUND-900');
        expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
        expect(res.headers['cache-control']).toBe('no-store');
      }
    }
    expect(counters.echo).toBe(0);
  });

  it('UT-SK-201 요청 줄이 absolute-form·asterisk-form이면 실제 소켓에서도 404 NOTFOUND-900이고 핸들러·인증은 0회다 [NFR-SEC-003][IF-COM-001]', async () => {
    const counters = fresh();
    const rig = await contentRig(counters);
    const token = GATEWAY.authorization;
    const abs = await rawRequest(rig, 'GET http://127.0.0.1:1/internal/v1/test/deadline', { authorization: token });
    expect(abs.status).toBe(404);
    expect(abs.body).toContain('CT-NOTFOUND-900');
    const noAuth = await rawRequest(rig, 'GET http://127.0.0.1:1/internal/v1/test/deadline');
    expect(noAuth.status).toBe(404);
    const star = await rawRequest(rig, 'OPTIONS *', { authorization: token });
    expect(star.status).toBe(404);
    expect(star.body).toContain('CT-NOTFOUND-900');
    // 대조군: 정준 origin-form은 처리된다.
    const ok1 = await rawRequest(rig, 'GET /internal/v1/test/deadline', { authorization: token });
    expect(ok1.status).toBe(200);
    expect(counters.echo).toBe(0);
  });

  it('UT-SK-202 정준 /internal 무토큰은 401 AUTH-900, 허용 밖 호출자는 403 ACL-900이다 [NFR-SEC-003][IF-COM-001]', async () => {
    const rig = await contentRig(fresh());
    const none = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/test/deadline' });
    expect(none.statusCode).toBe(401);
    expect(problemOf(none.body).code).toBe('CT-AUTH-900');
    const forbidden = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/items/a', headers: LEARNING });
    expect(forbidden.statusCode).toBe(403);
    expect(problemOf(forbidden.body).code).toBe('CT-ACL-900');
    const ok1 = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/items/a', headers: GATEWAY });
    expect(ok1.statusCode).toBe(200);
  });

  it('UT-SK-203 /api 라우트는 publicAuth 성공 뒤에도 호출자가 allowedCallers에 없으면 403 ACL-900이다 [NFR-SEC-003][IF-COM-001]', async () => {
    const counters = fresh();
    const rig = await gatewayRig(counters);
    const denied = await rig.app.fastify.inject({
      method: 'GET',
      url: '/api/v1/test/browser-only',
      headers: { 'x-test-caller': 'cli' },
    });
    expect(denied.statusCode).toBe(403);
    expect(problemOf(denied.body).code).toBe('GW-ACL-900');
    expect(counters.browserOnly).toBe(0);
    const allowed = await rig.app.fastify.inject({ method: 'GET', url: '/api/v1/test/browser-only' });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.parse(allowed.body)).toMatchObject({ caller: 'browser' });
    const both = await rig.app.fastify.inject({
      method: 'GET',
      url: '/api/v1/test/both',
      headers: { 'x-test-caller': 'cli' },
    });
    expect(both.statusCode).toBe(200);
  });

  it('UT-SK-204 health 정준 경로는 무인증 200이고 인코딩된 health 경로는 404다 [NFR-SEC-003][IF-COM-001]', async () => {
    const rig = await contentRig(fresh());
    for (const url of ['/healthz', '/readyz']) {
      const res = await rig.app.fastify.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
    for (const url of ['/%68ealthz', '/%72eadyz']) {
      const res = await rig.app.fastify.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(problemOf(res.body).code).toBe('CT-NOTFOUND-900');
    }
  });

  it('UT-SK-205 경로 파라미터 안의 예약 문자 %XX(%3A·%2F·%20)는 거절되지 않고 정상 처리된다 [NFR-SEC-003][IF-COM-001]', async () => {
    const rig = await contentRig(fresh());
    for (const [seg, id] of [
      ['a%3Ab', 'a:b'],
      ['a%2Fb', 'a/b'],
      ['a%20b', 'a b'],
      ['%ED%95%9C', '한'],
    ] as const) {
      const res = await rig.app.fastify.inject({
        method: 'GET',
        url: `/internal/v1/items/${seg}?q=%6d`,
        headers: GATEWAY,
      });
      expect(res.statusCode, seg).toBe(200);
      expect(JSON.parse(res.body), seg).toMatchObject({ id, q: 'm' });
    }
  });

  it('UT-SK-206 cache-control·데드라인 분류는 일치한 라우트 기준이다(/api는 데드라인 헤더 무시, /internal은 검증, 미일치 /internal은 no-store) [NFR-SEC-003][IF-COM-001]', async () => {
    const content = await contentRig(fresh());
    const gateway = await gatewayRig(fresh());
    // /api: 서버가 정한 데드라인(라우트 900ms) — 잘못된 헤더도 무시
    const api = await gateway.app.fastify.inject({
      method: 'GET',
      url: '/api/v1/test/both',
      headers: { 'x-fathom-deadline-ms': 'garbage' },
    });
    expect(api.statusCode).toBe(200);
    expect(api.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(api.body).deadline_at).toBe(gateway.clock.now() + 900);
    // /internal: 같은 잘못된 헤더는 400 VAL-900
    const internal = await content.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/test/deadline',
      headers: { ...GATEWAY, 'x-fathom-deadline-ms': 'garbage' },
    });
    expect(internal.statusCode).toBe(400);
    expect(problemOf(internal.body).code).toBe('CT-VAL-900');
    expect(internal.headers['cache-control']).toBe('no-store');
    // 미일치 /internal 경로(404)도 no-store, 무관 경로는 아니다
    const missing = await content.app.fastify.inject({ method: 'GET', url: '/internal/v1/nope', headers: GATEWAY });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');
    const other = await content.app.fastify.inject({ method: 'GET', url: '/nope' });
    expect(other.statusCode).toBe(404);
    expect(other.headers['cache-control']).toBeUndefined();
  });

  it('UT-SK-207 비정준 /api 대상은 publicAuth 훅과 핸들러에 닿기 전에 404 GW-NOTFOUND-900이다 [NFR-SEC-003][IF-COM-001]', async () => {
    const counters = fresh();
    const rig = await gatewayRig(counters);
    for (const url of ['/%61pi/v1/test/browser-only', '/api%2Fv1/test/browser-only', '/api/v1/%74est/browser-only']) {
      const res = await rig.app.fastify.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(problemOf(res.body).code).toBe('GW-NOTFOUND-900');
    }
    expect(counters.publicAuth).toBe(0);
    expect(counters.browserOnly).toBe(0);
  });
});

describe('라우터 단계 오류 problem+json', () => {
  it('UT-SK-210 잘못된 퍼센트 시퀀스(%zz·잘린 %E0%A4%A)는 400 problem+json VAL-900(rule bad_url)이고 x-request-id가 있다 [IF-COM-001]', async () => {
    const rig = await contentRig(fresh());
    for (const url of ['/internal/v1/items/%zz', '/internal/v1/test/%E0%A4%A', '/%zz']) {
      const res = await rig.app.fastify.inject({ method: 'GET', url, headers: GATEWAY });
      expect(res.statusCode, url).toBe(400);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(typeof res.headers['x-request-id']).toBe('string');
      const p = problemOf(res.body);
      expect(p.code).toBe('CT-VAL-900');
      expect(JSON.stringify(p)).toContain('"rule":"bad_url"');
      expect(JSON.stringify(p)).toContain('잘못된 퍼센트 인코딩');
      expect(p.request_id).toBe(res.headers['x-request-id']);
    }
  });

  it('UT-SK-211 과대 경로 파라미터는 400 problem+json VAL-900(rule max_param_length)이다 [IF-COM-001]', async () => {
    const rig = await contentRig(fresh());
    const res = await rig.app.fastify.inject({
      method: 'GET',
      url: `/internal/v1/items/${'a'.repeat(5000)}`,
      headers: GATEWAY,
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(typeof res.headers['x-request-id']).toBe('string');
    expect(problemOf(res.body).code).toBe('CT-VAL-900');
    expect(JSON.stringify(JSON.parse(res.body))).toContain('"rule":"max_param_length"');
  });

  it('UT-SK-212 프레임워크 오류 problem+json은 무토큰 요청에도 같은 모양이고 토큰·경로 원문·스택을 싣지 않는다 [IF-COM-001][NFR-SEC-003]', async () => {
    const rig = await contentRig(fresh());
    const res = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/items/%zz' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toMatch(/\n\s+at\s/);
    expect(res.body).not.toContain(GATEWAY.authorization);
    const p = problemOf(res.body);
    expect(p.status).toBe(400);
  });
});
