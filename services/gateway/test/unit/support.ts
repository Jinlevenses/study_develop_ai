import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import type { InboxDelivery } from '@fathom/contracts/events/inbox';
import type { HealthBoard } from '@fathom/contracts/http/ops/v1/health';
import type { Operation } from '@fathom/contracts/http/ops/v1/operations';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { ok } from '@fathom/shared-kernel/errors/errors';
import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import { createLogger } from '@fathom/shared-kernel/log/log';
import type { AppInternals } from '@fathom/shared-kernel/service/app';
import type { ServiceAppHandle } from '@fathom/shared-kernel/service/service';
import { assembleApp } from '@fathom/shared-kernel/service/service';
import type { FakeClock } from '@fathom/testkit/clock';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import type { FakeHandler, FakePeer } from '@fathom/testkit/fakes/peers/peers';
import { createFakePeer } from '@fathom/testkit/fakes/peers/peers';
import { fixedUlid } from '@fathom/testkit/ids';
import type { TempHome } from '@fathom/testkit/temp-home';
import { createTempHome } from '@fathom/testkit/temp-home';
import type { GatewayDefinitionOptions } from '../../src/config.js';
import { createGatewayDefinition } from '../../src/config.js';

// gateway 단위 테스트 공통 헬퍼 — `assembleApp` + `fastify.inject`(Brief §5 위치 규칙). 각 spec이 이 파일만 공유한다.

export const PORT = 4747;
export const HOST = `127.0.0.1:${PORT}`;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const CLI_TOKEN = 'c'.repeat(43);
export const BOOT_ID = fixedUlid(77);
export const APP_VERSION = '0.1.0';
export const OPS_AUTH = { authorization: `Bearer ${TEST_CALLER_TOKENS['ops-api']}` };
export const CONTENT_AUTH = { authorization: `Bearer ${TEST_CALLER_TOKENS.content}` };
export const AI_AUTH = { authorization: `Bearer ${TEST_CALLER_TOKENS['ai-gateway']}` };

export type RigOptions = {
  readonly profile?: RuntimeProfile;
  readonly webRoot?: string | null;
  /** 정적 루트를 정하지 않고(webRoot 미지정) profile 규칙을 그대로 쓴다 — dev 프록시 테스트용. */
  readonly proxy?: boolean;
  readonly viteOrigin?: string;
  readonly handlers?: Record<string, FakeHandler>;
  readonly peers?: Partial<Record<'ops-api', PeerClientPort>>;
  readonly home?: TempHome;
  readonly safeMode?: boolean;
  readonly randomBytes?: (n: number) => Uint8Array;
  readonly cliToken?: string | null;
  readonly listenPort?: () => number | null;
  readonly gate?: Pick<GatewayDefinitionOptions, 'profileOverride'>;
};

export type Rig = {
  readonly app: ServiceAppHandle;
  readonly internals: AppInternals;
  readonly clock: FakeClock;
  readonly home: TempHome;
  readonly logs: string[];
  readonly ops: FakePeer;
  inject(method: string, url: string, o?: Injection): Promise<Reply>;
  /** CLI 토큰으로 부트스트랩 토큰을 받아 교환까지 한 브라우저 세션. */
  login(): Promise<Session>;
  close(): Promise<void>;
};
export type Injection = { headers?: Record<string, string>; body?: unknown; withHost?: boolean };
export type Reply = { status: number; body: string; json: () => unknown; headers: Record<string, unknown> };
export type Session = {
  cookie: string;
  sid: string;
  csrf: string;
  headers(extra?: Record<string, string>): Record<string, string>;
  mutate(extra?: Record<string, string>): Record<string, string>;
};

const perService = { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 };

export function healthBoard(): HealthBoard {
  return {
    generated_at: 1,
    overall: 'ok',
    app_version: APP_VERSION,
    services: [],
    ai: { mode: 'OFFLINE', providers: [] },
    backup: { last_ok_at: null, rpo_hours: null, secondary_configured: false, last_outcome: null },
    outbox: [],
    inbox: { dead_total: 0, halted: [] },
    runner: { enabled: true, queue_length: 0, platform_reason: null },
    eventloop_p99_ms: perService,
    rss_mb: perService,
    disk: { free_mb: 1000, warn: false },
    integrity: { ledger_alarm: false, projection_match: null, last_full_check_at: null },
    banners: [],
  };
}

export function operation(opId: string): Operation {
  return {
    op_id: opId,
    kind: 'shutdown',
    state: 'queued',
    progress: { step: 'queued', pct: null },
    correlation_id: fixedUlid(900),
    started_at: 1,
    finished_at: null,
    result: null,
    problem: null,
  };
}

