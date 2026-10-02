import { describe, expect, it, vi } from 'vitest';
import { nodeSessionCrypto } from '../../src/application/session/crypto.js';
import { cspFor, gatewayFallbacks } from '../../src/config.js';
import { createBootstrapTokenStore } from '../../src/domain/session/bootstrap-token.js';
import {
  COOKIE_NAME,
  clearCookieHeader,
  needsRoll,
  readCookie,
  setCookieHeader,
  signCookie,
  verifyCookie,
} from '../../src/domain/session/cookie.js';
import { csrfToken, verifyCsrf } from '../../src/domain/session/csrf.js';
import {
  checkClientVersion,
  checkHost,
  checkOrigin,
  checkSecFetchSite,
  isStateChanging,
} from '../../src/domain/session/guards.js';
import { createRateLimiter } from '../../src/domain/session/guards-rate-limit.js';
import { classifyPathOf, decodedPathOf, isEncodedBypass, isGuardedPath } from '../../src/domain/session/path.js';

const KEY = new Uint8Array(32).fill(1);
const SID = 'AAAAAAAAAAAAAAAAAAAAAA'; // 22자
const NOW_S = 1_790_000_000;

describe('쿠키 · CSRF (순수 규칙)', () => {
  it('UT-GW-005 CSRF = base64url(HMAC-SHA256(key, "csrf|"+sid)) 고정 벡터, 비교는 SessionCrypto.equal 1회 경유 [NFR-SEC-002]', () => {
    // Arrange: 키 32×0x01, sid 고정 — 외부에서 계산한 벡터
    const vector = '1F_qLgtoK1rHjHImCGx00clobytCDt7i7i6mZ67eWDQ';
    expect(csrfToken(SID, KEY, nodeSessionCrypto)).toBe(vector);
    const equal = vi.fn((a: string, b: string) => nodeSessionCrypto.equal(a, b));
    const spy = { ...nodeSessionCrypto, equal };
    // Act / Assert
    expect(verifyCsrf(vector, SID, KEY, spy)).toBe(true);
    expect(equal).toHaveBeenCalledTimes(1);
    expect(verifyCsrf(`${vector.slice(0, -1)}A`, SID, KEY, spy)).toBe(false);
    expect(verifyCsrf(undefined, SID, KEY, spy)).toBe(false);
    expect(verifyCsrf('', SID, KEY, spy)).toBe(false);
  });

  it('UT-GW-007 signCookie/verifyCookie 고정 벡터 왕복 [NFR-SEC-019]', () => {
    // Arrange
    const cookie = { sid: SID, port: 4747, iat: NOW_S };
    // Act
    const value = signCookie(cookie, KEY, nodeSessionCrypto);
    // Assert
    expect(value).toMatch(/^v1\.AAAAAAAAAAAAAAAAAAAAAA\.4747\.1790000000\.[A-Za-z0-9_-]{43}$/);
    expect(verifyCookie(value, KEY, nodeSessionCrypto, NOW_S)).toEqual({ ok: true, value: cookie });
    expect(verifyCookie(value, new Uint8Array(32).fill(2), nodeSessionCrypto, NOW_S)).toEqual({
      ok: false,
      error: 'bad_mac',
    });
    expect(verifyCookie(undefined, KEY, nodeSessionCrypto, NOW_S)).toEqual({ ok: false, error: 'missing' });
  });

  it('UT-GW-008 malformed: v2·조각 4개·sid 21자·port 0/65536·mac 42자 [NFR-SEC-019]', () => {
    const good = signCookie({ sid: SID, port: 4747, iat: NOW_S }, KEY, nodeSessionCrypto);
    const parts = good.split('.');
    const bad = [
      ['v2', ...parts.slice(1)].join('.'),
      parts.slice(0, 4).join('.'),
      [parts[0], SID.slice(1), ...parts.slice(2)].join('.'),
      [parts[0], parts[1], '0', parts[3], parts[4]].join('.'),
      [parts[0], parts[1], '65536', parts[3], parts[4]].join('.'),
      [...parts.slice(0, 4), (parts[4] ?? '').slice(1)].join('.'),
    ];
    for (const v of bad) {
      expect(verifyCookie(v, KEY, nodeSessionCrypto, NOW_S), v).toEqual({ ok: false, error: 'malformed' });
    }
  });

  it('UT-GW-009 expired: iat 미래 301s·400일 초과, 경계(300s·400일)는 통과 [NFR-SEC-019]', () => {
    const at = (iat: number): string => signCookie({ sid: SID, port: 4747, iat }, KEY, nodeSessionCrypto);
    expect(verifyCookie(at(NOW_S + 301), KEY, nodeSessionCrypto, NOW_S)).toEqual({ ok: false, error: 'expired' });
    expect(verifyCookie(at(NOW_S + 300), KEY, nodeSessionCrypto, NOW_S).ok).toBe(true);
    expect(verifyCookie(at(NOW_S - 34_560_001), KEY, nodeSessionCrypto, NOW_S)).toEqual({
      ok: false,
      error: 'expired',
    });
    expect(verifyCookie(at(NOW_S - 34_560_000), KEY, nodeSessionCrypto, NOW_S).ok).toBe(true);
    expect(needsRoll({ sid: SID, port: 1, iat: NOW_S - 86_400 }, NOW_S)).toBe(true);
    expect(needsRoll({ sid: SID, port: 1, iat: NOW_S - 86_399 }, NOW_S)).toBe(false);
  });

  it('UT-GW-010 readCookie 다중 쿠키·없음, Set-Cookie 문자열 형식 [NFR-SEC-019]', () => {
    expect(readCookie('a=1; fathom_sid=xyz; b=2', COOKIE_NAME)).toBe('xyz');
    expect(readCookie('a=1; b=2', COOKIE_NAME)).toBeUndefined();
    expect(readCookie(undefined, COOKIE_NAME)).toBeUndefined();
    expect(readCookie('xfathom_sid=no; fathom_sid=yes', COOKIE_NAME)).toBe('yes');
    expect(setCookieHeader('v')).toBe('fathom_sid=v; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000');
    expect(clearCookieHeader()).toBe('fathom_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  });
});

describe('가드 · rate limit · 토큰 저장소 (순수 규칙)', () => {
  it('UT-GW-011 checkHost 허용(127.0.0.1·localhost·LOCALHOST)·거부(포트 없음·다른 포트·[::1]·없음) [NFR-SEC-002]', () => {
    expect(checkHost('127.0.0.1:4747', 4747)).toBe(true);
    expect(checkHost('localhost:4747', 4747)).toBe(true);
    expect(checkHost('LOCALHOST:4747', 4747)).toBe(true);
    expect(checkHost('127.0.0.1', 4747)).toBe(false);
    expect(checkHost('127.0.0.1:4748', 4747)).toBe(false);
    expect(checkHost('[::1]:4747', 4747)).toBe(false);
    expect(checkHost(undefined, 4747)).toBe(false);
    expect(checkHost('evil.test:4747', 4747)).toBe(false);
  });

  it('UT-GW-012 checkOrigin 허용 2개·거부(https·포트 없음·없음) [NFR-SEC-002]', () => {
    expect(checkOrigin('http://127.0.0.1:4747', 4747)).toBe(true);
    expect(checkOrigin('http://localhost:4747', 4747)).toBe(true);
    expect(checkOrigin('https://127.0.0.1:4747', 4747)).toBe(false);
    expect(checkOrigin('http://127.0.0.1', 4747)).toBe(false);
    expect(checkOrigin(undefined, 4747)).toBe(false);
    expect(checkOrigin('null', 4747)).toBe(false);
  });

  it('UT-GW-013 checkSecFetchSite none·same-origin·없음 통과, same-site·cross-site 거부, isStateChanging [NFR-SEC-002]', () => {
    expect(checkSecFetchSite(undefined)).toBe(true);
    expect(checkSecFetchSite('none')).toBe(true);
    expect(checkSecFetchSite('same-origin')).toBe(true);
    expect(checkSecFetchSite('same-site')).toBe(false);
    expect(checkSecFetchSite('cross-site')).toBe(false);
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isStateChanging(m)).toBe(false);
    }
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isStateChanging(m)).toBe(true);
    }
  });

  it('UT-GW-014 checkClientVersion 없음 통과·web/<v>·cli/<v> 통과·불일치·형식 오류 거부 [NFR-SEC-002][NFR-MAINT-006]', () => {
    expect(checkClientVersion(undefined, '0.1.0')).toBe(true);
    expect(checkClientVersion('web/0.1.0', '0.1.0')).toBe(true);
    expect(checkClientVersion('cli/0.1.0', '0.1.0')).toBe(true);
    expect(checkClientVersion('web/0.1.1', '0.1.0')).toBe(false);
    expect(checkClientVersion('app/0.1.0', '0.1.0')).toBe(false);
    expect(checkClientVersion('web', '0.1.0')).toBe(false);
  });

  it('UT-GW-110 고정 창 rate limiter: 한도 초과·retryAfterMs·창 경과 후 허용·키 독립·키 수 상한 [NFR-SEC-017][STD-SEC-28]', () => {
    // Arrange
    const limiter = createRateLimiter({ max: 3, windowMs: 1000, maxKeys: 2 });
    // Act / Assert
    expect(limiter.hit('a', 0).allowed).toBe(true);
    expect(limiter.hit('a', 100).allowed).toBe(true);
    expect(limiter.hit('a', 200).allowed).toBe(true);
    expect(limiter.hit('a', 300)).toEqual({ allowed: false, retryAfterMs: 700 });
    expect(limiter.hit('b', 300).allowed).toBe(true);
    expect(limiter.hit('a', 1000).allowed).toBe(true); // 새 창
    // 키 수 상한: 3번째 키가 들어오면 가장 오래된 창(b)이 지워져 b가 새 창으로 시작한다
    limiter.hit('c', 1100);
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.hit('b', 1200).allowed).toBe(true);
    }
  });

  it('UT-GW-020 부트스트랩 토큰: 해시 키로만 저장·1회 소비·TTL 경계 [NFR-SEC-019]', () => {
    // Arrange
    const hash = vi.fn((t: string) => `h(${t})`);
    const store = createBootstrapTokenStore({ ttlMs: 60_000, maxOutstanding: 16, hash });
    // Act
    const expiresAt = store.issue('tok-1', 1000);
    // Assert
    expect(expiresAt).toBe(61_000);
    expect(store.consume('tok-1', 60_999)).toBe(true);
    expect(store.consume('tok-1', 60_999)).toBe(false); // 재사용
    expect(hash).toHaveBeenCalledWith('tok-1');
    store.issue('tok-2', 1000);
    expect(store.consume('tok-2', 61_000)).toBe(false); // 만료 경계
    expect(store.consume('never-issued', 1000)).toBe(false);
  });

  it('UT-GW-111 발급 17개째 → 가장 이른 것 무효 [NFR-SEC-019]', () => {
    const store = createBootstrapTokenStore({ ttlMs: 60_000, maxOutstanding: 16, hash: (t) => t });
    for (let i = 1; i <= 17; i += 1) {
      store.issue(`t${i}`, i);
    }
    expect(store.consume('t1', 100)).toBe(false);
    expect(store.consume('t2', 100)).toBe(true);
    expect(store.consume('t17', 100)).toBe(true);
  });

  it('UT-GW-156 cspFor·gatewayFallbacks 순수 값 [AP-12][FR-SET-001]', () => {
    const prod =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
    expect(cspFor('prod', 4747)).toBe(prod);
    expect(cspFor('test', 1234)).toBe(prod);
    expect(cspFor('dev', 4849)).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://127.0.0.1:4849; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    expect(gatewayFallbacks('prod')).toEqual([4748, 4749, 4750, 4751, 4752, 4753, 4754, 4755, 4756]);
    expect(gatewayFallbacks('dev')).toEqual([4848, 4849, 4850, 4851, 4852, 4853, 4854, 4855, 4856]);
    expect(gatewayFallbacks('test')).toEqual([]);
  });
});

