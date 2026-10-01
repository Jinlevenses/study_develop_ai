import {
  AdminShutdownRoute,
  COMMON_ADMIN_ROUTES,
  HealthLiveRoute,
  MetricsGetRoute,
} from '@fathom/contracts/admin/admin-routes';
import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CheckOptions, Injector, InjectRequest, RouteFixture } from '../../../src/contract.js';
import {
  checkRouteContract,
  checkRouteTable,
  collectRoutes,
  findForbiddenFields,
  ifNumber,
  TEST_CALLER_TOKENS,
} from '../../../src/contract.js';
import { fixedUlid } from '../../../src/ids.js';
import type { FakeRoute, Quirk } from './fake-server.js';
import { createFakeServer } from './fake-server.js';
import { CreateThing, GetQuestion, GetThing, ListThings, QuestionView, SafeView, sampleRoutes } from './sample-app.js';

const fixtures: Record<string, RouteFixture> = {
  create: { request: { body: { name: 'n', count: 1 } }, caller: 'gateway', expect: { status: 201 } },
  list: { request: { query: { limit: '10' } }, caller: 'gateway', expect: { status: 200 } },
  get: { request: { params: { thing_id: 'a b/c' } }, caller: 'gateway', expect: { status: 200 } },
  question: { request: { params: { item_id: 'q1' } }, caller: 'gateway', expect: { status: 200 } },
};

const options: CheckOptions = { callerTokens: TEST_CALLER_TOKENS, svcCode: 'LR' };

async function run(
  route: (typeof sampleRoutes)[number]['route'],
  fixture: RouteFixture,
  quirks: Quirk[] = [],
  extra: Partial<CheckOptions> = {},
  routes: FakeRoute[] = sampleRoutes,
): Promise<string[]> {
  const server = createFakeServer(routes, new Set(quirks));
  const violations = await checkRouteContract(route, server, fixture, { ...options, ...extra });
  return violations.map((v) => `${v.rule}`);
}

describe('checkRouteTable (C1)', () => {
  it('UT-TK-027 contracts 라우트와 등록 라우트가 양방향으로 일치하면 위반 0이다 [IR-015]', () => {
    // Arrange: Fastify 표기(:name, ::)로 등록된 표
    const routes = [GetThing, CreateThing];
    const registered = [
      { method: 'POST', url: '/internal/v1/things' },
      { method: 'GET', url: '/internal/v1/things/:thing_id' },
      { method: 'HEAD', url: '/internal/v1/things/:thing_id' },
      { method: 'OPTIONS', url: '/internal/v1/things' },
    ];
    // Act / Assert
    expect(checkRouteTable(routes, registered)).toEqual([]);
    expect(
      checkRouteTable(
        COMMON_ADMIN_ROUTES,
        COMMON_ADMIN_ROUTES.map((r) => ({ method: r.method, url: r.path })),
      ),
    ).toEqual([]);
  });

  it('UT-TK-028 누락(계약에만)·초과(등록에만)·콜론 동사 정규화를 검출한다 [IR-015]', () => {
    // 누락(계약에만)·초과(등록에만)·콜론 동사 정규화를 검출한다 [IR-015]
    {
      // Arrange
      const verb = defineRoute({
        ...GetThing,
        id: 'learning.things.select',
        method: 'POST',
        path: '/internal/v1/things/{thing_id}:select',
      });
      // Act
      const missing = checkRouteTable(
        [GetThing, CreateThing],
        [{ method: 'GET', url: '/internal/v1/things/:thing_id' }],
      );
      const extra = checkRouteTable(
        [GetThing],
        [
          { method: 'GET', url: '/internal/v1/things/:thing_id' },
          { method: 'DELETE', url: '/internal/v1/things/:thing_id' },
        ],
      );
      const colon = checkRouteTable([verb], [{ method: 'POST', url: '/internal/v1/things/:thing_id::select' }]);
      // Assert
      expect(missing).toEqual([
        { rule: 'C1', route_id: 'learning.things.create', detail: 'not registered: POST /internal/v1/things' },
      ]);
      expect(extra).toHaveLength(1);
      expect(extra[0]).toMatchObject({ rule: 'C1', route_id: 'DELETE /internal/v1/things/{thing_id}' });
      expect(colon).toEqual([]);
    }
    // collectRoutes는 export·배열 안의 라우트를 id 중복 없이 모은다 [IR-015]
    {
      // Act
      const routes = collectRoutes([
        { CreateThing, notRoute: { id: 'x' }, ALL: [CreateThing, ListThings] },
        { GetThing, again: GetThing },
      ]);
      // Assert
      expect(routes.map((r) => r.id)).toEqual([
        'learning.things.create',
        'learning.things.list',
        'learning.things.get',
      ]);
    }
  });
});

