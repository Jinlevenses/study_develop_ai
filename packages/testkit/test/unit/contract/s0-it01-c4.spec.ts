import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Injector, InjectRequest, InjectResponse, RouteFixture } from '../../../src/contract.js';
import { checkRouteContract, RouteFixture as RouteFixtureSchema, TEST_CALLER_TOKENS } from '../../../src/contract.js';
import type { FakeRoute } from './fake-server.js';
import { createFakeServer } from './fake-server.js';

// T-01-01 §4.4 (CO-15) — C4 허용 호출자 2xx 검사가 `request_by_caller[caller] ?? request`로 보낸다.

const Owned = S({ owner: z.string() });
const BoundRoute = defineRoute({
  id: 'learning.bound.create',
  ifId: 'IF-LR-9101',
  method: 'POST',
  path: '/internal/v1/bound',
  allowedCallers: ['gateway', 'content'],
  idempotent: false,
  paginated: false,
  request: { body: Owned },
  response: { 200: S({ ok: z.boolean() }) },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
// 호출자 = body.owner 여야 2xx(IF-COM-004 inbox의 producer 규칙과 같은 모양).
const bound: FakeRoute = {
  route: BoundRoute,
  respond: ({ body, caller }) =>
    typeof body === 'object' && body !== null && 'owner' in body && body.owner === caller
      ? { status: 200, body: { ok: true } }
      : { status: 403, body: { detail: 'owner must equal caller' } },
};
const base: RouteFixture = { request: { body: { owner: 'gateway' } }, caller: 'gateway', expect: { status: 200 } };
const opts = { callerTokens: TEST_CALLER_TOKENS, svcCode: 'LR' } as const;

async function c4(fixture: RouteFixture): Promise<string[]> {
  const violations = await checkRouteContract(BoundRoute, createFakeServer([bound]), fixture, opts);
  return violations.filter((v) => v.rule === 'C4').map((v) => v.detail);
}

describe('C4 호출자별 요청(request_by_caller)', () => {
  it('UT-TK-070 request_by_caller가 있으면 허용 호출자마다 자기 본문으로 2xx를 검사한다 [IR-015]', async () => {
    const fixture: RouteFixture = {
      ...base,
      request_by_caller: { gateway: { body: { owner: 'gateway' } }, content: { body: { owner: 'content' } } },
    };
    expect(await c4(fixture)).toEqual([]);
  });

  it('UT-TK-071 미지정이면 기존 동작 — 모든 허용 호출자에 fixture.request를 보내고, 일부 호출자만 지정하면 나머지는 request로 폴백한다 [IR-015]', async () => {
    expect(await c4(base)).toEqual(['allowed caller content: expected 2xx, got 403']);
    const partial: RouteFixture = { ...base, request_by_caller: { content: { body: { owner: 'content' } } } };
    expect(await c4(partial)).toEqual([]);
    // 호출자별 요청이 틀리면 그 호출자만 위반이다.
    const wrong: RouteFixture = { ...base, request_by_caller: { content: { body: { owner: 'learning' } } } };
    expect(await c4(wrong)).toEqual(['allowed caller content: expected 2xx, got 403']);
  });

  it('UT-TK-072 무토큰 401·허용 밖 호출자 403 검사는 request_by_caller를 쓰지 않고 fixture.request 그대로 보낸다 [IR-015]', async () => {
    const seen: { auth: string | undefined; owner: unknown }[] = [];
    const inner = createFakeServer([bound]);
    const recording: Injector = {
      inject: (req: InjectRequest) => {
        const parsed: unknown = req.payload === undefined ? undefined : JSON.parse(req.payload);
        seen.push({
          auth: req.headers.authorization,
          owner: typeof parsed === 'object' && parsed !== null && 'owner' in parsed ? parsed.owner : undefined,
        });
        return inner.inject(req);
      },
    };
    const fixture: RouteFixture = {
      ...base,
      request_by_caller: {
        gateway: { body: { owner: 'gateway' } },
        content: { body: { owner: 'content' } },
        learning: { body: { owner: 'BY-CALLER-LEARNING' } }, // 허용 밖 호출자의 항목 — 보내면 안 된다
      },
    };
    const violations = await checkRouteContract(BoundRoute, recording, fixture, opts);
    expect(violations.filter((v) => v.rule === 'C4')).toEqual([]);
    const tokenOf = (svc: keyof typeof TEST_CALLER_TOKENS): string => `Bearer ${TEST_CALLER_TOKENS[svc]}`;
    expect(seen.filter((r) => r.auth === undefined).every((r) => r.owner === 'gateway')).toBe(true);
    expect(seen.filter((r) => r.auth === tokenOf('learning')).every((r) => r.owner === 'gateway')).toBe(true);
    expect(seen.some((r) => r.auth === tokenOf('content') && r.owner === 'content')).toBe(true);
    expect(seen.some((r) => r.owner === 'BY-CALLER-LEARNING')).toBe(false);
  });

  it('UT-TK-073 공개 호출자(browser·cli) 분기도 같은 규칙이고, 스키마는 부분 레코드·여분 키 거부다 [IR-015]', async () => {
    const PublicRoute = defineRoute({
      ...BoundRoute,
      id: 'gateway.bound.create',
      ifId: 'IF-GW-9101',
      path: '/api/v1/bound',
      allowedCallers: ['browser', 'cli'],
    });
    const seen: { who: string | undefined; owner: unknown }[] = [];
    const server: Injector = {
      inject: (req: InjectRequest): Promise<InjectResponse> => {
        const who = req.headers['x-test-caller'];
        const parsed: unknown = req.payload === undefined ? undefined : JSON.parse(req.payload);
        const owner = typeof parsed === 'object' && parsed !== null && 'owner' in parsed ? parsed.owner : undefined;
        seen.push({ who, owner });
        const good = who !== undefined && who === owner;
        return Promise.resolve({
          statusCode: good ? 200 : who === undefined ? 401 : 403,
          headers: { 'content-type': good ? 'application/json' : 'application/problem+json' },
          body: JSON.stringify(good ? { ok: true } : { detail: 'x' }),
        });
      },
    };
    const fixture: RouteFixture = {
      request: { body: { owner: 'browser' } },
      request_by_caller: { cli: { body: { owner: 'cli' } } },
      caller: 'browser',
      expect: { status: 200 },
    };
    const violations = await checkRouteContract(PublicRoute, server, fixture, {
      ...opts,
      publicAuth: { headersFor: (caller) => Promise.resolve({ 'x-test-caller': caller }) },
    });
    expect(violations.filter((v) => v.rule === 'C4')).toEqual([]);
    expect(seen.some((r) => r.who === 'cli' && r.owner === 'cli')).toBe(true);
    // 스키마 — 호출자 이름 키만, 요청 모양은 strict.
    expect(RouteFixtureSchema.safeParse({ ...base, request_by_caller: { cli: { body: 1 } } }).success).toBe(true);
    expect(RouteFixtureSchema.safeParse({ ...base, request_by_caller: { nobody: {} } }).success).toBe(false);
    expect(RouteFixtureSchema.safeParse({ ...base, request_by_caller: { cli: { extra: 1 } } }).success).toBe(false);
  });
});