describe('경로 정규형 검사', () => {
  it('UT-GW-115 isEncodedBypass: 디코딩하면 /api/·/internal/인데 원본이 정규형이 아니거나 origin-form이 아닌(absolute-form·*) 대상이면 true, 정규형·무관 경로·잘못된 인코딩은 false [NFR-SEC-019]', () => {
    const bypass = [
      '/%61pi/v1/cli/status',
      '/%69nternal/v1/activity?x=1',
      '/api%2Fv1/session',
      '/api/v1/%63li/status',
      '/api/v1/cli/%62ootstrap-token',
      '/api/v1/%2e%2e/cli/status',
      'http://127.0.0.1:4747/api/v1/cli/status',
      'http://127.0.0.1:4747/internal/v1/activity',
      'HTTP://localhost/api/v1/cli/shutdown',
      '*',
      '',
    ];
    const fine = [
      '/api/v1/cli/status',
      '/internal/v1/activity',
      '/api/v1/concepts/%ED%95%9C',
      '/api/v1/things/a%20b',
      '/',
      '//x',
      '/assets/app-%41b.js',
      '/%61bout',
      '/api/v1/%E0%A4%A',
    ];
    for (const u of bypass) {
      expect(isEncodedBypass(u), u).toBe(true);
    }
    for (const u of fine) {
      expect(isEncodedBypass(u), u).toBe(false);
    }
    expect(decodedPathOf('/%61pi/x?q=%62')).toBe('/api/x');
    expect(decodedPathOf('/%E0%A4%A')).toBeNull();
    expect(classifyPathOf('/%E0%A4%A')).toBe('/%E0%A4%A');
    expect(isGuardedPath('/%61pi/v1/x')).toBe(true);
    expect(isGuardedPath('/about')).toBe(false);
  });
});
