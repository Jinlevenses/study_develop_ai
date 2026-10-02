import type { PublicAuthHook } from '@fathom/shared-kernel/service/service';
import { AppError, err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { CliTokenReader } from '../cli/cli-token.js';
import { COOKIE_NAME, readCookie, verifyCookie } from '../../domain/session/cookie.js';
import { verifyCsrf } from '../../domain/session/csrf.js';
import {
  checkClientVersion,
  checkHost,
  checkOrigin,
  checkSecFetchSite,
  isStateChanging,
} from '../../domain/session/guards.js';
import type { RateLimiter } from '../../domain/session/guards-rate-limit.js';
import type { SessionCrypto } from '../../domain/session/ports.js';
import type { ActivityTracker } from '../../infra/activity/activity.js';

// IF-01 §2.11 + ADR-009 §1-5 — `/api/` 공개 요청의 인증·검사. 앞 단계 실패가 이긴다(421 → CLI/브라우저 분기 → …).
// AppError detail에는 원인 범주만 싣는다(토큰·쿠키·CSRF 값 0, STD-LOG-20).

export type PublicAuthDeps = {
  readonly key: Uint8Array;
  readonly crypto: SessionCrypto;
  readonly clock: Clock;
  readonly listenPort: () => number | null;
  readonly appVersion: string;
  readonly limiter: RateLimiter;
  readonly cliToken: CliTokenReader;
  readonly activity: ActivityTracker;
};

type Req = Parameters<PublicAuthHook>[0];
type Verdict = Result<'browser' | 'cli', AppError>;

const CLI_PREFIX = '/api/v1/cli/';
const EXCHANGE_PATH = '/api/v1/session/exchange';
const STREAM_PATH = '/api/v1/stream';
const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{43})$/;

const fail = (code: ConstructorParameters<typeof AppError>[0], status: number, detail: string): Verdict =>
  err(new AppError(code, status, detail));

function header(req: Req, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function limited(d: PublicAuthDeps, key: string): Verdict | null {
  const hit = d.limiter.hit(key, d.clock.now());
  if (hit.allowed) {
    return null;
  }
  return err(
    new AppError('GW-LIMIT-001', 429, '요청 한도를 넘었다.', { extra: { retry_after_ms: hit.retryAfterMs } }),
  );
}

async function checkCli(d: PublicAuthDeps, req: Req): Promise<Verdict> {
  const authorization = header(req, 'authorization');
  const presented = authorization === undefined ? null : (BEARER_RE.exec(authorization)?.[1] ?? null);
  if (authorization === undefined && readCookie(header(req, 'cookie'), COOKIE_NAME) !== undefined) {
    return fail('GW-ACL-001', 403, '쿠키로는 CLI API를 호출할 수 없다.'); // C2
  }
  const expected = await d.cliToken.get();
  if (presented === null || expected === null || !d.crypto.equal(presented, expected)) {
    return fail('GW-AUTH-007', 401, 'CLI 토큰이 없거나 무효다.');
  }
  const over = limited(d, 'cli'); // C3
  if (over !== null) {
    return over;
  }
  if (!checkClientVersion(header(req, 'x-fathom-client'), d.appVersion)) {
    return fail('GW-CONFLICT-010', 409, '클라이언트 버전이 서버와 다르다.'); // C4
  }
  return ok('cli');
}

function checkBrowser(d: PublicAuthDeps, req: Req, path: string, port: number): Verdict {
  const exchange = req.method === 'POST' && path === EXCHANGE_PATH;
  if (
    (isStateChanging(req.method) || exchange) &&
    !(checkOrigin(header(req, 'origin'), port) && checkSecFetchSite(header(req, 'sec-fetch-site')))
  ) {
    return fail('GW-AUTH-006', 403, '요청 출처가 허용되지 않는다.'); // ②
  }
  if (header(req, 'authorization') !== undefined) {
    return fail('GW-ACL-001', 403, 'CLI 토큰으로는 브라우저 API를 호출할 수 없다.'); // ②′
  }
  let sid = 'exchange';
  if (!exchange) {
    const cookie = verifyCookie(
      readCookie(header(req, 'cookie'), COOKIE_NAME),
      d.key,
      d.crypto,
      Math.floor(d.clock.now() / 1000),
    );
    if (!cookie.ok) {
      return fail('GW-AUTH-003', 401, '세션 쿠키가 없거나 무효다.'); // ③
    }
    if (cookie.value.port !== port) {
      return fail('GW-AUTH-001', 401, '세션 쿠키의 포트가 이 서버와 다르다.'); // ④
    }
    if (isStateChanging(req.method) && !verifyCsrf(header(req, 'x-fathom-csrf'), cookie.value.sid, d.key, d.crypto)) {
      return fail('GW-AUTH-002', 403, 'CSRF 토큰이 없거나 일치하지 않는다.'); // ⑤
    }
    sid = `sid:${cookie.value.sid}`;
  }
  const over = limited(d, sid); // ⑥
  if (over !== null) {
    return over;
  }
  if (!checkClientVersion(header(req, 'x-fathom-client'), d.appVersion)) {
    return fail('GW-CONFLICT-010', 409, '클라이언트 버전이 서버와 다르다.'); // ⑦
  }
  if (path !== STREAM_PATH) {
    d.activity.touch(d.clock.now()); // ⑧
  }
  return ok('browser');
}

export function createPublicAuth(d: PublicAuthDeps): PublicAuthHook {
  return async (req) => {
    const path = pathOf(req.url);
    const port = d.listenPort();
    if (port === null) {
      throw new Error('invariant: gateway listen port unknown while serving /api/');
    }
    if (!checkHost(header(req, 'host'), port)) {
      return fail('GW-AUTH-005', 421, 'Host가 허용되지 않는다.'); // ①
    }
    return path.startsWith(CLI_PREFIX) ? await checkCli(d, req) : checkBrowser(d, req, path, port);
  };
}
