import http from 'node:http';
import { defineRoute } from '@fathom/contracts/common/route';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createShutdown } from '../../../src/service/shutdown.js';
import { captureLogger } from '../eventing/support.js';
import type { Probes } from './routes.js';
import { fixtureDef } from './routes.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, rigOf } from './support.js';

// T-01-01 §4.2-3 — hijack한 스트림 요청은 in-flight에서 뺀다: 열린 SSE가 있어도 shutdown의 waitIdle이 grace 전체를 기다리지 않는다.

const SseRoute = defineRoute({
  ifId: 'IF-CT-001',
  paginated: false,
  freeze: 'O',
  slice: 'R0',
  fr: [],
  id: 'content.test.sse',
  method: 'GET',
  path: '/internal/v1/test/sse',
  allowedCallers: ['gateway'],
  idempotent: false,
  request: {},
  responseKind: 'sse',
  response: { 200: z.string() },
});

const rigs: Rig[] = [];
const clients: http.ClientRequest[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) {
    c.destroy();
  }
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

type Harness = { rig: Rig; probes: Probes; port: number; open: Set<http.ServerResponse> };

async function harness(): Promise<Harness> {
  const probes: Probes = { puts: 0, slowRelease: null, slowStarted: null };
  const open = new Set<http.ServerResponse>();
  const fixture = fixtureDef(defOf('content'), probes);
  const rig = await rigOf({
    ...fixture,
    register: async (app, deps) => {
      await fixture.register(app, deps);
      app.stream(SseRoute, (_ctx, reply) => {
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        reply.raw.write(': open\n\n');
        open.add(reply.raw);
        reply.raw.on('close', () => open.delete(reply.raw));
        return Promise.resolve();
      });
    },
  });
  rigs.push(rig);
  await rig.app.fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = rig.app.fastify.server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('no address');
  }
  return { rig, probes, port: addr.port, open };
}

/** SSE를 열고 첫 청크가 올 때까지 기다린다. */
function openSse(port: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/internal/v1/test/sse', headers: GATEWAY, agent: false },
      (res) => {
        res.once('data', () => resolve(res));
      },
    );
    req.on('error', reject);
    clients.push(req);
    req.end();
  });
}

function shutdownOf(h: Harness): ReturnType<typeof createShutdown> {
  const { internals } = h.rig;
  return createShutdown({
    state: internals.state,
    relay: null,
    stopTimers: () => undefined,
    // hub.closeAll 같은 onShutdown 훅 — 열린 스트림을 닫는다
    hooks: [
      () => {
        for (const res of h.open) {
          res.end();
        }
      },
    ],
    jobs: internals.jobs,
    writeDbs: [],
    closeApp: () => h.rig.app.close(),
    exit: () => undefined,
    log: captureLogger().log,
  });
}

describe('hijack 스트림과 종료', () => {
  it('UT-SK-213 SSE가 열린 채 shutdown(5000)은 1000ms 안에 끝난다(훅이 스트림을 닫는다) [NFR-AVL-004][ADR-012]', async () => {
    const h = await harness();
    await openSse(h.port);
    expect(h.open.size).toBe(1);
    const t0 = performance.now();
    await shutdownOf(h)(5000);
    const took = performance.now() - t0;
    expect(took).toBeLessThan(1000);
    expect(h.open.size).toBe(0);
  });

  it('UT-SK-214 일반 in-flight 요청은 여전히 기다린다: 느린 요청이 끝나야 shutdown이 진행한다 [NFR-AVL-004][ADR-012]', async () => {
    const h = await harness();
    await openSse(h.port);
    // 느린 일반 요청 1건 시작(핸들러가 풀릴 때까지 진행 중)
    const slow = h.rig.app.fastify.inject({
      method: 'POST',
      url: '/internal/v1/test/put',
      headers: {
        ...GATEWAY,
        'content-type': 'application/json; charset=utf-8',
        'idempotency-key': '01J0000000000000000000ABCD',
      },
      payload: JSON.stringify({ v: 1, mode: 'slow' }),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    expect(h.rig.internals.state.inFlight).toBe(1); // SSE는 세지 않고 느린 요청만
    let done = false;
    const stopping = shutdownOf(h)(5000).then(() => {
      done = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(done).toBe(false);
    h.probes.slowRelease?.();
    await slow;
    await stopping;
    expect(done).toBe(true);
  });

  it('UT-SK-215 hijack 해제 후 inFlight는 0이고 스트림이 닫혀도 음수·이중 차감이 없다 [NFR-AVL-004][ADR-012]', async () => {
    const h = await harness();
    const state = h.rig.internals.state;
    expect(state.inFlight).toBe(0);
    const res = await openSse(h.port);
    expect(state.inFlight).toBe(0); // 열린 스트림은 in-flight가 아니다
    const closed = new Promise<void>((resolve) => res.once('close', resolve));
    for (const raw of h.open) {
      raw.end();
    }
    await closed;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(state.inFlight).toBe(0);
    // 일반 요청 뒤에도 정상 집계
    const ok = await h.rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/test/deadline', headers: GATEWAY });
    expect(ok.statusCode).toBe(200);
    expect(state.inFlight).toBe(0);
  });
});
