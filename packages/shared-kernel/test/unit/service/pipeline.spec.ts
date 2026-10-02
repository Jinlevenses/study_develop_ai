import { Problem } from '@fathom/contracts/common/problem';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError, err, ok } from '../../../src/errors/errors.js';
import { isUlid } from '../../../src/ids/ids.js';
import { DeadlineRoute, EchoRoute, fixtureDef, ItemRoute, PublicRoute, SelectRoute } from './routes.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, LEARNING, OPS, rigOf, TEST_CALLER_TOKENS } from './support.js';

const rigs: Rig[] = [];
async function make(over: Parameters<typeof rigOf>[1] = {}): Promise<Rig> {
  const rig = await rigOf(fixtureDef(defOf('content')), over);
  rigs.push(rig);
  return rig;
}
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const post = (rig: Rig, url: string, body: unknown, headers: Record<string, string> = GATEWAY) =>
  rig.app.fastify.inject({
    method: 'POST',
    url,
    headers: { ...JSON_HEADERS, ...headers },
    payload: JSON.stringify(body),
  });
const problemOf = (body: string): Problem => Problem.parse(JSON.parse(body));

describe('요청 id · traceparent · cache-control', () => {
  it('UT-SK-172 내부 요청의 x-request-id echo·누락 시 생성 + warn·/api는 항상 새 값·traceparent 자식 span·no-store [NFR-SEC-003][IF-COM-001]', async () => {
    // Arrange
    const rig = await make();
    const rid = '01J0000000000000000000ABCD';
    const trace = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    // Act: 유효한 id·traceparent
    const a = await rig.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/test/deadline',
      headers: { ...GATEWAY, 'x-request-id': rid, traceparent: trace },
    });
    // Assert
    expect(a.statusCode).toBe(200);
    expect(a.headers['x-request-id']).toBe(rid);
    expect(a.headers['cache-control']).toBe('no-store');
    const body = DeadlineRoute.response[200].parse(JSON.parse(a.body));
    expect(body.request_id).toBe(rid);
    expect(body.traceparent).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
    expect(body.traceparent).not.toBe(trace);
    expect(rig.cap.lines().some((l) => l.event === 'http.request_id.missing')).toBe(false);
    // Act: 누락 → 새 값 + warn
    const b = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/test/deadline', headers: GATEWAY });
    const rid2 = String(b.headers['x-request-id']);
    expect(isUlid(rid2)).toBe(true);
    expect(rid2).not.toBe(rid);
    expect(JSON.parse(b.body).traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/); // 새 루트
    const warns = rig.cap.lines().filter((l) => l.event === 'http.request_id.missing');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ level: 'warn', req_id: rid2 });
    // 무효 id도 새로 만든다
    const c = await rig.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/test/deadline',
      headers: { ...GATEWAY, 'x-request-id': 'not-ulid', traceparent: 'garbage' },
    });
    expect(isUlid(String(c.headers['x-request-id']))).toBe(true);
  });

  it('UT-SK-172 /api는 클라이언트가 보낸 x-request-id를 무시한다 [IF-COM-001]', async () => {
    // Arrange
    const rig = await rigOf({
      ...defOf('gateway'),
      register: (app) =>
        app.route(PublicRoute, (ctx) => Promise.resolve({ status: 200, body: { caller: ctx.caller } })),
      publicAuth: () => Promise.resolve(ok('browser')),
    });
    rigs.push(rig);
    const rid = '01J0000000000000000000ABCD';
    // Act
    const res = await rig.app.fastify.inject({
      method: 'GET',
      url: '/api/v1/test/public',
      headers: { 'x-request-id': rid },
    });
    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).not.toBe(rid);
    expect(isUlid(String(res.headers['x-request-id']))).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual({ caller: 'browser' });
  });
});

