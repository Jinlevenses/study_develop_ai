import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Problem } from '@fathom/contracts/common/problem';
import { afterEach, describe, expect, it } from 'vitest';
import { cspFor } from '../../src/config.js';
import { bootGateway, cleanup, envelope, forkGateway, withHome, writeCliToken } from '../integration/support.js';
import type { Rig } from '../unit/support.js';
import { CLI_TOKEN, makeRig, nextKey, ORIGIN, PORT } from '../unit/support.js';

const rigs: Rig[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  expect(await cleanup()).toBe(0);
});

async function rig(o: Parameters<typeof makeRig>[0] = {}): Promise<Rig> {
  const r = await makeRig(o);
  rigs.push(r);
  return r;
}
function webRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gw-sec-web-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'index.html'), '<html>sec</html>');
  return dir;
}
const code = (body: string): string => Problem.parse(JSON.parse(body)).code;
const cli = { authorization: `Bearer ${CLI_TOKEN}` };

describe('gateway 보안', () => {
  it('SEC-GW-002 DNS rebinding: Host: evil.test:<port>로 정적 /·GET /session·교환·SSE·CLI → 전부 421 GW-AUTH-005(쿠키·토큰이 유효해도) [NFR-SEC-002]', async () => {
    // Arrange: 유효한 쿠키·부트스트랩 토큰·CLI 토큰을 모두 갖춘다
    const r = await rig({ webRoot: webRoot() });
    const s = await r.login();
    const issued = await r.inject('POST', '/api/v1/cli/bootstrap-token', {
      headers: { ...cli, 'idempotency-key': nextKey() },
      body: { purpose: 'open' },
    });
    const bt = (issued.json() as { bootstrap_token: string }).bootstrap_token;
    const evil = { host: `evil.test:${PORT}` };
    // Act / Assert
    const probes: [string, string, Record<string, string>, unknown?][] = [
      ['GET', '/', evil],
      ['GET', '/api/v1/session', { ...evil, ...s.headers() }],
      ['POST', '/api/v1/session/exchange', { ...evil, origin: ORIGIN }, { bt }],
      ['GET', '/api/v1/stream', { ...evil, ...s.headers() }],
      ['GET', '/api/v1/cli/status', { ...evil, ...cli }],
      ['POST', '/api/v1/session/logout', { ...evil, ...s.mutate() }],
    ];
    for (const [method, url, headers, body] of probes) {
      const res = await r.inject(method, url, { withHost: false, headers, ...(body === undefined ? {} : { body }) });
      expect(res.status, `${method} ${url}`).toBe(421);
      expect(code(res.body), `${method} ${url}`).toBe('GW-AUTH-005');
    }
    // 부트스트랩 토큰은 소비되지 않았다 — 올바른 Host로는 교환된다
    expect(
      (await r.inject('POST', '/api/v1/session/exchange', { headers: { origin: ORIGIN }, body: { bt } })).status,
    ).toBe(200);
  });

  it('SEC-GW-003 부트스트랩 fragment: 발급·교환 전 과정의 로그 줄에 토큰·쿠키·CSRF 문자열 0, 재사용 401, 60s 경과 401 [NFR-SEC-019]', async () => {
    // Arrange
    const r = await rig();
    const issue = async (): Promise<string> => {
      const res = await r.inject('POST', '/api/v1/cli/bootstrap-token', {
        headers: { ...cli, 'idempotency-key': nextKey() },
        body: { purpose: 'open' },
      });
      return (res.json() as { bootstrap_token: string }).bootstrap_token;
    };
    const bt = await issue();
    // Act: 교환 → 쿠키 → CSRF → 로그아웃
    const exchanged = await r.inject('POST', '/api/v1/session/exchange', { headers: { origin: ORIGIN }, body: { bt } });
    const cookie = /fathom_sid=([^;]+)/.exec(String(exchanged.headers['set-cookie']))?.[1] ?? '';
    const headers = { cookie: `fathom_sid=${cookie}` };
    const csrf = ((await r.inject('GET', '/api/v1/session/csrf', { headers })).json() as { csrf: string }).csrf;
    await r.inject('POST', '/api/v1/session/logout', {
      headers: { ...headers, origin: ORIGIN, 'x-fathom-csrf': csrf, 'idempotency-key': nextKey() },
    });
    // 실패 경로도 로그를 남긴다
    const reused = await r.inject('POST', '/api/v1/session/exchange', { headers: { origin: ORIGIN }, body: { bt } });
    const stale = await issue();
    r.clock.advance(60_000);
    const expired = await r.inject('POST', '/api/v1/session/exchange', {
      headers: { origin: ORIGIN },
      body: { bt: stale },
    });
    // Assert
    expect(reused.status).toBe(401);
    expect(expired.status).toBe(401);
    const sid = cookie.split('.')[1] ?? '';
    const mac = cookie.split('.')[4] ?? '';
    const logs = r.logs.join('');
    for (const secret of [bt, stale, cookie, sid, mac, csrf, CLI_TOKEN]) {
      expect(logs.includes(secret), secret.slice(0, 8)).toBe(false);
    }
    expect(r.logs.length).toBeGreaterThan(0);
  });

  it('SEC-GW-004 ops 피어가 경로·SQL·스택을 담은 Error를 던짐 → cli/status 500 GW-INTERNAL-900, 본문에 스택·경로·SQL 0, error_id = error 로그 줄 값 [NFR-SEC-012]', async () => {
    // Arrange
    const r = await rig({
      handlers: {
        'ops.health.board': () => {
          throw new Error('failed at /home/u/x.ts: SELECT * FROM t\n    at run (/home/u/x.ts:1:1)');
        },
      },
    });
    // Act
    const res = await r.inject('GET', '/api/v1/cli/status', { headers: cli });
    // Assert
    expect(res.status).toBe(500);
    const problem = Problem.parse(JSON.parse(res.body));
    expect(problem.code).toBe('GW-INTERNAL-900');
    for (const leak of ['    at ', '/home/', 'SELECT ']) {
      expect(res.body.includes(leak), leak).toBe(false);
    }
    const errorLine = r.logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.level === 'error' && l.error_id === problem.error_id);
    expect(errorLine).toBeDefined();
  });

  it('SEC-GW-009 CSP 헤더가 정적·API·problem 응답에서 D-STD-24 문자열과 정확히 일치, prod 정적 HTML의 script-src에 unsafe-inline 0 [CR-61]', async () => {
    // Arrange
    const r = await rig({ webRoot: webRoot(), profile: 'prod' });
    const s = await r.login();
    const d_std_24 =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
    // Act
    const responses = [
      await r.inject('GET', '/'),
      await r.inject('GET', '/some/spa/route'),
      await r.inject('GET', '/api/v1/session', { headers: s.headers() }),
      await r.inject('GET', '/api/v1/session'), // 401 problem
      await r.inject('GET', '/api/v1/nope'), // 404 problem
    ];
    // Assert
    for (const res of responses) {
      expect(res.headers['content-security-policy']).toBe(d_std_24);
    }
    const scriptSrc = /script-src ([^;]+)/.exec(String(responses[0]?.headers['content-security-policy']))?.[1] ?? '';
    expect(scriptSrc).toBe("'self'");
    expect(cspFor('prod', 1)).toBe(d_std_24);
  });
});

