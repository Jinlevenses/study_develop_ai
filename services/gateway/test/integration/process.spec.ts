import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Problem } from '@fathom/contracts/common/problem';
import { CliStatus } from '@fathom/contracts/http/gateway/v1/cli';
import { SessionStatus } from '@fathom/contracts/http/gateway/v1/session';
import { ActivityView } from '@fathom/contracts/http/gateway/v1/internal';
import { Operation } from '@fathom/contracts/http/ops/v1/operations';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { healthBoard, operation } from '../unit/support.js';
import type { SseConn } from '../unit/sse.js';
import { openSse } from '../unit/sse.js';
import {
  bootGateway,
  cleanup,
  CLI_TOKEN,
  freePort,
  login,
  nextKey,
  occupyPort,
  OPS_AUTH,
  request,
  SELF_TOKEN,
  startServer,
  withHome,
  writeCliToken,
} from './support.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
  expect(await cleanup()).toBe(0);
});

const shutdownMsg = { type: 'shutdown', v: 1, grace_ms: 1000 };
const cli = { authorization: `Bearer ${CLI_TOKEN}` };

describe('gateway 실 프로세스', () => {
  it('IT-103 봉투 → listening → ready{contracts_hash: 봉투 값}, /healthz·/readyz 200 [FR-SET-001][NFR-SEC-001]', async () => {
    await withHome(async (home) => {
      // Arrange
      const web = mkdtempSync(path.join(tmpdir(), 'gw-it-web-'));
      dirs.push(web);
      writeFileSync(path.join(web, 'index.html'), '<html>it</html>');
      // Act
      const { svc, port, ready } = await bootGateway(home.path, {}, [`--fx-web-root=${web}`]);
      // Assert
      expect(svc.messages.map((m) => (m as { type: string }).type)).toEqual(['listening', 'ready']);
      expect(ready).toEqual({ type: 'ready', v: 1, contracts_hash: 'c'.repeat(64), schema_versions: {}, app_version: '0.1.0' });
      expect((await request(port, 'GET', '/healthz')).status).toBe(200);
      expect((await request(port, 'GET', '/readyz')).status).toBe(200);
      expect((await request(port, 'GET', '/')).body).toBe('<html>it</html>');
      svc.child.send(shutdownMsg);
      expect(await svc.exit).toBe(0);
      expect(svc.stdout() + svc.stderr()).not.toContain(SELF_TOKEN);
    });
  }, 60_000);

  it('IT-104 E0-3 흐름: cli.token → bootstrap-token 201 → #bt= 추출 → 교환 200 + 쿠키 → csrf → session 200 → 로그아웃 204 [NFR-SEC-019][FR-SET-023][UC-36]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const { svc, port } = await bootGateway(home.path);
      const origin = `http://127.0.0.1:${port}`;
      // Act
      const issued = await request(port, 'POST', '/api/v1/cli/bootstrap-token', {
        headers: { ...cli, 'idempotency-key': nextKey() },
        body: { purpose: 'up' },
      });
      expect(issued.status).toBe(201);
      const openUrl = (issued.json() as { open_url: string }).open_url;
      expect(openUrl.startsWith(`http://127.0.0.1:${port}/#bt=`)).toBe(true);
      const bt = openUrl.split('#bt=')[1] ?? '';
      const exchanged = await request(port, 'POST', '/api/v1/session/exchange', { headers: { origin }, body: { bt } });
      // Assert
      expect(exchanged.status).toBe(200);
      const cookie = /fathom_sid=([^;]+)/.exec(String(exchanged.headers['set-cookie']))?.[1] ?? '';
      expect(cookie).toMatch(new RegExp(`^v1\\.[A-Za-z0-9_-]{22}\\.${port}\\.\\d+\\.[A-Za-z0-9_-]{43}$`));
      const headers = { cookie: `fathom_sid=${cookie}` };
      const csrf = await request(port, 'GET', '/api/v1/session/csrf', { headers });
      expect(csrf.status).toBe(200);
      const status = await request(port, 'GET', '/api/v1/session', { headers });
      expect(SessionStatus.parse(status.json())).toMatchObject({ authenticated: true, port, profile: 'test' });
      const out = await request(port, 'POST', '/api/v1/session/logout', {
        headers: { ...headers, origin, 'x-fathom-csrf': (csrf.json() as { csrf: string }).csrf, 'idempotency-key': nextKey() },
      });
      expect(out.status).toBe(204);
      // 재사용된 토큰은 401
      const reuse = await request(port, 'POST', '/api/v1/session/exchange', { headers: { origin }, body: { bt } });
      expect(reuse.status).toBe(401);
      svc.child.send(shutdownMsg);
      expect(await svc.exit).toBe(0);
    });
  }, 60_000);

  it('IT-105 같은 HOME(session.key 공유) gateway 2개: A 쿠키를 B에 → 401 GW-AUTH-001, B에 Origin A POST → 403 GW-AUTH-006 [NFR-SEC-019][NFR-SEC-002]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const a = await bootGateway(home.path);
      const b = await bootGateway(home.path, { boot_id: fixedUlid(8) });
      expect(a.port).not.toBe(b.port);
      const session = await login(a.port);
      // Act
      const crossPort = await request(b.port, 'GET', '/api/v1/session', { headers: session.headers() });
      const crossOrigin = await request(b.port, 'POST', '/api/v1/session/logout', {
        headers: { ...session.headers(), origin: `http://127.0.0.1:${a.port}`, 'x-fathom-csrf': session.csrf, 'idempotency-key': nextKey() },
      });
      // Assert
      expect(crossPort.status).toBe(401);
      expect(Problem.parse(crossPort.json()).code).toBe('GW-AUTH-001');
      expect(crossOrigin.status).toBe(403);
      expect(Problem.parse(crossOrigin.json()).code).toBe('GW-AUTH-006');
      expect((await request(a.port, 'GET', '/api/v1/session', { headers: session.headers() })).status).toBe(200);
      for (const s of [a.svc, b.svc]) {
        s.child.send(shutdownMsg);
        expect(await s.exit).toBe(0);
      }
    });
  }, 60_000);

  it('IT-106 (a) 점유된 봉투 포트 → OS 포트로 listen, 교환 응답·쿠키 포트 = 실제 포트 (b) dev 점유 → 4848~4856 폴백(getter가 register 뒤 값) [FR-SET-001][AQ-08]', async (ctx) => {
    await withHome(async (home) => {
      // Arrange (a)
      writeCliToken(home.path);
      const busy = await occupyPort();
      const a = await bootGateway(home.path, { listen: { host: '127.0.0.1', port: busy } });
      // Assert (a)
      expect(a.port).not.toBe(busy);
      const session = await login(a.port);
      expect(session.cookie.split('.')[2]).toBe(String(a.port));
      expect(SessionStatus.parse((await request(a.port, 'GET', '/api/v1/session', { headers: session.headers() })).json()).port).toBe(a.port);
      a.svc.child.send(shutdownMsg);
      expect(await a.svc.exit).toBe(0);
      // Arrange (b): dev — 폴백 후보 9개가 모두 점유돼 있으면 건너뛴다
      const b = await bootGateway(home.path, { profile: 'dev', listen: { host: '127.0.0.1', port: busy } });
      if (b.port < 4848 || b.port > 4856) {
        b.svc.child.send(shutdownMsg);
        await b.svc.exit;
        ctx.skip(`dev 폴백 포트 4848~4856이 모두 점유돼 있다(실제 ${b.port})`);
        return;
      }
      expect(b.port).toBeGreaterThanOrEqual(4848);
      expect(b.port).toBeLessThanOrEqual(4856);
      b.svc.child.send(shutdownMsg);
      expect(await b.svc.exit).toBe(0);
    });
  }, 90_000);

  it('IT-108 IPC shutdown{grace_ms:1000} → 열린 SSE 종료·exit 0, IPC 끊김(disconnect) → exit 0, 잔존 소켓 0 [FR-SET-001][NFR-AVL-003]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const first = await bootGateway(home.path);
      const session = await login(first.port);
      const sse = await openSse(first.port, { host: `127.0.0.1:${first.port}`, ...session.headers() });
      expect(sse.kind).toBe('stream');
      if (sse.kind !== 'stream') {
        return;
      }
      await sse.conn.waitFor('event: hello');
      // Act
      first.svc.child.send(shutdownMsg);
      // Assert
      await sse.conn.closed();
      expect(await first.svc.exit).toBe(0);
      // IPC 끊김
      const second = await bootGateway(home.path, { boot_id: fixedUlid(9) });
      second.svc.child.disconnect();
      expect(await second.svc.exited).toBe(0);
    });
  }, 60_000);

  it('IT-109 재기동 후 같은 HOME·같은 포트 → 기존 쿠키로 GET /session 200(재인증 0), session.key 0600·32바이트 불변 [FR-SET-023][NFR-SEC-019]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const port = await freePort();
      const first = await bootGateway(home.path, { listen: { host: '127.0.0.1', port } });
      expect(first.port).toBe(port);
      const session = await login(port);
      const file = path.join(home.path, 'run', 'session.key');
      const before = readFileSync(file);
      first.svc.child.send(shutdownMsg);
      expect(await first.svc.exit).toBe(0);
      // Act
      const second = await bootGateway(home.path, { boot_id: fixedUlid(8), listen: { host: '127.0.0.1', port } });
      // Assert
      expect(second.port).toBe(port);
      expect((await request(port, 'GET', '/api/v1/session', { headers: session.headers() })).status).toBe(200);
      expect(readFileSync(file).equals(before)).toBe(true);
      expect(statSync(file).size).toBe(32);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      second.svc.child.send(shutdownMsg);
      expect(await second.svc.exit).toBe(0);
    });
  }, 60_000);

  it('IT-110 가짜 ops-api: cli/status 200 CliStatus, cli/shutdown 202 + 하위 요청 idempotency-key = op_id (self_token 확인) [FR-SET-015][IF-GW-180][IF-GW-181]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const calls: { method: string; url: string; auth: string; key: string | undefined; body: string }[] = [];
      const ops = await startServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        req.on('end', () => {
          calls.push({
            method: req.method ?? '',
            url: req.url ?? '',
            auth: String(req.headers.authorization),
            key: req.headers['idempotency-key'] as string | undefined,
            body,
          });
          res.setHeader('content-type', 'application/json');
          if (req.url === '/internal/v1/health-board') {
            res.end(JSON.stringify(healthBoard()));
            return;
          }
          res.statusCode = 202;
          res.end(JSON.stringify(operation((JSON.parse(body) as { op_id: string }).op_id)));
        });
      });
      const { svc, port } = await bootGateway(home.path, {
        peers: { gateway: { url: 'http://127.0.0.1:1' }, content: { url: 'http://127.0.0.1:2' }, learning: { url: 'http://127.0.0.1:3' }, 'ai-gateway': { url: 'http://127.0.0.1:4' }, 'ops-api': { url: `http://127.0.0.1:${ops.port}` } },
      });
      const opId = fixedUlid(444);
      // Act
      const status = await request(port, 'GET', '/api/v1/cli/status', { headers: cli });
      const stop = await request(port, 'POST', '/api/v1/cli/shutdown', {
        headers: { ...cli, 'idempotency-key': opId },
        body: { op_id: opId, grace_ms: 300 },
      });
      // Assert
      expect(status.status).toBe(200);
      expect(CliStatus.parse(status.json()).url).toBe(`http://127.0.0.1:${port}/`);
      expect(stop.status).toBe(202);
      expect(Operation.parse(stop.json()).op_id).toBe(opId);
      expect(stop.headers.location).toBe(`/api/v1/cli/operations/${opId}`);
      expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
        'GET /internal/v1/health-board',
        'POST /internal/v1/system:shutdown',
      ]);
      expect(calls.every((c) => c.auth === `Bearer ${SELF_TOKEN}`)).toBe(true);
      expect(calls[1]?.key).toBe(opId);
      expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ op_id: opId, grace_ms: 300 });
      svc.child.send(shutdownMsg);
      expect(await svc.exit).toBe(0);
    });
  }, 60_000);

  it('IT-111 ops-api 미기동 → cli/status 503 GW-DEP-001 + retry-after: 1, ≤ 2,000ms [FR-SET-015][IF-GW-180][IF-GW-181]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const closed = await freePort();
      const { svc, port } = await bootGateway(home.path, {
        peers: { gateway: { url: 'http://127.0.0.1:1' }, content: { url: 'http://127.0.0.1:2' }, learning: { url: 'http://127.0.0.1:3' }, 'ai-gateway': { url: 'http://127.0.0.1:4' }, 'ops-api': { url: `http://127.0.0.1:${closed}` } },
      });
      // Act
      const started = Date.now();
      const res = await request(port, 'GET', '/api/v1/cli/status', { headers: cli });
      const elapsed = Date.now() - started;
      // Assert
      expect(res.status).toBe(503);
      expect(Problem.parse(res.json())).toMatchObject({ code: 'GW-DEP-001', dependency: 'ops-api' });
      expect(res.headers['retry-after']).toBe('1');
      expect(elapsed).toBeLessThanOrEqual(2000);
      svc.child.send(shutdownMsg);
      expect(await svc.exit).toBe(0);
    });
  }, 60_000);

  it('IT-112 /internal/v1/activity 실 HTTP(ops-api 토큰) 200 · IT-113 기동·요청·종료 동안 stderr 0줄(ExperimentalWarning 포함) [FR-AI-010][NFR-PORT-002]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const { svc, port } = await bootGateway(home.path);
      const session = await login(port);
      // Act
      await request(port, 'GET', '/api/v1/session', { headers: session.headers() });
      const res = await request(port, 'GET', '/internal/v1/activity', { headers: OPS_AUTH });
      const sse = await openSse(port, { host: `127.0.0.1:${port}`, ...session.headers() });
      const withStream = await request(port, 'GET', '/internal/v1/activity', { headers: OPS_AUTH });
      if (sse.kind === 'stream') {
        (sse.conn as SseConn).close();
      }
      svc.child.send(shutdownMsg);
      // Assert
      expect(res.status).toBe(200);
      const view = ActivityView.parse(res.json());
      expect(view.last_user_activity_at).not.toBeNull();
      expect(ActivityView.parse(withStream.json()).active_streams).toBe(1);
      expect(await svc.exit).toBe(0);
      expect(svc.stderr()).toBe('');
    });
  }, 60_000);
});

