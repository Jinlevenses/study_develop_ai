import { EventEmitter } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { createFakeClock } from '@fathom/testkit/clock';
import { createFakePeer } from '@fathom/testkit/fakes/peers/peers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { PeerClientPort } from '../../../src/http-client/http-client.js';
import { createPeerClient } from '../../../src/http-client/http-client.js';
import { ulid } from '../../../src/ids/ids.js';
import { createMetrics } from '../../../src/metrics/metrics.js';

const sleeps = vi.hoisted(() => [] as number[]);
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number): Promise<void> => {
    sleeps.push(ms);
    return Promise.resolve();
  },
}));

// ───────── 테스트용 라우트 ─────────

const Thing = S({ id: z.string(), n: z.number() });
const getThing = defineRoute({
  id: 'content.things.get',
  ifId: 'IF-CT-9001',
  method: 'GET',
  path: '/internal/v1/things/{id}',
  allowedCallers: ['gateway', 'learning'],
  idempotent: false,
  paginated: false,
  request: { params: S({ id: z.string() }), query: S({ verbose: z.boolean().optional(), a: z.number().optional() }) },
  response: { 200: Thing },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-002'],
});
const createThing = defineRoute({
  id: 'content.things.create',
  ifId: 'IF-CT-9002',
  method: 'POST',
  path: '/internal/v1/things',
  allowedCallers: ['gateway', 'learning'],
  idempotent: true,
  paginated: false,
  request: { body: S({ name: z.string() }) },
  response: { 200: Thing, 201: Thing },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-002'],
});
const plainPost = defineRoute({
  id: 'content.things.touch',
  ifId: 'IF-CT-9003',
  method: 'POST',
  path: '/internal/v1/things:touch',
  allowedCallers: ['gateway', 'learning'],
  idempotent: false,
  paginated: false,
  request: { body: S({ name: z.string() }) },
  response: { 200: Thing },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-002'],
});
const retireThing = defineRoute({
  id: 'content.things.retire',
  ifId: 'IF-CT-9004',
  method: 'POST',
  path: '/internal/v1/things/{id}:retire',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ id: z.string() }) },
  response: { 204: z.null() },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-002'],
});

// ───────── 실서버 ─────────

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };
type Handler = (req: Seen, res: http.ServerResponse, n: number) => void;

let server: http.Server;
let baseUrl = '';
let seen: Seen[] = [];
let handler: Handler = (_req, res) => {
  res.writeHead(500).end();
};
const clock = createFakeClock();

function thingJson(res: http.ServerResponse, status = 200, extra: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...extra });
  res.end(JSON.stringify({ id: 't1', n: 1 }));
}

function problem(res: http.ServerResponse, status: number, code: string): void {
  const [svc, cat, num] = code.toLowerCase().split('-');
  res.writeHead(status, { 'content-type': 'application/problem+json' });
  res.end(
    JSON.stringify({
      type: `urn:fathom:problem:${svc}-${cat}-${num}`,
      title: '테스트 오류',
      status,
      code,
      error_id: ulid(),
      request_id: ulid(),
      retryable: status === 503,
    }),
  );
}