export const okHandlers = (): Record<string, FakeHandler> => ({
  'ops.health.board': () => ok({ status: 200, body: healthBoard(), replayed: false }),
  'ops.system.shutdown': (input): Result<{ status: number; body: unknown; replayed: boolean }, never> => {
    const body = input.body as { op_id: string };
    return ok({ status: 202, body: operation(body.op_id), replayed: false });
  },
});

let seq = 5000;
/** 테스트 안에서 유일한 ULID(Idempotency-Key). */
export const nextKey = (): string => {
  seq += 1;
  return fixedUlid(seq);
};

export async function makeRig(o: RigOptions = {}): Promise<Rig> {
  const clock = createFakeClock();
  const home = o.home ?? (await createTempHome('fathom-gw-ut-'));
  const webRoot = o.webRoot === undefined ? null : o.webRoot;
  const webRootOpt = o.proxy === true ? {} : { webRoot };
  if (o.cliToken !== null) {
    mkdirSync(path.join(home.path, 'run'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(home.path, 'run', 'cli.token'), `${o.cliToken ?? CLI_TOKEN}\n`);
  }
  const logs: string[] = [];
  const log = createLogger('gateway', {
    level: 'info',
    bootId: null,
    clock,
    destination: { write: (c: string) => void logs.push(c) },
  });
  const ops = createFakePeer({ peer: 'ops-api', clock, handlers: o.handlers ?? okHandlers() });
  const def = createGatewayDefinition({
    entry: '/nonexistent/main.ts',
    ...webRootOpt,
    listenPort: o.listenPort ?? ((): number => PORT),
    ...(o.viteOrigin === undefined ? {} : { viteOrigin: o.viteOrigin }),
    ...(o.profile === undefined ? {} : { profileOverride: o.profile }),
    ...(o.randomBytes === undefined ? {} : { randomBytes: o.randomBytes }),
  });
  const internals = await assembleApp(def, {
    callerTokens: TEST_CALLER_TOKENS,
    clock,
    home: home.path,
    log,
    peers: o.peers ?? { 'ops-api': ops },
    appVersion: APP_VERSION,
    bootId: BOOT_ID,
    flags: { safe_mode: o.safeMode ?? false, batch_enabled: false, after_crash: false },
  });
  const app = internals.handle;
  const inject = async (method: string, url: string, i: Injection = {}): Promise<Reply> => {
    const headers: Record<string, string> = { ...(i.withHost === false ? {} : { host: HOST }), ...(i.headers ?? {}) };
    const hasBody = i.body !== undefined;
    if (hasBody) {
      headers['content-type'] = 'application/json';
    }
    const res = await app.fastify.inject({
      method: method as 'GET',
      url,
      headers,
      ...(hasBody ? { payload: JSON.stringify(i.body) } : {}),
    });
    return {
      status: res.statusCode,
      body: res.body,
      json: () => JSON.parse(res.body) as unknown,
      headers: res.headers,
    };
  };
  const login = async (): Promise<Session> => {
    const issued = await inject('POST', '/api/v1/cli/bootstrap-token', {
      headers: { authorization: `Bearer ${o.cliToken ?? CLI_TOKEN}`, 'idempotency-key': nextKey() },
      body: { purpose: 'open' },
    });
    const bt = (issued.json() as { bootstrap_token: string }).bootstrap_token;
    const exchanged = await inject('POST', '/api/v1/session/exchange', { headers: { origin: ORIGIN }, body: { bt } });
    const setCookie = String(exchanged.headers['set-cookie']);
    const cookie = /fathom_sid=([^;]+)/.exec(setCookie)?.[1] ?? '';
    const sid = cookie.split('.')[1] ?? '';
    const base = { cookie: `fathom_sid=${cookie}` };
    const csrf = ((await inject('GET', '/api/v1/session/csrf', { headers: base })).json() as { csrf: string }).csrf;
    return {
      cookie,
      sid,
      csrf,
      headers: (extra = {}) => ({ ...base, ...extra }),
      mutate: (extra = {}) => ({
        ...base,
        origin: ORIGIN,
        'x-fathom-csrf': csrf,
        'idempotency-key': nextKey(),
        ...extra,
      }),
    };
  };
  return {
    app,
    internals,
    clock,
    home,
    logs,
    ops,
    inject,
    login,
    async close(): Promise<void> {
      await app.close();
      await home.cleanup();
    },
  };
}

export function inboxDelivery(events: InboxDelivery['events'], producer: InboxDelivery['producer']): InboxDelivery {
  return { producer, events };
}
