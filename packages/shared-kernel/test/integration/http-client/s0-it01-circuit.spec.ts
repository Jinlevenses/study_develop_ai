import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { createFakeClock } from '@fathom/testkit/clock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPeerClient } from '../../../src/http-client/http-client.js';

// T-01-01 §4.2-4 — 서킷 안정화: probe 중 예외가 half_open을 영구 점유하지 않고, 재시도 중 서킷이 열리면 직전 실제 실패를 돌려준다.

const sleeps = vi.hoisted(() => [] as number[]);
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number): Promise<void> => {
    sleeps.push(ms);
    return Promise.resolve();
  },
}));

const Thing = S({ id: z.string(), n: z.number() });
const base = { ifId: 'IF-CT-9001', paginated: false, freeze: 'D', slice: 'R0', fr: ['FR-SET-002'] } as const;
const getThing = defineRoute({
  ...base,
  id: 'content.things.get',
  method: 'GET',
  path: '/internal/v1/things/{id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: { params: S({ id: z.string() }) },
  response: { 200: Thing },
});
const touch = defineRoute({
  ...base,
  id: 'content.things.touch',
  ifId: 'IF-CT-9003',
  method: 'POST',
  path: '/internal/v1/things:touch',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: { body: S({ name: z.string() }) },
  response: { 200: Thing },
});

let server: http.Server;
let liveUrl = '';
let deadUrl = '';
const clock = createFakeClock();

beforeEach(async () => {
  sleeps.length = 0;
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 't1', n: 1 }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  liveUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dead = http.createServer();
  await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
  deadUrl = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => dead.close(() => resolve()));
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Target = { url: string; throwTransport: boolean };

function make(target: Target): ReturnType<typeof createPeerClient> {
  return createPeerClient({
    self: 'gateway',
    peer: 'content',
    baseUrl: () => target.url,
    token: 'a'.repeat(64),
    clock,
    rng: () => 0.5,
    httpRequest: ((...args: Parameters<typeof http.request>) => {
      if (target.throwTransport) {
        throw new Error('transport exploded');
      }
      return http.request(...args);
    }) as typeof http.request,
  });
}

async function tripOpen(c: ReturnType<typeof createPeerClient>): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await c.call(touch, { body: { name: 'x' } });
  }
  expect(c.circuitState()).toBe('open');
}

describe('PeerClient 서킷 안정화', () => {
  it('UT-SK-216 half_open 시험 호출 중 transport 예외가 나도 점유가 풀려 다음 호출이 probe를 다시 승인받는다 [NFR-AVL-002]', async () => {
    const target: Target = { url: deadUrl, throwTransport: false };
    const c = make(target);
    await tripOpen(c);
    clock.advance(5000);
    expect(c.circuitState()).toBe('half_open');
    // 시험 호출이 예외로 끝난다 — 결함은 던진다(Result가 아님)
    target.url = liveUrl;
    target.throwTransport = true;
    await expect(c.call(touch, { body: { name: 'x' } })).rejects.toThrow('transport exploded');
    expect(c.circuitState()).toBe('half_open'); // 아직 닫히지도 다시 열리지도 않았다
    // 점유가 남았다면 이 호출은 circuit_open이다. 풀렸으면 시험이 승인돼 서버에 닿는다.
    target.throwTransport = false;
    const next = await c.call(touch, { body: { name: 'x' } });
    expect(next).toMatchObject({ ok: true });
    expect(c.circuitState()).toBe('closed');
  });

  it('UT-SK-217 재시도 중 서킷이 열리면 circuit_open이 아니라 직전 실제 실패(connect_failed)를 돌려준다 [NFR-AVL-002]', async () => {
    const target: Target = { url: deadUrl, throwTransport: false };
    const c = make(target);
    // 연속 연결 실패 2회를 미리 쌓는다(비멱등 POST = 호출당 1회 시도)
    await c.call(touch, { body: { name: 'x' } });
    await c.call(touch, { body: { name: 'x' } });
    expect(c.circuitState()).toBe('closed');
    // 멱등 GET: 시도 0이 3번째 실패 → open → 시도 1은 admit() = null
    const r = await c.call(getThing, { params: { id: 'a' } });
    expect(r).toEqual({ ok: false, error: { kind: 'connect_failed', dependency: 'content' } });
    expect(c.circuitState()).toBe('open');
    expect(sleeps).toHaveLength(1); // 첫 시도 실패 뒤 백오프 1회
  });

  it('UT-SK-218 첫 시도에서 서킷이 열려 있으면 circuit_open이다(요청 0) [NFR-AVL-002]', async () => {
    const target: Target = { url: deadUrl, throwTransport: false };
    const c = make(target);
    await tripOpen(c);
    target.url = liveUrl;
    expect(await c.call(getThing, { params: { id: 'a' } })).toEqual({
      ok: false,
      error: { kind: 'circuit_open', dependency: 'content' },
    });
    expect(await c.call(touch, { body: { name: 'x' } })).toMatchObject({ ok: false, error: { kind: 'circuit_open' } });
  });

  it('UT-SK-219 기존 서킷 동작 불변: 연결 실패 3회 → open → 5s 후 half_open 시험 성공 → closed [NFR-AVL-002]', async () => {
    const target: Target = { url: deadUrl, throwTransport: false };
    const c = make(target);
    expect(c.circuitState()).toBe('closed');
    await tripOpen(c);
    clock.advance(4999);
    expect(c.circuitState()).toBe('open');
    clock.advance(1);
    expect(c.circuitState()).toBe('half_open');
    // 시험이 연결 실패하면 다시 open
    expect(await c.call(touch, { body: { name: 'x' } })).toMatchObject({
      ok: false,
      error: { kind: 'connect_failed' },
    });
    expect(c.circuitState()).toBe('open');
    clock.advance(5000);
    target.url = liveUrl;
    expect((await c.call(touch, { body: { name: 'x' } })).ok).toBe(true);
    expect(c.circuitState()).toBe('closed');
  });
});