beforeEach(async () => {
  seen = [];
  sleeps.length = 0;
  handler = (_req, res) => thingJson(res);
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(entry);
      handler(entry, res, seen.length);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  vi.useRealTimers();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(over: Partial<Parameters<typeof createPeerClient>[0]> = {}): ReturnType<typeof createPeerClient> {
  return createPeerClient({
    self: 'gateway',
    peer: 'content',
    baseUrl: () => baseUrl,
    token: 'a'.repeat(64),
    clock,
    rng: () => 0.5,
    ...over,
  });
}

describe('PeerClient (127.0.0.1 실서버)', () => {
  it('UT-SK-105 헤더 6종을 보내고 x-fathom-deadline-ms는 deadlineAt − now − 10이다 [NFR-AVL-002][FR-SET-002]', async () => {
    // Arrange
    const key = ulid();
    const requestId = ulid();
    const trace = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`;
    // Act
    const r = await client().call(
      createThing,
      { body: { name: 'x' } },
      { idempotencyKey: key, requestId, traceparent: trace, deadlineAt: clock.now() + 500 },
    );
    // Assert
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const h = seen[0]?.headers ?? {};
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toBe('/internal/v1/things');
    expect(seen[0]?.body).toBe('{"name":"x"}');
    expect(h.authorization).toBe(`Bearer ${'a'.repeat(64)}`);
    expect(h.accept).toBe('application/json');
    expect(h['content-type']).toBe('application/json; charset=utf-8');
    expect(h['idempotency-key']).toBe(key);
    expect(h['x-request-id']).toBe(requestId);
    expect(h['x-fathom-deadline-ms']).toBe('490');
    const tp = /^00-(\w{32})-(\w{16})-(\w{2})$/.exec(String(h.traceparent));
    expect(tp?.[1]).toBe('1'.repeat(32));
    expect(tp?.[2]).not.toBe('2'.repeat(16));
    expect(tp?.[3]).toBe('01');
    // 기본 데드라인 = route.deadlineMs ?? 2000, 요청 id는 자동 ULID, traceparent 입력이 없으면 헤더 없음.
    seen = [];
    await client().call(getThing, { params: { id: 'a' } });
    expect(seen[0]?.headers['x-fathom-deadline-ms']).toBe('1990');
    expect(seen[0]?.headers['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(seen[0]?.headers.traceparent).toBeUndefined();
    expect(seen[0]?.headers['idempotency-key']).toBeUndefined();
    expect(seen[0]?.headers['content-type']).toBeUndefined();
  });

  it('UT-SK-106 deadline_exhausted면 요청을 보내지 않는다 [NFR-AVL-002]', async () => {
    const c = client();
    for (const deadlineAt of [clock.now() + 10, clock.now() + 5, clock.now() - 1]) {
      const r = await c.call(getThing, { params: { id: 'a' } }, { deadlineAt });
      expect(r, String(deadlineAt)).toEqual({
        ok: false,
        error: { kind: 'deadline_exhausted', dependency: 'content' },
      });
    }
    expect(seen).toHaveLength(0);
    const ok = await c.call(getThing, { params: { id: 'a' } }, { deadlineAt: clock.now() + 1010 });
    expect(ok.ok).toBe(true);
    expect(seen[0]?.headers['x-fathom-deadline-ms']).toBe('1000');
  });

  it('UT-SK-107 응답 스키마 위반·미선언 상태·깨진 JSON은 contract_violation이다 [NFR-AVL-002][FR-SET-002]', async () => {
    const c = client();
    handler = (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 1 }));
    };
    const bad = await c.call(getThing, { params: { id: 'a' } });
    expect(bad).toMatchObject({ ok: false, error: { kind: 'contract_violation', dependency: 'content', status: 200 } });
    handler = (_q, res) => thingJson(res, 202);
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation', status: 202 },
    });
    handler = (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{not json');
    };
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation' },
    });
    handler = (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"a","n":1,"__proto__":{"x":1}}');
    };
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation' },
    });
    // 추가 키(strict) 위반
    handler = (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"a","n":1,"extra":true}');
    };
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation' },
    });
    // 비 2xx인데 problem+json이 아님
    handler = (_q, res) => {
      res.writeHead(500, { 'content-type': 'text/html' }).end('<h1>oops</h1>');
    };
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation', status: 500 },
    });
    handler = (_q, res) => {
      res.writeHead(302, { location: '/x' }).end();
    };
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation', status: 302 },
    });
  });

  it('UT-SK-108 problem+json은 kind problem으로, 깨진 problem은 contract_violation으로 돌려준다 [NFR-AVL-002][FR-SET-002]', async () => {
    const c = client();
    handler = (_q, res) => problem(res, 404, 'CT-NOTFOUND-001');
    const r = await c.call(getThing, { params: { id: 'a' } });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'problem') {
      expect(r.error.status).toBe(404);
      expect(r.error.dependency).toBe('content');
      expect(r.error.problem.code).toBe('CT-NOTFOUND-001');
    } else {
      expect.unreachable('problem expected');
    }
    expect(seen).toHaveLength(1); // 404는 재시도하지 않는다.
    handler = (_q, res) => {
      res.writeHead(400, { 'content-type': 'application/problem+json' }).end(JSON.stringify({ title: 'no code' }));
    };
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation', status: 400 },
    });
    handler = (_q, res) => {
      res.writeHead(400, { 'content-type': 'application/problem+json' }).end('nope');
    };
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation' },
    });
  });

  it('UT-SK-109 idempotent-replayed 헤더와 204(스키마 선언 필요)를 처리한다 [NFR-AVL-002][FR-SET-002]', async () => {
    const c = client();
    handler = (_q, res) => thingJson(res, 200, { 'idempotent-replayed': 'true' });
    const replay = await c.call(createThing, { body: { name: 'x' } }, { idempotencyKey: ulid() });
    expect(replay).toEqual({ ok: true, value: { status: 200, body: { id: 't1', n: 1 }, replayed: true } });
    handler = (_q, res) => thingJson(res, 201);
    const created = await c.call(createThing, { body: { name: 'x' } }, { idempotencyKey: ulid() });
    expect(created).toEqual({ ok: true, value: { status: 201, body: { id: 't1', n: 1 }, replayed: false } });
    handler = (_q, res) => {
      res.writeHead(204).end();
    };
    const none = await c.call(retireThing, { params: { id: 'a' } }, { idempotencyKey: ulid() });
    expect(none).toEqual({ ok: true, value: { status: 204, body: null, replayed: false } });
    // 204가 선언되지 않은 라우트에서 204는 계약 위반이다.
    expect(await c.call(getThing, { params: { id: 'a' } })).toMatchObject({
      ok: false,
      error: { kind: 'contract_violation', status: 204 },
    });
  });

  it('UT-SK-110 503은 같은 키로 2회 재시도 후 실패하고 비멱등 POST는 재시도 0이다 [NFR-AVL-002][FR-SET-002]', async () => {
    handler = (_q, res) => problem(res, 503, 'CT-DEP-001');
    const c = client();
    const key = ulid();
    const requestId = ulid();
    const r = await c.call(createThing, { body: { name: 'x' } }, { idempotencyKey: key, requestId });
    expect(r).toMatchObject({ ok: false, error: { kind: 'problem', status: 503 } });
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((s) => s.headers['idempotency-key']))).toEqual(new Set([key]));
    expect(new Set(seen.map((s) => s.headers['x-request-id']))).toEqual(new Set([requestId]));
    expect(sleeps).toEqual([100, 300]); // rng 0.5 → 0.8 + 0.2 = 1.0배

    // 비멱등 POST: 1회만
    seen = [];
    sleeps.length = 0;
    const once = await c.call(plainPost, { body: { name: 'x' } });
    expect(once).toMatchObject({ ok: false, error: { kind: 'problem', status: 503 } });
    expect(seen).toHaveLength(1);
    expect(sleeps).toEqual([]);
    // GET은 멱등이므로 재시도한다. 지터 범위: 100 × (0.8 + 0.4 × rng)
    seen = [];
    await client({ rng: () => 0 }).call(getThing, { params: { id: 'a' } });
    expect(seen).toHaveLength(3);
    expect(sleeps).toEqual([80, 240]);
    // 중간에 성공하면 멈춘다.
    seen = [];
    handler = (_q, res, n) => (n < 2 ? problem(res, 503, 'CT-DEP-001') : thingJson(res));
    expect((await c.call(getThing, { params: { id: 'a' } })).ok).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it('UT-SK-111 409 CONFLICT-002는 재시도하고 그 밖 409는 재시도하지 않는다 [NFR-AVL-002]', async () => {
    const c = client();
    handler = (_q, res, n) => (n === 1 ? problem(res, 409, 'LR-CONFLICT-002') : thingJson(res));
    const r = await c.call(createThing, { body: { name: 'x' } }, { idempotencyKey: ulid() });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(2);
    seen = [];
    handler = (_q, res) => problem(res, 409, 'LR-CONFLICT-011');
    const other = await c.call(createThing, { body: { name: 'x' } }, { idempotencyKey: ulid() });
    expect(other).toMatchObject({ ok: false, error: { kind: 'problem', status: 409 } });
    expect(seen).toHaveLength(1);
    // 데드라인이 부족하면 재시도를 건너뛰고 마지막 실패를 돌려준다.
    seen = [];
    sleeps.length = 0;
    handler = (_q, res) => problem(res, 503, 'CT-DEP-001');
    const tight = await c.call(getThing, { params: { id: 'a' } }, { deadlineAt: clock.now() + 60 });
    expect(tight).toMatchObject({ ok: false, error: { kind: 'problem', status: 503 } });
    expect(seen).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('UT-SK-112 연결 300ms 초과는 connect_timeout이고 응답 대기 초과는 timeout이다 [NFR-AVL-002]', async () => {
    // 연결이 끝나지 않는 가짜 요청(주입 httpRequest) + 가짜 타이머
    vi.useFakeTimers();
    const fakeRequest = ((_options: unknown, _cb: unknown) => {
      const req = new EventEmitter() as EventEmitter & { end(): void; destroy(e?: Error): void };
      const socket = Object.assign(new EventEmitter(), { connecting: true });
      req.end = (): void => {
        queueMicrotask(() => req.emit('socket', socket));
      };
      req.destroy = (e?: Error): void => {
        queueMicrotask(() => req.emit('error', e ?? new Error('destroyed')));
      };
      return req;
    }) as unknown as typeof http.request;
    const c = client({ httpRequest: fakeRequest });
    const pending = c.call(plainPost, { body: { name: 'x' } });
    await vi.advanceTimersByTimeAsync(299);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, error: { kind: 'connect_timeout', dependency: 'content' } });
    vi.useRealTimers();

    // 연결은 되지만 응답이 없는 서버 → timeout (deadline 200ms)
    handler = () => undefined;
    const slow = await client().call(getThing, { params: { id: 'a' } }, { deadlineAt: clock.now() + 210 });
    expect(slow).toEqual({ ok: false, error: { kind: 'timeout', dependency: 'content' } });
    expect(seen).toHaveLength(1); // timeout은 재시도하지 않는다.
  });

  it('UT-SK-113 연속 연결 실패 3회 → open, 5s 후 half_open 시험 1건만 통과, 성공하면 closed다 [NFR-AVL-002]', async () => {
    // Arrange: 닫힌 포트(ECONNREFUSED)와 정상 서버를 오간다.
    const deadPort = await new Promise<number>((resolve) => {
      const s = http.createServer();
      s.listen(0, '127.0.0.1', () => {
        const port = (s.address() as AddressInfo).port;
        s.close(() => resolve(port));
      });
    });
    let target = `http://127.0.0.1:${deadPort}`;
    const metrics = createMetrics();
    const c = client({ baseUrl: () => target, metrics });
    expect(c.circuitState()).toBe('closed');
    // Act: 3회 연속 연결 실패(비멱등 POST라 호출당 1회 시도)
    for (let i = 0; i < 3; i += 1) {
      expect(await c.call(plainPost, { body: { name: 'x' } })).toEqual({
        ok: false,
        error: { kind: 'connect_failed', dependency: 'content' },
      });
    }
    expect(c.circuitState()).toBe('open');
    target = baseUrl;
    // open 중: 요청 0
    expect(await c.call(plainPost, { body: { name: 'x' } })).toEqual({
      ok: false,
      error: { kind: 'circuit_open', dependency: 'content' },
    });
    expect(seen).toHaveLength(0);
    clock.advance(4999);
    expect(c.circuitState()).toBe('open');
    clock.advance(1);
    expect(c.circuitState()).toBe('half_open');

    // half_open: 시험 호출 1건만 통과 — 시험이 진행 중일 때 다른 호출은 circuit_open
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handler = (_q, res) => {
      void gate.then(() => thingJson(res));
    };
    const probe = c.call(plainPost, { body: { name: 'x' } });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(await c.call(plainPost, { body: { name: 'x' } })).toMatchObject({
      ok: false,
      error: { kind: 'circuit_open' },
    });
    expect(seen).toHaveLength(1);
    release();
    expect((await probe).ok).toBe(true);
    expect(c.circuitState()).toBe('closed');
    expect(metrics.render()).toContain('peer_circuit_open_total{peer="content"} 1');

    // 연결 외 실패(problem 500)는 카운트하지 않는다.
    handler = (_q, res) => problem(res, 500, 'CT-INTERNAL-001');
    for (let i = 0; i < 4; i += 1) {
      await c.call(plainPost, { body: { name: 'x' } });
    }
    expect(c.circuitState()).toBe('closed');
    // 성공은 연속 카운트를 0으로 되돌린다: 실패 2 → 성공 → 실패 2 ⇒ 여전히 closed
    handler = (_q, res) => thingJson(res);
    target = `http://127.0.0.1:${deadPort}`;
    await c.call(plainPost, { body: { name: 'x' } });
    await c.call(plainPost, { body: { name: 'x' } });
    target = baseUrl;
    expect((await c.call(plainPost, { body: { name: 'x' } })).ok).toBe(true);
    target = `http://127.0.0.1:${deadPort}`;
    await c.call(plainPost, { body: { name: 'x' } });
    await c.call(plainPost, { body: { name: 'x' } });
    expect(c.circuitState()).toBe('closed');
    // half_open 시험이 연결 실패하면 다시 open이다.
    await c.call(plainPost, { body: { name: 'x' } });
    expect(c.circuitState()).toBe('open');
    clock.advance(5000);
    expect(c.circuitState()).toBe('half_open');
    expect(await c.call(plainPost, { body: { name: 'x' } })).toMatchObject({
      ok: false,
      error: { kind: 'connect_failed' },
    });
    expect(c.circuitState()).toBe('open');
    // baseUrl()이 null이면 connect_failed
    expect(await client({ baseUrl: () => null }).call(plainPost, { body: { name: 'x' } })).toEqual({
      ok: false,
      error: { kind: 'connect_failed', dependency: 'content' },
    });
  });

  it('UT-SK-114 경로 {name} 치환·콜론 동사·쿼리 키 정렬과 boolean [FR-SET-002]', async () => {
    const c = client();
    await c.call(getThing, { params: { id: 'a/b c?#' }, query: { verbose: true, a: 2 } });
    expect(seen[0]?.url).toBe('/internal/v1/things/a%2Fb%20c%3F%23?a=2&verbose=true');
    seen = [];
    await c.call(getThing, { params: { id: 'x' }, query: { verbose: false } });
    expect(seen[0]?.url).toBe('/internal/v1/things/x?verbose=false');
    seen = [];
    handler = (_q, res) => {
      res.writeHead(204).end();
    };
    await c.call(retireThing, { params: { id: 'x y' } }, { idempotencyKey: ulid() });
    expect(seen[0]?.url).toBe('/internal/v1/things/x%20y:retire');
    seen = [];
    await c.call(plainPost, { body: { name: 'n' } });
    expect(seen[0]?.url).toBe('/internal/v1/things:touch');
    // baseUrl에 경로 접두가 있어도 이어 붙는다.
    seen = [];
    await client({ baseUrl: () => `${baseUrl}/` }).call(getThing, { params: { id: 'p' } });
    expect(seen[0]?.url).toBe('/internal/v1/things/p');
  });

  it('UT-SK-115 사전 검사 위반(path·allowedCallers·멱등 키·입력 스키마)은 던진다 [FR-SET-002]', async () => {
    const c = client();
    const publicRoute = defineRoute({ ...getThing, id: 'content.things.public', path: '/api/v1/things/{id}' });
    await expect(c.call(publicRoute, { params: { id: 'a' } })).rejects.toThrow(/\/internal\/v1\//);
    await expect(client({ self: 'ai-gateway' }).call(getThing, { params: { id: 'a' } })).rejects.toThrow(
      /does not allow caller/,
    );
    await expect(c.call(createThing, { body: { name: 'x' } })).rejects.toThrow(/idempotencyKey/);
    await expect(c.call(createThing, { body: { name: 'x' } }, { idempotencyKey: 'not-a-ulid' })).rejects.toThrow(
      /ULID/,
    );
    await expect(c.call(getThing, { params: {} as { id: string } })).rejects.toThrow(/input.params invalid/);
    await expect(c.call(getThing, { params: { id: 'a' }, query: { bogus: 1 } })).rejects.toThrow(/input.query invalid/);
    await expect(c.call(createThing, { body: { nope: 1 } }, { idempotencyKey: ulid() })).rejects.toThrow(
      /input.body invalid/,
    );
    await expect(c.call(getThing, { params: { id: 'a' }, body: { x: 1 } })).rejects.toThrow(/no request.body schema/);
    expect(seen).toHaveLength(0);
  });

  it('UT-SK-116 PeerClientPort 타입이 testkit fake와 호환되고 메트릭을 기록한다 [NFR-AVL-002][FR-SET-002]', async () => {
    // 컴파일 검사: 양방향 대입
    const fake: PeerClientPort = createFakePeer({ peer: 'content', clock, handlers: {} });
    const real: PeerClientPort = client();
    expect(typeof fake.call).toBe('function');
    expect(typeof real.call).toBe('function');
    const metrics = createMetrics();
    await client({ metrics }).call(getThing, { params: { id: 'a' } });
    const text = metrics.render();
    expect(text).toContain('# TYPE peer_call_duration_ms histogram');
    expect(text).toContain('peer_call_duration_ms_count{peer="content",route="content.things.get"} 1');
    // keep-alive: 같은 클라이언트의 연속 호출이 같은 서버에서 잘 처리된다.
    const c = client();
    for (let i = 0; i < 5; i += 1) {
      expect((await c.call(getThing, { params: { id: String(i) } })).ok).toBe(true);
    }
  });
});
