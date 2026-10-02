import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Problem } from '@fathom/contracts/common/problem';
import { ExchangeResponse, SessionStatus } from '@fathom/contracts/http/gateway/v1/session';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeSessionCrypto } from '../../src/application/session/crypto.js';
import { signCookie } from '../../src/domain/session/cookie.js';
import type { Rig, Session } from './support.js';
import { APP_VERSION, BOOT_ID, CLI_TOKEN, makeRig, nextKey, ORIGIN, PORT } from './support.js';

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});
async function rig(o: Parameters<typeof makeRig>[0] = {}): Promise<Rig> {
  const r = await makeRig(o);
  rigs.push(r);
  return r;
}
const problem = (body: string): Problem => Problem.parse(JSON.parse(body));
const keyOf = (r: Rig): Uint8Array => new Uint8Array(readFileSync(path.join(r.home.path, 'run', 'session.key')));
const nowS = (r: Rig): number => Math.floor(r.clock.now() / 1000);
const cliHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  authorization: `Bearer ${CLI_TOKEN}`,
  ...extra,
});

async function issueToken(r: Rig): Promise<string> {
  const res = await r.inject('POST', '/api/v1/cli/bootstrap-token', {
    headers: cliHeaders({ 'idempotency-key': nextKey() }),
    body: { purpose: 'open' },
  });
  expect(res.status).toBe(201);
  return (res.json() as { bootstrap_token: string }).bootstrap_token;
}
const exchange = (r: Rig, bt: string): ReturnType<Rig['inject']> =>
  r.inject('POST', '/api/v1/session/exchange', { headers: { origin: ORIGIN }, body: { bt } });
const cookieHeader = (value: string): Record<string, string> => ({ cookie: `fathom_sid=${value}` });
const forged = (r: Rig, over: { port?: number; iat?: number; sid?: string } = {}): string =>
  signCookie(
    { sid: over.sid ?? 'BBBBBBBBBBBBBBBBBBBBBB', port: over.port ?? PORT, iat: over.iat ?? nowS(r) },
    keyOf(r),
    nodeSessionCrypto,
  );