describe('checkRouteContract (C2~C9)', () => {
  it('UT-TK-029 적합 서버는 모든 샘플 라우트에서 위반 0이다(C2 + 경로 치환) [IR-015][NFR-SEC-012]', async () => {
    // 적합 서버는 모든 샘플 라우트에서 위반 0이다(C2 + 경로 치환) [IR-015][NFR-SEC-012]
    {
      // Act
      const results = await Promise.all([
        run(CreateThing, fixtures.create as RouteFixture),
        run(ListThings, fixtures.list as RouteFixture),
        run(GetThing, fixtures.get as RouteFixture),
      ]);
      // Assert
      expect(results).toEqual([[], [], []]);
    }
    // 경로 변수는 URL 인코딩으로 치환된다 [IR-015]
    {
      // Arrange
      const seen: InjectRequest[] = [];
      const inner = createFakeServer(sampleRoutes);
      const spy: Injector = {
        inject: (req) => {
          seen.push(req);
          return inner.inject(req);
        },
      };
      // Act
      await checkRouteContract(GetThing, spy, fixtures.get as RouteFixture, options);
      // Assert
      expect(seen[0]?.url).toBe('/internal/v1/things/a%20b%2Fc');
      expect(seen[0]?.headers.authorization).toBe(`Bearer ${TEST_CALLER_TOKENS.gateway}`);
    }
    // 응답 본문이 스키마를 어기면 C2 위반이다 [IR-015]
    {
      expect(await run(GetThing, fixtures.get as RouteFixture, ['bad_c2'])).toContain('C2');
      const wrongStatus = { ...(fixtures.get as RouteFixture), expect: { status: 200 } };
      const server = createFakeServer([
        { route: GetThing, respond: () => ({ status: 200, body: { id: 'x', name: 'n' } }) },
      ]);
      expect(await checkRouteContract(GetThing, server, { ...wrongStatus, expect: { status: 204 } }, options)).toEqual(
        expect.arrayContaining([expect.objectContaining({ rule: 'C2' })]),
      );
    }
  });

  it('UT-TK-030 검증을 건너뛰는 서버는 C3 위반이다(필수 삭제·미지 키·타입 위반) [IR-015][NFR-SEC-012]', async () => {
    // Act
    const violations = await checkRouteContract(
      CreateThing,
      createFakeServer(sampleRoutes, new Set<Quirk>(['no_validation'])),
      fixtures.create as RouteFixture,
      options,
    );
    // Assert
    const c3 = violations.filter((v) => v.rule === 'C3').map((v) => v.detail);
    expect(c3.some((d) => d.includes('drop_required(name)'))).toBe(true);
    expect(c3.some((d) => d.includes('unknown_key'))).toBe(true);
    expect(c3.some((d) => d.includes('type_violation(count)'))).toBe(true);
  });

  it('UT-TK-031 인증을 건너뛰는 서버는 C4 위반이다 [IR-015][NFR-SEC-012]', async () => {
    const violations = await run(CreateThing, fixtures.create as RouteFixture, ['no_auth']);
    expect(violations).toContain('C4');
    // 허용 밖 호출자가 2xx를 받는 경우도 검출(적합 서버는 403)
    expect(await run(ListThings, fixtures.list as RouteFixture)).toEqual([]);
  });

  it('UT-TK-032 멱등 규칙 위반(키 불요·충돌 무시·재생 헤더 없음)을 C5로 검출한다 [IR-015]', async () => {
    const create = fixtures.create as RouteFixture;
    expect(await run(CreateThing, create, ['no_key_required'])).toContain('C5');
    expect(await run(CreateThing, create, ['no_conflict'])).toContain('C5');
    expect(await run(CreateThing, create, ['no_replay_header'])).toContain('C5');
    // 본문 검증을 키 조회보다 먼저 하는 적합 서버: 열거형·ULID·빈 본문은 변이를 스키마 안에서만 만든다(오탐 방지).
    const enumRoute = defineRoute({
      id: 'learning.resume.post',
      ifId: 'IF-LR-9005',
      method: 'POST',
      path: '/internal/v1/resume',
      allowedCallers: ['gateway'],
      idempotent: true,
      paginated: false,
      request: {
        body: S({ epoch_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/), outcome: z.enum(['ok', 'failed']) }),
      },
      response: { 200: S({ done: z.boolean() }) },
      freeze: 'D',
      slice: 'R0',
      fr: [],
    });
    const emptyRoute = defineRoute({
      id: 'learning.empty.post',
      ifId: 'IF-LR-9006',
      method: 'POST',
      path: '/internal/v1/empty',
      allowedCallers: ['gateway'],
      idempotent: true,
      paginated: false,
      request: { body: S({}) },
      response: { 200: S({ done: z.boolean() }) },
      freeze: 'D',
      slice: 'R0',
      fr: [],
    });
    const extraRoutes: FakeRoute[] = [enumRoute, emptyRoute].map((route) => ({
      route,
      respond: () => ({ status: 200, body: { done: true } }),
    }));
    const enumFixture: RouteFixture = {
      request: { body: { epoch_id: fixedUlid(1), outcome: 'ok' } },
      caller: 'gateway',
      expect: { status: 200 },
    };
    expect(await run(enumRoute, enumFixture, ['validate_first'], {}, extraRoutes)).toEqual([]);
    const notes: string[] = [];
    const emptyFixture: RouteFixture = { request: { body: {} }, caller: 'gateway', expect: { status: 200 } };
    expect(await run(emptyRoute, emptyFixture, ['validate_first'], { notes }, extraRoutes)).toEqual([]);
    expect(notes.join('\n')).toContain('C5 conflict sub-check skipped');
    // 충돌을 무시하는 서버는 열거형 본문에서도 여전히 C5로 잡힌다.
    expect(await run(enumRoute, enumFixture, ['validate_first', 'no_conflict'], {}, extraRoutes)).toContain('C5');
  });

  it('UT-TK-033 오류 응답에 스택·절대경로가 새거나 content-type이 틀리면 C6 위반이다 [IR-015][NFR-SEC-012]', async () => {
    // 오류 응답에 스택·절대경로가 새거나 content-type이 틀리면 C6 위반이다 [IR-015][NFR-SEC-012]
    {
      // Act
      const leaked = await checkRouteContract(
        CreateThing,
        createFakeServer(sampleRoutes, new Set<Quirk>(['stack_leak'])),
        fixtures.create as RouteFixture,
        options,
      );
      const wrongType = await run(CreateThing, fixtures.create as RouteFixture, ['plain_error_content_type']);
      // Assert
      expect(
        leaked
          .filter((v) => v.rule === 'C6')
          .map((v) => v.detail)
          .join('|'),
      ).toMatch(/leaks " {4}at "/);
      expect(
        leaked
          .filter((v) => v.rule === 'C6')
          .map((v) => v.detail)
          .join('|'),
      ).toMatch(/leaks "\/home\/"/);
      expect(wrongType).toContain('C6');
    }
    // type과 code가 어긋난 Problem·SQL 키워드 누출도 C6로 검출한다 [NFR-SEC-012]
    {
      // Arrange
      const bad = (body: Record<string, unknown>): Injector => ({
        inject: () =>
          Promise.resolve({
            statusCode: 400,
            headers: { 'content-type': 'application/problem+json' },
            body: JSON.stringify({
              type: 'urn:fathom:problem:lr-val-900',
              title: 't',
              status: 400,
              code: 'LR-VAL-900',
              error_id: fixedUlid(1),
              request_id: fixedUlid(2),
              retryable: false,
              ...body,
            }),
          }),
      });
      // Act
      const mismatch = await checkRouteContract(
        GetThing,
        bad({ type: 'urn:fathom:problem:lr-val-901' }),
        fixtures.get as RouteFixture,
        options,
      );
      const sql = await checkRouteContract(
        GetThing,
        bad({ detail: 'SELECT * FROM t' }),
        fixtures.get as RouteFixture,
        options,
      );
      // Assert
      expect(mismatch.some((v) => v.rule === 'C6' && v.detail.includes('does not match code'))).toBe(true);
      expect(sql.some((v) => v.rule === 'C6' && v.detail.includes('SELECT '))).toBe(true);
    }
  });

  it('UT-TK-034 데드라인 0을 무시하면 C7, 목록이 최상위 배열이면 C8 위반이다 [IR-015]', async () => {
    expect(await run(GetThing, fixtures.get as RouteFixture, ['ignore_deadline'])).toContain('C7');
    const listViolations = await run(ListThings, fixtures.list as RouteFixture, ['array_list']);
    expect(listViolations).toEqual(expect.arrayContaining(['C8']));
    expect(await run(ListThings, fixtures.list as RouteFixture)).toEqual([]);
  });

  it('UT-TK-035 pre-submit 스키마가 금지 필드를 노출하면 C9 위반이고 findForbiddenFields가 correct_option을 검출한다 [NFR-SEC-012]', async () => {
    // pre-submit 스키마가 금지 필드를 노출하면 C9 위반이고 findForbiddenFields가 correct_option을 검출한다 [NFR-SEC-012]
    {
      // Assert
      expect(findForbiddenFields(QuestionView)).toEqual(['choices.[].correct_option']);
      expect(findForbiddenFields(SafeView)).toEqual([]);
      expect(
        findForbiddenFields(S({ answer_key: z.string(), nested: S({ explanation: z.string().optional() }) })),
      ).toEqual(['answer_key', 'nested.explanation']);
      const unsafe = await run(GetQuestion, fixtures.question as RouteFixture, [], {
        preSubmitSchemas: [QuestionView],
      });
      expect(unsafe).toEqual(['C9']);
      expect(await run(GetQuestion, fixtures.question as RouteFixture, [], { preSubmitSchemas: [SafeView] })).toEqual(
        [],
      );
      expect(await run(GetQuestion, fixtures.question as RouteFixture)).toEqual([]);
    }
    // IF-COM-nnn은 CT 6nn으로, 서비스 IF는 그대로 번호를 받아 겹치지 않는다 [IR-015]
    {
      // Arrange / Act
      const com = ifNumber(HealthLiveRoute);
      const service = ifNumber(GetThing);
      // Assert
      expect(com).toMatch(/^6\d\d$/);
      expect(service).toBe(/(\d+)$/.exec(GetThing.ifId)?.[1]?.padStart(3, '0'));
      expect(com).not.toBe(service);
    }
    // IF-COM 라우트(health·metrics·shutdown)가 적합 서버에서 위반 0이다 [IR-015]
    {
      // Arrange
      const comRoutes: FakeRoute[] = [
        {
          route: HealthLiveRoute,
          respond: () => ({
            status: 200,
            body: { ok: true, svc: 'learning', version: '1.0.0', boot_id: fixedUlid(1), uptime_ms: 5 },
          }),
        },
        { route: MetricsGetRoute, respond: () => ({ status: 200, body: '# TYPE x gauge\nx 1\n' }) },
        { route: AdminShutdownRoute, respond: () => ({ status: 202, body: { accepted_at: 1, grace_ms: 3000 } }) },
      ];
      const caller = (c: 'learning' | 'ops-api', status: number, body?: unknown): RouteFixture => ({
        request: body === undefined ? {} : { body },
        caller: c,
        expect: { status },
      });
      // Act / Assert
      expect(await run(HealthLiveRoute, caller('learning', 200), [], {}, comRoutes)).toEqual([]);
      expect(await run(MetricsGetRoute, caller('ops-api', 200), [], {}, comRoutes)).toEqual([]);
      expect(await run(AdminShutdownRoute, caller('ops-api', 202, { grace_ms: 1000 }), [], {}, comRoutes)).toEqual([]);
    }
  });
});
