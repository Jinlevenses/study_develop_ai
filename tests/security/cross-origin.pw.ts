import type { Server } from 'node:http';
import { createServer, request } from 'node:http';
import type { Stack } from '@fathom/testkit/spawn-stack';
import { launchStack } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { expect, test } from '@playwright/test';
import { isAlive, openApp } from '../support/direct-stack.js';

// SEC-GW-001 — 다른 포트의 악성 페이지가 gateway를 호출해도 세션이 새지 않는다(NFR-SEC-002·019).
// [Brief 결정, CR 후보 ②] 같은 IP의 다른 포트는 브라우저 기준 same-site라 SameSite만으로는 쿠키가 실린다.
// 방어선은 IF-01 §2.11 ② Origin·Sec-Fetch-Site(403 GW-AUTH-006)·CSRF·Host(421)이므로 아래 ①~⑥으로 판정한다.
// 이 테스트는 브라우저가 필요해 Playwright로 실행된다(`pnpm test:e2e`, `pnpm test:security`가 아님).

test.describe.configure({ mode: 'serial' });

const state: {
  stack: Stack | null;
  cleanup: (() => Promise<void>) | null;
  pids: number[];
  evil: Server | null;
} = { stack: null, cleanup: null, pids: [], evil: null };

test.beforeAll(async () => {
  const home = await createTempHome('fathom-sec001-');
  state.cleanup = () => home.cleanup();
  state.stack = await launchStack({ runtime: 'dist', home: home.path });
  const registry = await state.stack.registry();
  state.pids = [
    state.stack.supervisorPid,
    ...Object.values(registry.services).flatMap((s) => (s?.pid === null || s === undefined ? [] : [s.pid])),
  ];
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (state.evil === null) {
      resolve();
      return;
    }
    state.evil.closeAllConnections();
    state.evil.close(() => resolve());
  });
  await state.stack?.stop();
  for (const pid of state.pids) {
    expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
  }
  await state.cleanup?.();
});

function evilPage(gateway: string): string {
  const script = `
(async () => {
  const r = {};
  try {
    const res = await fetch(${JSON.stringify(`${gateway}/api/v1/session/csrf`)}, { credentials: 'include' });
    r.csrf = 'read:' + res.status;
  } catch (e) { r.csrf = 'blocked'; }
  try {
    await fetch(${JSON.stringify(`${gateway}/api/v1/session/logout`)}, { method: 'POST', mode: 'no-cors', credentials: 'include' });
    r.logout = 'sent';
  } catch (e) { r.logout = 'error'; }
  r.cookie = document.cookie;
  window.__result = r;
})();`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>evil</title></head><body><script>${script}</script></body></html>`;
}

function rawRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; code: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        text += c;
      });
      res.on('end', () => {
        let code = '';
        try {
          const body: unknown = JSON.parse(text);
          code =
            typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
              ? body.code
              : '';
        } catch {
          code = '';
        }
        resolve({ status: res.statusCode ?? 0, code });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('SEC-GW-001 다른 포트의 악성 페이지가 세션·CSRF를 얻지 못하고 상태 변경은 403, Host 위조는 421이다 @offline [NFR-SEC-002][NFR-SEC-019]', async ({
  page,
  context,
}) => {
  const stack = state.stack;
  if (stack === null) {
    throw new Error('stack not started');
  }
  const gateway = stack.gatewayUrl;
  const logoutResponses: { status: number; code: string }[] = [];
  context.on('response', (response) => {
    const req = response.request();
    if (req.method() === 'POST' && new URL(response.url()).pathname === '/api/v1/session/logout') {
      void response
        .json()
        .then((body: unknown) => {
          const code = typeof body === 'object' && body !== null && 'code' in body ? String(body.code) : '';
          logoutResponses.push({ status: response.status(), code });
        })
        .catch(() => {
          logoutResponses.push({ status: response.status(), code: '' });
        });
    }
  });

  await openApp(page, stack);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(evilPage(gateway));
  });
  state.evil = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const evilPort = typeof address === 'object' && address !== null ? address.port : 0;

  const evil = await context.newPage();
  await evil.goto(`http://127.0.0.1:${String(evilPort)}/`);
  await evil.waitForFunction(() => Reflect.get(window, '__result') !== undefined);
  const result: unknown = await evil.evaluate(() => Reflect.get(window, '__result'));

  await test.step('① 악성 페이지는 CSRF 응답을 읽지 못한다(CORS)', () => {
    expect(result).toMatchObject({ csrf: 'blocked' });
  });
  await test.step('② no-cors POST 상태 변경은 403 GW-AUTH-006', async () => {
    await expect.poll(() => logoutResponses.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    // 브라우저는 no-cors 응답 본문을 읽을 수 없으므로 상태(403)만 관측하고, 같은 헤더의 재현 요청으로 code를 확인한다.
    expect(logoutResponses[0]?.status).toBe(403);
    const replay = await rawRequest(Number(new URL(gateway).port), 'POST', '/api/v1/session/logout', {
      origin: `http://127.0.0.1:${String(evilPort)}`,
      'sec-fetch-site': 'same-site',
      'content-type': 'application/json',
    });
    expect(replay).toEqual({ status: 403, code: 'GW-AUTH-006' });
  });
  await test.step('③ 악성 페이지 document.cookie에 fathom_sid 없음', () => {
    expect(result).toMatchObject({ cookie: expect.not.stringContaining('fathom_sid') });
  });
  await test.step('④ 정상 페이지 세션은 그대로(대조군)', async () => {
    const status = await page.evaluate(() => fetch('/api/v1/session').then((r) => r.status));
    expect(status).toBe(200);
  });
  await test.step('⑤ Host 위조는 421 GW-AUTH-005', async () => {
    const port = Number(new URL(gateway).port);
    expect(await rawRequest(port, 'GET', '/api/v1/session', { host: `evil.test:${String(port)}` })).toEqual({
      status: 421,
      code: 'GW-AUTH-005',
    });
  });
  await test.step('⑥ 쿠키 속성', async () => {
    const cookie = (await context.cookies()).find((c) => c.name === 'fathom_sid');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/');
  });
});