describe('세션 쿠키 검증', () => {
  it('UT-GW-001 쿠키 mac 1글자 변조 → 401 GW-AUTH-003, 원본 → 200 [NFR-SEC-019][FR-SET-023]', async () => {
    // Arrange
    const r = await rig();
    const s = await r.login();
    const last = s.cookie.slice(-1);
    const tampered = `${s.cookie.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    // Act
    const bad = await r.inject('GET', '/api/v1/session', { headers: cookieHeader(tampered) });
    const good = await r.inject('GET', '/api/v1/session', { headers: s.headers() });
    // Assert
    expect(bad.status).toBe(401);
    expect(problem(bad.body).code).toBe('GW-AUTH-003');
    expect(good.status).toBe(200);
  });

  it('UT-GW-002 쿠키 <port> ≠ listen 포트(올바른 mac) → 401 GW-AUTH-001 [NFR-SEC-019]', async () => {
    const r = await rig();
    const res = await r.inject('GET', '/api/v1/session', { headers: cookieHeader(forged(r, { port: PORT + 1 })) });
    expect(res.status).toBe(401);
    expect(problem(res.body).code).toBe('GW-AUTH-001');
  });

  it('UT-GW-003 부트스트랩 토큰 1회 소비·59,999ms 통과·60,000ms 만료 [NFR-SEC-019]', async () => {
    // Arrange
    const r = await rig();
    const t1 = await issueToken(r);
    // Act / Assert: 1회
    expect((await exchange(r, t1)).status).toBe(200);
    const again = await exchange(r, t1);
    expect(again.status).toBe(401);
    expect(problem(again.body).code).toBe('GW-AUTH-004');
    // TTL 경계
    const t2 = await issueToken(r);
    r.clock.advance(59_999);
    expect((await exchange(r, t2)).status).toBe(200);
    const t3 = await issueToken(r);
    r.clock.advance(60_000);
    const expired = await exchange(r, t3);
    expect(expired.status).toBe(401);
    expect(problem(expired.body).code).toBe('GW-AUTH-004');
  });

  it('UT-GW-006 iat 86,400s 이전 쿠키로 GET /session·/session/csrf → 같은 sid·새 iat set-cookie, 86,399s → 없음 [FR-SET-023]', async () => {
    // Arrange
    const r = await rig();
    for (const url of ['/api/v1/session', '/api/v1/session/csrf']) {
      const old = forged(r, { iat: nowS(r) - 86_400 });
      // Act
      const rolled = await r.inject('GET', url, { headers: cookieHeader(old) });
      const fresh = await r.inject('GET', url, { headers: cookieHeader(forged(r, { iat: nowS(r) - 86_399 })) });
      // Assert
      expect(rolled.status).toBe(200);
      const expected = signCookie(
        { sid: 'BBBBBBBBBBBBBBBBBBBBBB', port: PORT, iat: nowS(r) },
        keyOf(r),
        nodeSessionCrypto,
      );
      expect(rolled.headers['set-cookie']).toBe(
        `fathom_sid=${expected}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`,
      );
      expect(fresh.headers['set-cookie']).toBeUndefined();
    }
  });
});

describe('검사 순서(IF §2.11)', () => {
  it('UT-GW-004 Host 421 · Origin 403 · Sec-Fetch-Site 403 [NFR-SEC-002]', async () => {
    const r = await rig();
    const s = await r.login();
    const host = await r.inject('GET', '/api/v1/session', { headers: { ...s.headers(), host: 'evil.test:4747' } });
    expect(host.status).toBe(421);
    expect(problem(host.body).code).toBe('GW-AUTH-005');
    const origin = await r.inject('POST', '/api/v1/session/logout', {
      headers: s.mutate({ origin: 'http://127.0.0.1:9999' }),
    });
    expect(origin.status).toBe(403);
    expect(problem(origin.body).code).toBe('GW-AUTH-006');
    const site = await r.inject('POST', '/api/v1/session/logout', {
      headers: s.mutate({ 'sec-fetch-site': 'cross-site' }),
    });
    expect(site.status).toBe(403);
    expect(problem(site.body).code).toBe('GW-AUTH-006');
  });

  it('UT-GW-015 Host 불량 + 쿠키 불량 → 421, Origin 불량 + 쿠키 불량 → 403 GW-AUTH-006 [NFR-SEC-002][NFR-SEC-019]', async () => {
    const r = await rig();
    const badCookie = cookieHeader('garbage');
    const host = await r.inject('POST', '/api/v1/session/logout', {
      headers: { ...badCookie, host: 'evil.test:4747', origin: ORIGIN },
    });
    expect(problem(host.body).code).toBe('GW-AUTH-005');
    const origin = await r.inject('POST', '/api/v1/session/logout', {
      headers: { ...badCookie, origin: 'http://evil.test' },
    });
    expect(problem(origin.body).code).toBe('GW-AUTH-006');
  });

  it('UT-GW-016 쿠키 불량 + CSRF 불량 → 401 GW-AUTH-003 · 포트 불일치 + CSRF 불량 → 401 GW-AUTH-001 [NFR-SEC-002][NFR-SEC-019]', async () => {
    const r = await rig();
    const noCookie = await r.inject('POST', '/api/v1/session/logout', {
      headers: { origin: ORIGIN, 'x-fathom-csrf': 'bad', 'idempotency-key': nextKey(), ...cookieHeader('garbage') },
    });
    expect(problem(noCookie.body).code).toBe('GW-AUTH-003');
    const wrongPort = await r.inject('POST', '/api/v1/session/logout', {
      headers: {
        origin: ORIGIN,
        'x-fathom-csrf': 'bad',
        'idempotency-key': nextKey(),
        ...cookieHeader(forged(r, { port: PORT + 1 })),
      },
    });
    expect(problem(wrongPort.body).code).toBe('GW-AUTH-001');
  });

  it('UT-GW-017 CSRF 불량 + 한도 초과 → 403 GW-AUTH-002, 올바른 CSRF + 한도 초과 → 429 [NFR-SEC-002]', async () => {
    // Arrange: 같은 세션으로 300회 소진
    const r = await rig();
    const s = await r.login();
    const used = 2; // login()이 csrf GET을 1번 썼다(+ 교환은 'exchange' 키) — 아래에서 정확히 채운다
    for (let i = 0; i < 300 - used + 1; i += 1) {
      const res = await r.inject('GET', '/api/v1/session', { headers: s.headers() });
      if (res.status === 429) {
        break;
      }
    }
    // Act
    const bad = await r.inject('POST', '/api/v1/session/logout', {
      headers: { ...s.mutate(), 'x-fathom-csrf': 'wrong' },
    });
    const good = await r.inject('POST', '/api/v1/session/logout', { headers: s.mutate() });
    // Assert
    expect(problem(bad.body).code).toBe('GW-AUTH-002');
    expect(good.status).toBe(429);
    expect(problem(good.body).code).toBe('GW-LIMIT-001');
  });

  it('UT-GW-018 교환은 쿠키 미검사 · GET은 Origin 미검사 [NFR-SEC-002][NFR-SEC-019]', async () => {
    const r = await rig();
    const bt = await issueToken(r);
    const res = await r.inject('POST', '/api/v1/session/exchange', {
      headers: { origin: ORIGIN, ...cookieHeader('garbage') },
      body: { bt },
    });
    expect(res.status).toBe(200);
    const s = await r.login();
    const get = await r.inject('GET', '/api/v1/session', { headers: { ...s.headers(), origin: 'http://evil.test' } });
    expect(get.status).toBe(200);
    // 교환은 Origin을 요구한다
    const noOrigin = await r.inject('POST', '/api/v1/session/exchange', { body: { bt: await issueToken(r) } });
    expect(problem(noOrigin.body).code).toBe('GW-AUTH-006');
  });
});

describe('교환 · CSRF · 상태 · 로그아웃', () => {
  it('UT-GW-019 교환: 200 ExchangeResponse + set-cookie, bt 형식 위반 → 400 GW-VAL-900 [NFR-SEC-019][IF-GW-002]', async () => {
    const r = await rig();
    const bt = await issueToken(r);
    const res = await exchange(r, bt);
    expect(res.status).toBe(200);
    expect(ExchangeResponse.parse(res.json())).toEqual({
      session_established: true,
      port: PORT,
      app_version: APP_VERSION,
      profile: 'test',
    });
    expect(String(res.headers['set-cookie'])).toMatch(
      /^fathom_sid=v1\.[A-Za-z0-9_-]{22}\.4747\.\d+\.[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=34560000$/,
    );
    const invalid = await exchange(r, 'short');
    expect(invalid.status).toBe(400);
    expect(problem(invalid.body).code).toBe('GW-VAL-900');
  });

  it('UT-GW-021 발급 17개째 → 가장 이른 토큰은 교환 실패, 나머지는 성공 [NFR-SEC-019]', async () => {
    const r = await rig();
    const tokens: string[] = [];
    for (let i = 0; i < 17; i += 1) {
      tokens.push(await issueToken(r));
    }
    expect((await exchange(r, tokens[0] ?? '')).status).toBe(401);
    expect((await exchange(r, tokens[1] ?? '')).status).toBe(200);
  });

  it('UT-GW-022 로그아웃 204 + Max-Age=0, CSRF 없음 → 403, Idempotency-Key 없음 → 400 GW-VAL-901 [IF-GW-004]', async () => {
    const r = await rig();
    const s = await r.login();
    const out = await r.inject('POST', '/api/v1/session/logout', { headers: s.mutate() });
    expect(out.status).toBe(204);
    expect(out.body).toBe('');
    expect(out.headers['set-cookie']).toBe('fathom_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    const noCsrf = await r.inject('POST', '/api/v1/session/logout', {
      headers: { ...s.headers(), origin: ORIGIN, 'idempotency-key': nextKey() },
    });
    expect(noCsrf.status).toBe(403);
    expect(problem(noCsrf.body).code).toBe('GW-AUTH-002');
    const noKey = await r.inject('POST', '/api/v1/session/logout', {
      headers: { ...s.headers(), origin: ORIGIN, 'x-fathom-csrf': s.csrf },
    });
    expect(noKey.status).toBe(400);
    expect(problem(noKey.body).code).toBe('GW-VAL-901');
  });

  it('UT-GW-023 상태: SessionStatus 통과·boot_id = deps 값·safe_mode = 플래그·maintenance none [IF-GW-006]', async () => {
    const r = await rig({ safeMode: true });
    const s: Session = await r.login();
    const res = await r.inject('GET', '/api/v1/session', { headers: s.headers() });
    expect(SessionStatus.parse(res.json())).toEqual({
      authenticated: true,
      port: PORT,
      app_version: APP_VERSION,
      boot_id: BOOT_ID,
      profile: 'test',
      safe_mode: true,
      maintenance: 'none',
    });
    const csrf = await r.inject('GET', '/api/v1/session/csrf', { headers: s.headers() });
    expect((csrf.json() as { csrf: string }).csrf).toBe(s.csrf);
  });

  it('UT-GW-024 x-fathom-client 불일치 → 409 GW-CONFLICT-010, 일치·없음 → 200, CLI 라우트도 동일 [NFR-MAINT-006]', async () => {
    const r = await rig();
    const s = await r.login();
    const mismatch = await r.inject('GET', '/api/v1/session', {
      headers: s.headers({ 'x-fathom-client': 'web/0.0.0-x' }),
    });
    expect(mismatch.status).toBe(409);
    expect(problem(mismatch.body).code).toBe('GW-CONFLICT-010');
    expect(
      (await r.inject('GET', '/api/v1/session', { headers: s.headers({ 'x-fathom-client': `web/${APP_VERSION}` }) }))
        .status,
    ).toBe(200);
    expect((await r.inject('GET', '/api/v1/session', { headers: s.headers() })).status).toBe(200);
    const cli = await r.inject('GET', '/api/v1/cli/status', {
      headers: cliHeaders({ 'x-fathom-client': 'cli/0.0.0-x' }),
    });
    expect(problem(cli.body).code).toBe('GW-CONFLICT-010');
    expect(
      (
        await r.inject('GET', '/api/v1/cli/status', {
          headers: cliHeaders({ 'x-fathom-client': `cli/${APP_VERSION}` }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('session.key · CLI 토큰 분리', () => {
  it('UT-GW-025 session.key: 없으면 32바이트·0600 생성, 있으면 재사용(새 앱·같은 HOME에서 기존 쿠키 200) [NFR-SEC-019][STD-SEC-21]', async () => {
    // Arrange
    const first = await rig();
    const file = path.join(first.home.path, 'run', 'session.key');
    expect(statSync(file).size).toBe(32);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const s = await first.login();
    const before = readFileSync(file);
    // Act: 같은 HOME에서 새 앱 인스턴스
    const second = await makeRig({ home: first.home });
    // Assert
    expect(readFileSync(file).equals(before)).toBe(true);
    expect((await second.inject('GET', '/api/v1/session', { headers: s.headers() })).status).toBe(200);
    await second.app.close();
  });

  it('UT-GW-026 session.key 31바이트 → 재생성 + warn 1줄 + 기존 쿠키 401 [NFR-SEC-019][STD-SEC-21]', async () => {
    // Arrange
    const first = await rig();
    const s = await first.login();
    const file = path.join(first.home.path, 'run', 'session.key');
    writeFileSync(file, new Uint8Array(31));
    // Act
    const second = await makeRig({ home: first.home });
    // Assert
    expect(statSync(file).size).toBe(32);
    const warns = second.logs.filter((l) => l.includes('gateway.session_key.invalid'));
    expect(warns).toHaveLength(1);
    expect(JSON.parse(warns[0] ?? '{}')).toMatchObject({ level: 'warn', length: 31 });
    const res = await second.inject('GET', '/api/v1/session', { headers: s.headers() });
    expect(res.status).toBe(401);
    await second.app.close();
  });

  it('UT-GW-027 CLI 토큰으로 브라우저 라우트 → 403 GW-ACL-001, 쿠키로 CLI 라우트 → 403, 둘 다 없음 → 401 GW-AUTH-007 [NFR-SEC-019][FR-SET-015]', async () => {
    const r = await rig();
    const s = await r.login();
    const viaCli = await r.inject('GET', '/api/v1/session', { headers: cliHeaders() });
    expect(viaCli.status).toBe(403);
    expect(problem(viaCli.body).code).toBe('GW-ACL-001');
    const viaCookie = await r.inject('GET', '/api/v1/cli/status', { headers: s.headers() });
    expect(viaCookie.status).toBe(403);
    expect(problem(viaCookie.body).code).toBe('GW-ACL-001');
    const none = await r.inject('GET', '/api/v1/cli/status');
    expect(none.status).toBe(401);
    expect(problem(none.body).code).toBe('GW-AUTH-007');
    const wrong = await r.inject('GET', '/api/v1/cli/status', {
      headers: { authorization: `Bearer ${'d'.repeat(43)}` },
    });
    expect(problem(wrong.body).code).toBe('GW-AUTH-007');
  });

  it('UT-GW-101 유효 CLI 토큰으로 /api/v1/cli/* 밖(GET /api/v1/session·/api/v1/stream) → 403 GW-ACL-001 [FR-SET-015][NFR-SEC-019]', async () => {
    const r = await rig();
    for (const url of ['/api/v1/session', '/api/v1/stream']) {
      const res = await r.inject('GET', url, { headers: cliHeaders() });
      expect(res.status, url).toBe(403);
      expect(problem(res.body).code, url).toBe('GW-ACL-001');
    }
  });
});

describe('rate limit', () => {
  it('UT-GW-100 같은 세션 300회 200 → 301번째 429 GW-LIMIT-001 + retry-after ≥ 1 + retry_after_ms, 창 경과 후 200, 다른 세션·CLI 독립 [NFR-SEC-017][STD-SEC-28]', async () => {
    // Arrange
    const r = await rig();
    const a = await r.login(); // login()이 이 세션으로 GET /session/csrf를 1번 썼다
    const other = await r.login();
    for (let i = 0; i < 299; i += 1) {
      expect((await r.inject('GET', '/api/v1/session', { headers: a.headers() })).status).toBe(200);
    }
    // Act
    const over = await r.inject('GET', '/api/v1/session', { headers: a.headers() });
    // Assert
    expect(over.status).toBe(429);
    const p = problem(over.body);
    expect(p.code).toBe('GW-LIMIT-001');
    expect(p.retry_after_ms).toBeGreaterThan(0);
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect((await r.inject('GET', '/api/v1/session', { headers: other.headers() })).status).toBe(200);
    expect((await r.inject('GET', '/api/v1/cli/status', { headers: cliHeaders() })).status).toBe(200);
    r.clock.advance(60_000);
    expect((await r.inject('GET', '/api/v1/session', { headers: a.headers() })).status).toBe(200);
  });
});