describe('인증 · ACL', () => {
  it('UT-SK-173 토큰 없음 401 AUTH-900·허용 밖 호출자 403 ACL-900·health 무인증 [NFR-SEC-003][IF-COM-001]', async () => {
    // Arrange
    const rig = await make();
    // Act / Assert
    const none = await post(rig, '/internal/v1/test/echo', { name: 'a' }, {});
    expect(none.statusCode).toBe(401);
    expect(problemOf(none.body).code).toBe('CT-AUTH-900');
    expect(none.headers['content-type']).toMatch(/^application\/problem\+json/);
    const wrong = await post(
      rig,
      '/internal/v1/test/echo',
      { name: 'a' },
      { authorization: `Bearer ${'f'.repeat(64)}` },
    );
    expect(wrong.statusCode).toBe(401);
    const forbidden = await post(rig, '/internal/v1/test/echo', { name: 'a' }, OPS); // ops-api ∉ allowedCallers
    expect(forbidden.statusCode).toBe(403);
    expect(problemOf(forbidden.body).code).toBe('CT-ACL-900');
    const ok200 = await post(rig, '/internal/v1/test/echo', { name: 'a' }, LEARNING);
    expect(ok200.statusCode).toBe(200);
    // health는 무인증
    expect((await rig.app.fastify.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await rig.app.fastify.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
    // 401/403은 warn 로그
    const lines = rig.cap.lines().filter((l) => l.event === 'http.error');
    expect(lines.filter((l) => l.level === 'warn').map((l) => l.code)).toEqual([
      'CT-AUTH-900',
      'CT-AUTH-900',
      'CT-ACL-900',
    ]);
  });

  it('UT-SK-173 publicAuth 훅 거절은 그대로 응답하고, 훅 없이 /api 라우트를 등록하면 던진다 [NFR-SEC-003]', async () => {
    // Arrange
    const denied = await rigOf(
      {
        ...defOf('gateway'),
        register: (app) => app.route(PublicRoute, () => Promise.resolve({ status: 200, body: { caller: 'x' } })),
        publicAuth: () => Promise.resolve(err(new AppError('GW-AUTH-001', 401, '쿠키가 없다'))),
      },
      {},
    );
    rigs.push(denied);
    // Act / Assert: 훅은 있지만 GW-AUTH-001은 gateway 레지스트리에 없다 → 결함으로 500 INTERNAL-900
    const res = await denied.app.fastify.inject({ method: 'GET', url: '/api/v1/test/public' });
    expect(res.statusCode).toBe(500);
    expect(problemOf(res.body).code).toBe('GW-INTERNAL-900');
    // 훅 없이 /api 등록 → 조립 시점에 던진다
    await expect(
      rigOf({
        ...defOf('gateway'),
        register: (app) => app.route(PublicRoute, () => Promise.resolve({ status: 200, body: { caller: 'x' } })),
      }),
    ).rejects.toThrow(/no publicAuth hook/);
  });
});

describe('검증', () => {
  it('UT-SK-174 VAL-900 errors[]·strict 미지 키·NFC·415·413·잘못된 JSON·__proto__ [NFR-SEC-003][NFR-SEC-012][IF-COM-001]', async () => {
    // Arrange
    const rig = await make();
    // Act / Assert: 스키마 위반
    const bad = await post(rig, '/internal/v1/test/echo', { name: '', n: 'x' });
    expect(bad.statusCode).toBe(400);
    const p = problemOf(bad.body);
    expect(p.code).toBe('CT-VAL-900');
    expect(p.errors?.map((e) => e.path).sort()).toEqual(['n', 'name']);
    expect(p.errors?.every((e) => e.rule.length > 0 && e.message.length <= 300)).toBe(true);
    // strict 미지 키
    const extra = await post(rig, '/internal/v1/test/echo', { name: 'a', surplus: 1 });
    expect(extra.statusCode).toBe(400);
    expect(problemOf(extra.body).errors?.[0]?.rule).toBe('unrecognized_keys');
    // 기본값 채움
    const defaults = await post(rig, '/internal/v1/test/echo', { name: 'a' });
    expect(JSON.parse(defaults.body)).toEqual({ name: 'a', n: 1 });
    // NFC: 분해형 한글 → 조합형
    const decomposed = 'ㅎㅏㄴ'.normalize('NFD');
    const nfd = '한'.normalize('NFD');
    expect(nfd).not.toBe('한');
    const nfc = await post(rig, '/internal/v1/test/echo', { name: nfd });
    expect(JSON.parse(nfc.body).name).toBe('한');
    expect(decomposed.length).toBeGreaterThan(0);
    // 415
    const ct = await rig.app.fastify.inject({
      method: 'POST',
      url: '/internal/v1/test/echo',
      headers: { ...GATEWAY, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(ct.statusCode).toBe(415);
    expect(problemOf(ct.body).code).toBe('CT-VAL-904');
    // 413
    const big = await rig.app.fastify.inject({
      method: 'POST',
      url: '/internal/v1/test/echo',
      headers: { ...GATEWAY, ...JSON_HEADERS },
      payload: JSON.stringify({ name: 'x'.repeat(262_200) }),
    });
    expect(big.statusCode).toBe(413);
    expect(problemOf(big.body).code).toBe('CT-LIMIT-900');
    // 잘못된 JSON·빈 본문·__proto__
    for (const payload of ['{bad', '', '{"__proto__":{"x":1},"name":"a"}']) {
      const r = await rig.app.fastify.inject({
        method: 'POST',
        url: '/internal/v1/test/echo',
        headers: { ...GATEWAY, ...JSON_HEADERS },
        payload,
      });
      expect(r.statusCode, payload).toBe(400);
      expect(problemOf(r.body).code).toBe('CT-VAL-900');
    }
    // 본문 없음(스키마는 필수)
    const missing = await rig.app.fastify.inject({ method: 'POST', url: '/internal/v1/test/echo', headers: GATEWAY });
    expect(missing.statusCode).toBe(400);
  });

  it('UT-SK-176 404 NOTFOUND-900·{id} 경로·콜론 동사 경로·쿼리 [IF-COM-001]', async () => {
    // Arrange
    const rig = await make();
    // Act / Assert
    const nf = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/nope', headers: GATEWAY });
    expect(nf.statusCode).toBe(404);
    expect(problemOf(nf.body).code).toBe('CT-NOTFOUND-900');
    expect(problemOf(nf.body).instance).toBe('/internal/v1/nope');
    const item = await rig.app.fastify.inject({
      method: 'GET',
      url: `/internal/v1/items/${'k'.repeat(150)}?q=hello`,
      headers: GATEWAY,
    });
    expect(item.statusCode).toBe(200);
    expect(ItemRoute.response[200].parse(JSON.parse(item.body))).toEqual({ id: 'k'.repeat(150), q: 'hello' });
    const select = await post(rig, '/internal/v1/items:select', { ids: ['a', 'b'] });
    expect(select.statusCode).toBe(200);
    expect(SelectRoute.response[200].parse(JSON.parse(select.body))).toEqual({ count: 2 });
    const unknownQuery = await rig.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/items/x?bogus=1',
      headers: GATEWAY,
    });
    expect(unknownQuery.statusCode).toBe(400);
    // instance에는 쿼리가 없다
    expect(problemOf(unknownQuery.body).instance).toBe('/internal/v1/items/x');
  });
});

describe('응답 검증 · 데드라인', () => {
  it('UT-SK-175 응답 스키마 위반·미선언 상태 → 500 INTERNAL-901 + error 로그(값 없이 경로만) [NFR-SEC-012]', async () => {
    // Arrange
    const rig = await make();
    // Act
    const res = await rig.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/test/bad-response',
      headers: GATEWAY,
    });
    // Assert
    expect(res.statusCode).toBe(500);
    expect(problemOf(res.body).code).toBe('CT-INTERNAL-901');
    const invalid = rig.cap.lines().find((l) => l.event === 'response.invalid');
    expect(invalid).toMatchObject({ level: 'error', route: 'content.test.bad_response', paths: ['ok'] });
    expect(JSON.stringify(invalid)).not.toContain('false');
  });

  it('UT-SK-177 데드라인: 0 → 504 DEP-902, 600001·abc → 400, 없음 → now + (deadlineMs ?? 2000), 헤더 → now + 값 [NFR-SEC-003][IF-COM-001]', async () => {
    // Arrange
    const rig = await make();
    const at = (headers: Record<string, string>) =>
      rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/test/deadline', headers: { ...GATEWAY, ...headers } });
    // Act / Assert
    for (const v of ['0', '-5']) {
      const r = await at({ 'x-fathom-deadline-ms': v });
      expect(r.statusCode, v).toBe(504);
      expect(problemOf(r.body).code).toBe('CT-DEP-902');
      expect(r.headers['retry-after']).toBe('1');
    }
    for (const v of ['600001', 'abc', '1.5', '']) {
      const r = await at({ 'x-fathom-deadline-ms': v });
      expect(r.statusCode, v).toBe(400);
      expect(problemOf(r.body).errors?.[0]?.rule).toBe('deadline_header');
    }
    expect(JSON.parse((await at({})).body).deadline_at).toBe(rig.clock.now() + 750); // 라우트 deadlineMs
    expect(JSON.parse((await at({ 'x-fathom-deadline-ms': '1234' })).body).deadline_at).toBe(rig.clock.now() + 1234);
    expect(JSON.parse((await at({ 'x-fathom-deadline-ms': '600000' })).body).deadline_at).toBe(
      rig.clock.now() + 600_000,
    );
    const echo = await post(rig, '/internal/v1/test/echo', { name: 'a' }); // deadlineMs 없는 라우트는 기본 2000
    expect(echo.statusCode).toBe(200);
    expect(TEST_CALLER_TOKENS.gateway).toHaveLength(64);
  });

  it('UT-SK-196 요청당 span info 1줄(req_id·http.route·http.status·dur_ms)·본문 값 0 [NFR-MAINT-001]', async () => {
    // Arrange
    const rig = await make();
    // Act
    await post(rig, '/internal/v1/test/echo', { name: 'TOP-SECRET-VALUE' });
    await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/items/x?q=ALSO-SECRET', headers: GATEWAY });
    // Assert
    const spans = rig.cap.lines().filter((l) => l.event === 'span');
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      level: 'info',
      'http.route': 'content.test.echo',
      'http.status': 200,
      outcome: 'ok',
    });
    expect(isUlid(String(spans[0]?.req_id))).toBe(true);
    expect(typeof spans[0]?.dur_ms).toBe('number');
    expect(spans[0]?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(spans[0]?.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(rig.cap.lines())).not.toContain('SECRET');
    expect(EchoRoute.path).toBe('/internal/v1/test/echo');
  });
});

describe('라우터 단계 오류', () => {
  it('UT-SK-169 잘못된 퍼센트 인코딩 URL은 problem+json 400(VAL-900)이고, %XX·절대형으로 위장한 /internal 경로도 호출자 토큰 없이는 401이다 [IF-COM-001][NFR-SEC-003]', async () => {
    // Arrange
    const rig = await make();
    // Act
    const res = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/test/%E0%A4%A', headers: GATEWAY });
    // Assert
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(isUlid(res.headers['x-request-id'])).toBe(true);
    expect(problemOf(res.body).code).toMatch(/-VAL-900$/);
    // Act: 인증 등급은 일치한 라우트 경로로 정한다(원문 접두어 우회 차단)
    const encoded = await rig.app.fastify.inject({ method: 'GET', url: '/%69nternal/v1/test/deadline' });
    const absolute = await rig.app.fastify.inject({
      method: 'GET',
      url: 'http://127.0.0.1:1/internal/v1/test/deadline',
    });
    // Assert
    expect(encoded.statusCode).toBe(401);
    expect(absolute.statusCode).toBe(401);
  });
});
