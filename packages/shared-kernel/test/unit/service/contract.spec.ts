import path from 'node:path';
import { COMMON_ADMIN_ROUTES } from '@fathom/contracts/admin/admin-routes';
import { ServiceName } from '@fathom/contracts/common/ids';
import type { RouteDef } from '@fathom/contracts/common/route';
import { InboxDeliverRoute } from '@fathom/contracts/events/inbox';
import type { RouteFixture } from '@fathom/testkit/contract';
import { checkRouteContract, checkRouteTable, TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { ok } from '../../../src/errors/errors.js';
import type { InboxConfig } from '../../../src/eventing/inbox.js';
import type { JobRunner } from '../../../src/jobs/jobs.js';
import type { Rig } from './support.js';
import { defOf, rigOf } from './support.js';

const HOME = '/tmp/fathom-test-home';
const EPOCH = fixedUlid(70);
const CORR = fixedUlid(71);
const ZERO = { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 };

/** 기본 snapshot·integrity job을 대신하는 가짜 러너(결과는 각 라우트 응답 계약을 만족한다). */
const jobs: JobRunner = {
  run: (name) =>
    Promise.resolve(
      ok(
        name === 'snapshot'
          ? {
              epoch_id: EPOCH,
              svc: 'content',
              files: [{ file: 'content.db', sha256: 'a'.repeat(64), bytes: 1 }],
              schema: { _infra: 3 },
              outbox_head_seq: 0,
              delivery: ZERO,
              inbox_watermark: ZERO,
              duration_ms: 1,
            }
          : {
              svc: 'content',
              level: 'quick',
              ok: true,
              files: [{ file: 'content.db', check: 'ok', foreign_key_violations: 0 }],
              checked_at: 1,
              duration_ms: 1,
            },
      ),
    ),
  cancel: () => undefined,
  isBusy: () => false,
  shutdown: () => Promise.resolve(),
};

const event = {
  event_id: fixedUlid(72),
  type: 'a.b.c',
  schema_version: 1,
  producer: 'content',
  producer_seq: 1,
  occurred_at: 1_790_000_000_000,
  correlation_id: CORR,
  causation_id: null,
  traceparent: null,
  payload: { n: 1 },
};
const fixtures: Record<string, RouteFixture> = {
  'common.health.live': { request: {}, caller: 'gateway', expect: { status: 200 } },
  'common.health.ready': { request: {}, caller: 'gateway', expect: { status: 200 } },
  'common.metrics.get': { request: {}, caller: 'ops-api', expect: { status: 200 } },
  'common.admin.quiesce': {
    request: { body: { epoch_id: EPOCH, ack_deadline_ms: 2000 } },
    caller: 'ops-api',
    expect: { status: 200 },
  },
  'common.admin.snapshot': {
    request: { body: { epoch_id: EPOCH, dir: path.join(HOME, 'backups', 'snap', EPOCH) } },
    caller: 'ops-api',
    expect: { status: 200 },
  },
  'common.admin.resume': {
    request: { body: { epoch_id: EPOCH, outcome: 'completed' } },
    caller: 'ops-api',
    expect: { status: 200 },
  },
  'common.admin.shutdown': { request: { body: { grace_ms: 3000 } }, caller: 'ops-api', expect: { status: 202 } },
  'common.admin.events': { request: { query: { correlation_id: CORR } }, caller: 'ops-api', expect: { status: 200 } },
  'common.admin.integrity': { request: { body: { level: 'quick' } }, caller: 'ops-api', expect: { status: 200 } },
  'common.inbox.deliver': {
    request: { body: { producer: 'content', events: [event] } },
    // IF §3.3-1: 호출자 = 이벤트 producer여야 2xx — C4의 허용 호출자 2xx 검사는 호출자마다 자기 producer 본문으로 보낸다(CO-15).
    request_by_caller: Object.fromEntries(
      ServiceName.options.map((svc) => [svc, { body: { producer: svc, events: [{ ...event, producer: svc }] } }]),
    ),
    caller: 'content',
    expect: { status: 200 },
  },
};

const inbox: InboxConfig = { mode: 'durable', manifest: { consumer: 'content', subscriptions: [] }, handlers: [] };
const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

async function check(route: RouteDef): Promise<{ id: string; detail: string }[]> {
  // 라우트마다 새 앱 — quiesce가 게이트를 닫아 둔 채로 다음 검사에 영향을 주지 않게 한다.
  const rig = await rigOf({ ...defOf('content'), inbox }, { jobs, home: HOME });
  rigs.push(rig);
  const fixture = fixtures[route.id];
  if (fixture === undefined) {
    throw new Error(`no fixture for ${route.id}`);
  }
  const injector = {
    inject: async (req: { method: string; url: string; headers: Record<string, string>; payload?: string }) => {
      const res = await rig.app.fastify.inject({
        method: req.method as 'GET',
        url: req.url,
        headers: req.headers,
        ...(req.payload === undefined ? {} : { payload: req.payload }),
      });
      return { statusCode: res.statusCode, headers: res.headers, body: res.body };
    },
  };
  const violations = await checkRouteContract(route, injector, fixture, {
    callerTokens: TEST_CALLER_TOKENS,
    svcCode: 'CT',
  });
  return violations.map((v) => ({ id: v.route_id, detail: `${v.rule}: ${v.detail}` }));
}

describe('testkit 라우트 적합성 하네스 (content형 fixture 앱)', () => {
  it('UT-SK-197 C1: 등록된 라우트 표가 COMMON_ADMIN_ROUTES + inbox와 양방향 일치 [IF-COM-001~010]', async () => {
    const rig = await rigOf({ ...defOf('content'), inbox }, { jobs });
    rigs.push(rig);
    expect(checkRouteTable([...COMMON_ADMIN_ROUTES, InboxDeliverRoute], rig.app.registeredRoutes())).toEqual([]);
  });

  it('UT-SK-197 C2~C9: COMMON_ADMIN_ROUTES 9종은 위반 0 [IF-COM-001~010]', async () => {
    for (const route of COMMON_ADMIN_ROUTES) {
      expect(await check(route), route.id).toEqual([]);
    }
  });

  it('UT-SK-197 C2~C9: InboxDeliverRoute — 호출자별 본문(request_by_caller)으로 C2~C9 위반 0 [IF-COM-004]', async () => {
    expect(await check(InboxDeliverRoute)).toEqual([]);
  });
});
