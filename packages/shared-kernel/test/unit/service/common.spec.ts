import { COMMON_ADMIN_ROUTES, Healthz, Readyz } from '@fathom/contracts/admin/admin-routes';
import { Problem } from '@fathom/contracts/common/problem';
import { InboxDeliverRoute } from '@fathom/contracts/events/inbox';
import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import { createFakeClock } from '@fathom/testkit/clock';
import { checkRouteTable } from '@fathom/testkit/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { ok } from '../../../src/errors/errors.js';
import type { InboxConfig } from '../../../src/eventing/inbox.js';
import { startRelay } from '../../../src/eventing/relay.js';
import { createMetrics } from '../../../src/metrics/metrics.js';
import { captureLogger, PAYLOADS } from '../eventing/support.js';
import { fixtureDef, NdjsonInRoute, NdjsonOutRoute } from './routes.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, OPS, rigOf } from './support.js';

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});
const keep = <T extends Rig>(r: T): T => {
  rigs.push(r);
  return r;
};

const durableInbox: InboxConfig = {
  mode: 'durable',
  manifest: { consumer: 'content', subscriptions: [] },
  handlers: [],
};
const notifyInbox: InboxConfig = {
  mode: 'notify',
  manifest: { consumer: 'gateway', subscriptions: [] },
  notify: (): void => undefined,
};

