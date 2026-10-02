import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import type {
  SessionCsrfRoute,
  SessionExchangeRoute,
  SessionLogoutRoute,
  SessionStatusRoute,
} from '@fathom/contracts/http/gateway/v1/session';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { RouteContext, RouteReply, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import type { SessionCookie } from '../../domain/session/cookie.js';
import { clearCookieHeader, needsRoll, setCookieHeader, signCookie } from '../../domain/session/cookie.js';
import { csrfToken } from '../../domain/session/csrf.js';
import type { SessionCrypto } from '../../domain/session/ports.js';
import { toBase64Url } from './crypto.js';
import type { SessionReader } from './session-reader.js';

// IF-GW-002·003·004·006 핸들러 — 쿠키 발급·CSRF·상태·로그아웃. `sid`는 인증 훅이 통과시킨 쿠키를 다시 읽어 얻는다.

export type SessionHandlerDeps = {
  readonly key: Uint8Array;
  readonly crypto: SessionCrypto;
  readonly reader: SessionReader;
  readonly deps: ServiceDeps<null>;
  readonly ctx: GatewayContext;
};

const SID_BYTES = 16;

function portOf(d: SessionHandlerDeps): number {
  const port = d.ctx.listenPort();
  if (port === null) {
    throw new Error('invariant: gateway listen port unknown');
  }
  return port;
}

const profileOf = (d: SessionHandlerDeps): RuntimeProfile => d.ctx.opts.profileOverride ?? d.deps.profile;
const nowS = (d: SessionHandlerDeps): number => Math.floor(d.deps.clock.now() / 1000);

/** 하루 이상 지난 쿠키는 같은 `sid`·새 `iat`로 `set-cookie`를 함께 보낸다(Brief 결정 §10 ⑥). */
function rollHeaders(d: SessionHandlerDeps, cookie: SessionCookie): Readonly<Record<string, string>> | undefined {
  const now = nowS(d);
  if (!needsRoll(cookie, now)) {
    return undefined;
  }
  return {
    'set-cookie': setCookieHeader(signCookie({ sid: cookie.sid, port: cookie.port, iat: now }, d.key, d.crypto)),
  };
}

export function createSessionHandlers(d: SessionHandlerDeps): {
  exchange(c: RouteContext<typeof SessionExchangeRoute>): Promise<RouteReply<typeof SessionExchangeRoute, 200>>;
  csrf(c: RouteContext<typeof SessionCsrfRoute>): Promise<RouteReply<typeof SessionCsrfRoute, 200>>;
  logout(c: RouteContext<typeof SessionLogoutRoute>): Promise<RouteReply<typeof SessionLogoutRoute, 204>>;
  status(c: RouteContext<typeof SessionStatusRoute>): Promise<RouteReply<typeof SessionStatusRoute, 200>>;
} {
  return {
    exchange(c): Promise<RouteReply<typeof SessionExchangeRoute, 200>> {
      const now = d.deps.clock.now();
      if (!d.ctx.tokens.consume(c.body.bt, now)) {
        throw new AppError('GW-AUTH-004', 401, '부트스트랩 토큰이 무효이거나 만료·재사용됐다.');
      }
      const port = portOf(d);
      const cookie: SessionCookie = { sid: toBase64Url(d.ctx.randomBytes(SID_BYTES)), port, iat: nowS(d) };
      return Promise.resolve({
        status: 200,
        body: { session_established: true, port, app_version: d.deps.appVersion, profile: profileOf(d) },
        headers: { 'set-cookie': setCookieHeader(signCookie(cookie, d.key, d.crypto)) },
      });
    },
    csrf(c): Promise<RouteReply<typeof SessionCsrfRoute, 200>> {
      const cookie = d.reader.read(c.raw.headers);
      const headers = rollHeaders(d, cookie);
      return Promise.resolve({
        status: 200,
        body: { csrf: csrfToken(cookie.sid, d.key, d.crypto) },
        ...(headers === undefined ? {} : { headers }),
      });
    },
    logout(): Promise<RouteReply<typeof SessionLogoutRoute, 204>> {
      return Promise.resolve({ status: 204, body: null, headers: { 'set-cookie': clearCookieHeader() } });
    },
    status(c): Promise<RouteReply<typeof SessionStatusRoute, 200>> {
      const cookie = d.reader.read(c.raw.headers);
      const headers = rollHeaders(d, cookie);
      return Promise.resolve({
        status: 200,
        body: {
          authenticated: true,
          port: portOf(d),
          app_version: d.deps.appVersion,
          boot_id: d.deps.bootId,
          profile: profileOf(d),
          safe_mode: d.deps.flags.safe_mode,
          maintenance: 'none',
        },
        ...(headers === undefined ? {} : { headers }),
      });
    },
  };
}
