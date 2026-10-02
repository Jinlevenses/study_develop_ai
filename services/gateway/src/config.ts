import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import { AppError, err } from '@fathom/shared-kernel/errors/errors';
import type { PublicAuthHook, ServiceDefinition } from '@fathom/shared-kernel/service/service';
import { registerAll } from './app.js';
import { nodeRandomBytes, nodeSessionCrypto } from './application/session/crypto.js';
import type { SessionReader } from './application/session/session-reader.js';
import type { SseHub } from './application/stream/hub.js';
import { createSseHub } from './application/stream/hub.js';
import { gatewayManifest } from './application/stream/manifest.js';
import {
  cspFor as cspForProfile,
  gatewayFallbacks as fallbacksFor,
  GATEWAY_LIMITS as LIMITS,
  DEFAULT_VITE_ORIGIN as VITE_ORIGIN,
} from './constants.js';
import type { BootstrapTokenStore } from './domain/session/bootstrap-token.js';
import { createBootstrapTokenStore } from './domain/session/bootstrap-token.js';
import type { ActivityTracker } from './infra/activity/activity.js';
import { GATEWAY_ERROR_REGISTRY } from './infra/peers/error-registry.js';

// gateway 서비스 정의(PGM-GW-001·003) — 바뀔 수 있는 설정은 여기에 두고 app.ts는 등록 목록만 둔다.
// 순수 상수·함수(GATEWAY_LIMITS·gatewayFallbacks·cspFor·DEFAULT_VITE_ORIGIN)의 구현은 constants.ts(말단 모듈)에 두고 여기서 같은 이름으로 노출한다 — http/·infra/가 config.ts와 순환하지 않게.

export const DEFAULT_VITE_ORIGIN = VITE_ORIGIN;
export const GATEWAY_LIMITS = LIMITS;
export function gatewayFallbacks(profile: RuntimeProfile): readonly number[] {
  return fallbacksFor(profile);
}
export function cspFor(profile: RuntimeProfile, port: number): string {
  return cspForProfile(profile, port);
}

export type GatewayDefinitionOptions = {
  /** 자기 main 파일 절대 경로. */
  readonly entry: string;
  /** 테스트용 정적 루트 강제(기본: §4.1.9 규칙, `null` = 정적 없음). */
  readonly webRoot?: string | null;
  /** 기본 DEFAULT_VITE_ORIGIN. */
  readonly viteOrigin?: string;
  /** 테스트(inject) 전용 — 기본: `app.fastify.server.address()`. */
  readonly listenPort?: () => number | null;
  /** 테스트 전용 — 기본: `deps.profile`. */
  readonly profileOverride?: RuntimeProfile;
  /** 기본 node:crypto randomBytes. */
  readonly randomBytes?: (n: number) => Uint8Array;
};

/**
 * composition root가 만든 1개 — 설정 파일에서 만들고 register 단계에서 나머지가 채워진다.
 * (Brief 대비 가산: `tokens`·`randomBytes`·`sessionReader`·`bindServer` — 세션·CLI 등록 함수가 같은 저장소를 공유해야 한다.)
 */
export type GatewayContext = {
  readonly opts: GatewayDefinitionOptions;
  readonly hub: SseHub;
  readonly tokens: BootstrapTokenStore;
  readonly randomBytes: (n: number) => Uint8Array;
  /** 봉투 `web_root`와 같은 값 — `defaultWebRoot()`(이 파일 위치가 깊이를 정한다). */
  readonly defaultWebRoot: string;
  activity: ActivityTracker | null;
  publicAuth: PublicAuthHook | null;
  sessionReader: SessionReader | null;
  fallbacks: readonly number[];
  listenPort(): number | null;
  /** registerAll이 Fastify 서버를 넘긴다 — 실제 listen 포트를 지연 조회하는 데 쓴다. */
  bindServer(server: { address(): string | AddressInfo | null }): void;
};

/** 봉투 `web_root`와 같은 값 — `services/gateway/src/config.ts`·`dist/config.js` 둘 다 저장소 루트의 `apps/web/dist/`가 된다. */
export function defaultWebRoot(): string {
  return fileURLToPath(new URL('../../../apps/web/dist/', import.meta.url));
}

function createListenPortResolver(opts: GatewayDefinitionOptions): Pick<GatewayContext, 'listenPort' | 'bindServer'> {
  let server: { address(): string | AddressInfo | null } | null = null;
  let cached: number | null = null;
  return {
    bindServer(s): void {
      server = s;
    },
    listenPort(): number | null {
      if (opts.listenPort !== undefined) {
        return opts.listenPort();
      }
      if (cached !== null) {
        return cached;
      }
      const address = server?.address() ?? null;
      if (address !== null && typeof address === 'object') {
        cached = address.port;
      }
      return cached;
    },
  };
}

function createGatewayContext(opts: GatewayDefinitionOptions): GatewayContext {
  return {
    opts,
    hub: createSseHub({
      ring: LIMITS.sseRing,
      heartbeatMs: LIMITS.sseHeartbeatMs,
      retryMs: LIMITS.sseRetryMs,
      maxPerSession: LIMITS.sseMaxPerSession,
    }),
    tokens: createBootstrapTokenStore({
      ttlMs: LIMITS.bootstrapTtlMs,
      maxOutstanding: LIMITS.bootstrapMaxOutstanding,
      hash: (t) => nodeSessionCrypto.hashB64u(t),
    }),
    randomBytes: opts.randomBytes ?? nodeRandomBytes,
    defaultWebRoot: defaultWebRoot(),
    activity: null,
    publicAuth: null,
    sessionReader: null,
    fallbacks: [],
    ...createListenPortResolver(opts),
  };
}

export function createGatewayDefinition(opts: GatewayDefinitionOptions): ServiceDefinition<null> {
  const ctx = createGatewayContext(opts);
  return {
    svc: 'gateway',
    entry: opts.entry,
    contractsHash: null, // T-00-11 인계: 번들 해시 규약이 정리될 때까지 봉투 값을 그대로 쓴다
    databases: [],
    peers: ['content', 'learning', 'ai-gateway', 'ops-api'],
    events: null,
    inbox: { mode: 'notify', manifest: gatewayManifest(), notify: (events) => ctx.hub.publish(events) },
    errors: GATEWAY_ERROR_REGISTRY,
    publicAuth: (req) =>
      ctx.publicAuth === null
        ? Promise.resolve(err(new AppError('GW-DEP-001', 503, '초기화 중', { extra: { dependency: 'gateway' } })))
        : ctx.publicAuth(req),
    // createService는 listen(9단계)을 register(7단계) 뒤에 하므로, registerAll이 채운 값을 getter가 읽는다(IT-106).
    get portFallbacks(): readonly number[] {
      return ctx.fallbacks;
    },
    register: (app, deps) => registerAll(app, deps, ctx),
  };
}