describe('healthz · readyz', () => {
  it('UT-SK-178 Healthz·Readyz 스키마 통과·uptime_ms 증가 [IF-COM-001][IF-COM-002]', async () => {
    // Arrange
    const rig = keep(await rigOf(defOf('content')));
    // Act
    const h1 = await rig.app.fastify.inject({ method: 'GET', url: '/healthz' });
    rig.clock.advance(1500);
    const h2 = await rig.app.fastify.inject({ method: 'GET', url: '/healthz' });
    const r = await rig.app.fastify.inject({ method: 'GET', url: '/readyz' });
    // Assert
    expect(Healthz.parse(JSON.parse(h1.body))).toMatchObject({
      ok: true,
      svc: 'content',
      version: '0.0.0',
      uptime_ms: 0,
    });
    expect(Healthz.parse(JSON.parse(h2.body)).uptime_ms).toBe(1500);
    expect(r.statusCode).toBe(200);
    expect(Readyz.parse(JSON.parse(r.body))).toEqual({
      ready: true,
      svc: 'content',
      checks: { db: true, schema: true, policy: true, peers: true, integrity: 'ok' },
      reasons: [],
    });
  });

  it('UT-SK-178 not-ready → 503 + Readyz 본문·reasons, 그 밖의 라우트는 503 DEP-901(health·metrics 제외) [IF-COM-002]', async () => {
    // Arrange
    const rig = keep(await rigOf(fixtureDef(defOf('content'))));
    const starting = keep(await rigOf(fixtureDef(defOf('content')), { ready: false }));
    // Act
    const r = await starting.app.fastify.inject({ method: 'GET', url: '/readyz' });
    const blocked = await starting.app.fastify.inject({ method: 'GET', url: '/internal/v1/items/x', headers: GATEWAY });
    const metrics = await starting.app.fastify.inject({ method: 'GET', url: '/internal/v1/metrics', headers: OPS });
    // Assert
    expect(r.statusCode).toBe(503);
    const body = Readyz.parse(JSON.parse(r.body));
    expect(body.ready).toBe(false);
    expect(body.reasons).toContain('starting');
    expect(body.checks).toMatchObject({ db: false, schema: false });
    expect(blocked.statusCode).toBe(503);
    expect(Problem.parse(JSON.parse(blocked.body)).code).toBe('CT-DEP-901');
    expect(metrics.statusCode).toBe(200);
    expect((await rig.app.fastify.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it('UT-SK-178 피어 URL 없음 → peers:false·reasons peer_missing, integrity pending은 ready를 막지 않는다 [IF-COM-002]', async () => {
    // Arrange
    const def = { ...defOf('content'), peers: ['learning'] as const };
    const missing = keep(await rigOf(def));
    const present = keep(await rigOf(def, { peers: { learning: {} as PeerClientPort } }));
    // Act
    const a = Readyz.parse(JSON.parse((await missing.app.fastify.inject({ method: 'GET', url: '/readyz' })).body));
    const b = await present.app.fastify.inject({ method: 'GET', url: '/readyz' });
    // Assert
    expect(a).toMatchObject({ ready: false, checks: { peers: false } });
    expect(a.reasons).toEqual(['peer_missing:learning']);
    expect(b.statusCode).toBe(200);
  });
});

describe('metrics', () => {
  it('UT-SK-179 text/plain 0.0.4·http_request_duration_ms·process_resident_memory_bytes·eventloop_delay_p99_ms·outbox_pending·ops-api 외 403 [IF-COM-003]', async () => {
    // Arrange: 생산자 fixture(relay 포함)
    const clock = createFakeClock();
    const metrics = createMetrics();
    const def = {
      ...defOf('content'),
      events: { payloads: PAYLOADS, routing: { learning: { mode: 'durable', types: ['a.b.c'] } } },
    } as const;
    const rig = keep(await rigOf(def, { metrics, clock }));
    const relay = startRelay({
      db: rig.db as NonNullable<Rig['db']>,
      svc: 'content',
      routing: def.events.routing,
      transport: { deliver: () => Promise.resolve(ok({ acked_through_seq: 0 })) },
      clock,
      log: captureLogger(clock).log,
      metrics,
    });
    const withRelay = keep(
      await rigOf(def, { metrics, clock, relay, dbs: { 'content.db': rig.db as NonNullable<Rig['db']> } }),
    );
    await withRelay.app.fastify.inject({ method: 'GET', url: '/healthz' });
    // Act
    const res = await withRelay.app.fastify.inject({ method: 'GET', url: '/internal/v1/metrics', headers: OPS });
    const denied = await withRelay.app.fastify.inject({ method: 'GET', url: '/internal/v1/metrics', headers: GATEWAY });
    await relay.stop();
    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(res.body).toContain('http_request_duration_ms_bucket{route="common.health.live",status="200",le="5"}');
    expect(res.body).toMatch(/process_resident_memory_bytes \d+/);
    expect(res.body).toContain('# TYPE eventloop_delay_p99_ms gauge');
    expect(res.body).toMatch(/outbox_pending\{dest="learning"\} 0/);
    expect(denied.statusCode).toBe(403);
  });
});

describe('라우트 표', () => {
  it('UT-SK-180 registeredRoutes()가 §4.6 표와 일치한다(gateway·content·ops-api) [IF-COM-001][IF-COM-002][IF-COM-003]', async () => {
    // Arrange
    const gateway = keep(await rigOf({ ...defOf('gateway'), inbox: notifyInbox }));
    const content = keep(await rigOf({ ...defOf('content'), inbox: durableInbox }));
    const ops = keep(
      await rigOf({
        ...defOf('ops-api'),
        inbox: { mode: 'durable', manifest: { consumer: 'ops-api', subscriptions: [] }, handlers: [] },
      }),
    );
    const key = (r: Rig): string[] =>
      r.app
        .registeredRoutes()
        .map((x) => `${x.method} ${x.url}`)
        .sort();
    const common = ['GET /healthz', 'GET /readyz', 'GET /internal/v1/metrics', 'POST /internal/v1/inbox'];
    const admin = [
      'POST /internal/v1/admin/quiesce',
      'POST /internal/v1/admin/snapshot',
      'POST /internal/v1/admin/resume',
      'GET /internal/v1/admin/events',
      'POST /internal/v1/admin/integrity',
    ];
    const shutdown = ['POST /internal/v1/admin/shutdown'];
    // Act / Assert
    expect(key(gateway)).toEqual([...common, ...shutdown].sort());
    expect(key(content)).toEqual([...common, ...admin, ...shutdown].sort());
    expect(key(ops)).toEqual([...common].sort());
    // 계약 표와의 C1 양방향 비교: 공통 라우트 9종 + inbox
    const routes = [...COMMON_ADMIN_ROUTES, InboxDeliverRoute];
    expect(checkRouteTable(routes, content.app.registeredRoutes())).toEqual([]);
    expect(
      checkRouteTable(routes, ops.app.registeredRoutes())
        .map((v) => v.detail)
        .sort(),
    ).toEqual([...admin, ...shutdown].map((k) => `not registered: ${k}`).sort());
  });
});

describe('stream()', () => {
  it('UT-SK-198 responseKind ndjson·bodyKind ndjson 경로 — 본문 zod 생략, 원 스트림 수신 [NFR-SEC-003]', async () => {
    // Arrange
    const rig = keep(await rigOf(fixtureDef(defOf('content'))));
    // Act
    const out = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/test/ndjson-out', headers: GATEWAY });
    const into = await rig.app.fastify.inject({
      method: 'POST',
      url: '/internal/v1/test/ndjson-in',
      headers: { ...GATEWAY, 'content-type': 'application/x-ndjson' },
      payload: '{"a":1}\n{"a":2}\n{"a":3}\n',
    });
    // Assert
    expect(out.statusCode).toBe(200);
    expect(out.headers['content-type']).toMatch(/^application\/x-ndjson/);
    expect(out.body).toBe('{"a":1}\n{"a":2}\n');
    expect(into.statusCode).toBe(200);
    expect(JSON.parse(into.body)).toEqual({ lines: 3 });
    // 잘못된 등록: stream 경로를 route()로, 일반 경로를 stream()으로
    await expect(
      rigOf({
        ...defOf('content'),
        register: (app) => app.route(NdjsonOutRoute, () => Promise.resolve({ status: 200, body: '' })),
      }),
    ).rejects.toThrow(/app\.stream\(\)/);
    await expect(
      rigOf({ ...defOf('content'), register: (app) => app.stream(InboxDeliverRoute, () => Promise.resolve()) }),
    ).rejects.toThrow(/app\.route\(\)/);
    expect(NdjsonInRoute.request.bodyKind).toBe('ndjson');
  });
});