describe('gateway 바인딩 (실 프로세스)', () => {
  it('SEC-GW-005a 봉투 listen.host 0.0.0.0 → fatal{78, listen_host_forbidden} + exit 78 [NFR-SEC-001]', async () => {
    await withHome(async (home) => {
      const svc = forkGateway(home.path);
      svc.child.send({ ...envelope(home.path), listen: { host: '0.0.0.0', port: 4747 } });
      expect(await svc.waitFor('fatal')).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: 'listen_host_forbidden' });
      expect(await svc.exit).toBe(78);
    });
  }, 60_000);

  it.runIf(process.platform === 'linux')(
    'SEC-GW-005b Linux: 기동 중 /proc/net/tcp(+tcp6)의 LISTEN 행 중 gateway 포트의 로컬 주소 = 127.0.0.1만 [NFR-SEC-001]',
    async () => {
      await withHome(async (home) => {
        // Arrange
        writeCliToken(home.path);
        const { svc, port } = await bootGateway(home.path);
        // Act
        const rows: string[] = [];
        for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
          try {
            rows.push(...readFileSync(table, 'utf8').split('\n').slice(1));
          } catch {
            // tcp6가 없는 커널
          }
        }
        const hex = port.toString(16).toUpperCase().padStart(4, '0');
        const listening = rows
          .map((l) => l.trim().split(/\s+/))
          .filter((c) => c[3] === '0A' && (c[1] ?? '').endsWith(`:${hex}`))
          .map((c) => c[1]?.split(':')[0]);
        // Assert
        expect(listening.length).toBeGreaterThan(0);
        expect(new Set(listening)).toEqual(new Set(['0100007F'])); // 127.0.0.1(리틀 엔디언)
        svc.child.send({ type: 'shutdown', v: 1, grace_ms: 300 });
        expect(await svc.exit).toBe(0);
      });
    },
    60_000,
  );
});
