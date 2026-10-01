import type { IncomingHttpHeaders, Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isUlid, ulid } from '@fathom/shared-kernel/ids/ids';
import type { SafeSpawnResult } from '@fathom/shared-kernel/proc/proc';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserDeps } from '../../src/lib/browser-open.js';
import { openBrowser } from '../../src/lib/browser-open.js';
import { createGatewayClient, pickOpenUrl, readCliToken } from '../../src/lib/gateway-client.js';
import { run } from '../../src/run.js';
import { createFakeEnv, HOME, OPEN_URL, SENTINEL, stderrText, TOKEN, TOKEN_PATH } from './fakes.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

type Seen = { method: string; url: string; headers: IncomingHttpHeaders; body: string };
async function serve(
  handler: (seen: Seen) => { status: number; type?: string; body?: string; delayMs?: number },
): Promise<{ port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      body += c;
    });
    req.on('end', () => {
      const entry = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      seen.push(entry);
      const r = handler(entry);
      const send = (): void => {
        res.writeHead(r.status, { 'content-type': r.type ?? 'application/json' });
        res.end(r.body ?? '');
      };
      if (r.delayMs === undefined) {
        send();
      } else {
        setTimeout(send, r.delayMs);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return { port: (server.address() as AddressInfo).port, seen };
}

const PROBLEM = {
  type: 'urn:fathom:problem:gw-auth-007',
  title: 'CLI 인증에 실패했습니다',
  status: 401,
  code: 'GW-AUTH-007',
  error_id: ulid(),
  request_id: ulid(),
  retryable: false,
};

describe('gateway-client (로컬 node:http 서버)', () => {
  it('UT-CLI-029 헤더 5종·idempotency-key ULID = 본문 op_id [IR-014][NFR-SEC-019]', async () => {
    const { port, seen } = await serve(() => ({ status: 202, body: '{"accepted":true}' }));
    const client = createGatewayClient({ port, token: TOKEN, appVersion: '1.2.3' });
    const key = ulid();
    const res = await client.post('/api/v1/cli/shutdown', { op_id: key, grace_ms: 3000 }, key);
    expect(res).toEqual({ ok: true, value: { status: 202, body: { accepted: true }, problem: null } });
    const h = seen[0]?.headers ?? {};
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/v1/cli/shutdown' });
    expect(h.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.accept).toBe('application/json');
    expect(h['x-fathom-client']).toBe('cli/1.2.3');
    expect(h['content-type']).toBe('application/json; charset=utf-8');
    expect(isUlid(h['idempotency-key'])).toBe(true);
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({ op_id: h['idempotency-key'], grace_ms: 3000 });
    await client.get('/api/v1/cli/status');
    expect(seen[1]?.headers['idempotency-key']).toBeUndefined();
    expect(seen[1]?.headers['content-type']).toBeUndefined();
  });

  it('UT-CLI-030 problem+json → 코드·title·error_id 매핑, 형식 위반 → protocol, 연결 거부 → connect [IR-014]', async () => {
    const { port } = await serve(() => ({
      status: 401,
      type: 'application/problem+json',
      body: JSON.stringify(PROBLEM),
    }));
    const res = await createGatewayClient({ port, token: TOKEN, appVersion: '1.2.3' }).get('/x');
    expect(res).toEqual({
      ok: true,
      value: {
        status: 401,
        body: null,
        problem: { code: 'GW-AUTH-007', title: PROBLEM.title, error_id: PROBLEM.error_id },
      },
    });

    const bad = await serve(() => ({ status: 500, type: 'application/problem+json', body: '{"nope":1}' }));
    expect(await createGatewayClient({ port: bad.port, token: TOKEN, appVersion: '1' }).get('/x')).toEqual({
      ok: false,
      error: { kind: 'protocol' },
    });
    const junk = await serve(() => ({ status: 200, body: '{not json' }));
    expect(await createGatewayClient({ port: junk.port, token: TOKEN, appVersion: '1' }).get('/x')).toEqual({
      ok: false,
      error: { kind: 'protocol' },
    });
    const plain404 = await serve(() => ({ status: 404, body: '{}' }));
    expect(await createGatewayClient({ port: plain404.port, token: TOKEN, appVersion: '1' }).get('/x')).toEqual({
      ok: true,
      value: { status: 404, body: null, problem: null },
    });

    const closed = await serve(() => ({ status: 200 }));
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));
    expect(await createGatewayClient({ port: closed.port, token: TOKEN, appVersion: '1' }).get('/x')).toEqual({
      ok: false,
      error: { kind: 'connect' },
    });
  });

  it('UT-CLI-031 응답이 timeout을 넘으면 timeout, pickOpenUrl 가드(형식 위반 → protocol) [IR-014]', async () => {
    const slow = await serve(() => ({ status: 200, body: '{}', delayMs: 400 }));
    const res = await createGatewayClient({ port: slow.port, token: TOKEN, appVersion: '1', timeoutMs: 80 }).get('/x');
    expect(res).toEqual({ ok: false, error: { kind: 'timeout' } });
    expect(pickOpenUrl({ open_url: OPEN_URL })).toEqual({ ok: true, value: OPEN_URL });
    for (const body of [
      {},
      null,
      'x',
      { open_url: 5 },
      { open_url: `http://127.0.0.1:4747/#bt=${'a'.repeat(42)}` },
      { open_url: `http://example.com:4747/#bt=${SENTINEL}` },
      { open_url: `https://127.0.0.1:4747/#bt=${SENTINEL}` },
      { open_url: `http://127.0.0.1:4747/x#bt=${SENTINEL}` },
      { open_url: `http://127.0.0.1:4747/#bt=${SENTINEL}extra` },
    ]) {
      expect(pickOpenUrl(body), JSON.stringify(body)).toEqual({ ok: false, error: { kind: 'protocol' } });
    }
  });

  it('UT-CLI-032 토큰 파일 없음·형식 오류 → 4 CLI-AUTH-001 [IR-014][NFR-SEC-019]', async () => {
    const f = createFakeEnv();
    expect(await readCliToken(HOME, f.deps)).toEqual({ ok: false, error: { code: 'CLI-AUTH-001' } });
    f.files.set(TOKEN_PATH, 'short');
    expect(await readCliToken(HOME, f.deps)).toMatchObject({ ok: false });
    f.files.set(TOKEN_PATH, `${TOKEN}\n`);
    expect(await readCliToken(HOME, f.deps)).toEqual({ ok: true, value: TOKEN });
    const g = createFakeEnv();
    g.files.set(
      '/data/fathom/run/supervisor.lock',
      JSON.stringify({
        pid: 4242,
        boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        version: '1.2.3',
        started_at: 1,
        profile: 'test',
      }),
    );
    g.alive.add(4242);
    g.files.set('/data/fathom/run/registry.json', JSON.stringify({}));
    expect(await run(['status', '--profile=test'], g.deps)).toBe(4);
    expect(stderrText(g)).toContain('CLI-AUTH-001');
  });
});

const ENV: Record<string, string | undefined> = { PATH: '/usr/local/bin:/usr/bin', SYSTEMROOT: 'C:\\Windows' };

function browserDeps(
  over: Partial<BrowserDeps> & {
    calls?: { bin: string; args: readonly string[] }[];
    result?: Partial<SafeSpawnResult>;
  } = {},
): BrowserDeps & { calls: { bin: string; args: readonly string[] }[] } {
  const calls = over.calls ?? [];
  return {
    env: (n) => ENV[n],
    platform: 'linux',
    isExecutable: (file) => Promise.resolve(file === '/usr/bin/xdg-open'),
    home: HOME,
    safeSpawn(bin, args, opts) {
      calls.push({ bin, args });
      expect(opts.timeoutMs).toBe(10_000);
      expect(opts.cwd).toBe(HOME);
      expect(Object.keys(opts.env)).not.toContain('NODE_OPTIONS');
      return Promise.resolve({
        pid: 1,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderrTail: '',
        timedOut: false,
        outputOverflow: false,
        spawnError: null,
        ...over.result,
      });
    },
    ...over,
    calls,
  };
}

describe('browser-open (주입 safeSpawn)', () => {
  it('UT-CLI-033 darwin → /usr/bin/open, win32 → rundll32.exe + url.dll,FileProtocolHandler [IF-EXT-15][FR-SET-023]', async () => {
    const mac = browserDeps({ platform: 'darwin' });
    expect(await openBrowser(OPEN_URL, mac)).toBe(true);
    expect(mac.calls).toEqual([{ bin: '/usr/bin/open', args: [OPEN_URL] }]);
    const win = browserDeps({ platform: 'win32' });
    expect(await openBrowser(OPEN_URL, win)).toBe(true);
    expect(win.calls).toEqual([
      { bin: 'C:\\Windows\\System32\\rundll32.exe', args: ['url.dll,FileProtocolHandler', OPEN_URL] },
    ]);
  });

  it('UT-CLI-034 linux는 PATH에서 첫 실행 가능 xdg-open을 찾고 없으면 실패 [IF-EXT-15][FR-SET-023]', async () => {
    const found = browserDeps({
      isExecutable: (f) => Promise.resolve(f === '/usr/bin/xdg-open' || f === '/usr/local/bin/xdg-open'),
    });
    expect(await openBrowser(OPEN_URL, found)).toBe(true);
    expect(found.calls[0]?.bin).toBe('/usr/local/bin/xdg-open'); // PATH 순서상 첫 번째
    const none = browserDeps({ isExecutable: () => Promise.resolve(false) });
    expect(await openBrowser(OPEN_URL, none)).toBe(false);
    expect(none.calls).toEqual([]);
    const relative = browserDeps({ env: () => 'relative/bin:.', isExecutable: () => Promise.resolve(true) });
    expect(await openBrowser(OPEN_URL, relative)).toBe(false); // 상대 PATH 항목은 무시
  });

  it('UT-CLI-035 exit ≠ 0·spawnError·timedOut → 실패, 명령 수준에서는 1 + 안내(URL 출력 0) [IF-EXT-15][FR-SET-023]', async () => {
    expect(await openBrowser(OPEN_URL, browserDeps({ result: { exitCode: 3 } }))).toBe(false);
    expect(await openBrowser(OPEN_URL, browserDeps({ result: { spawnError: 'ENOENT', exitCode: null } }))).toBe(false);
    expect(await openBrowser(OPEN_URL, browserDeps({ result: { timedOut: true, exitCode: null } }))).toBe(false);
    const f = createFakeEnv();
    f.browserOk = false;
    f.files.set(TOKEN_PATH, TOKEN);
    f.files.set(
      '/data/fathom/run/supervisor.lock',
      JSON.stringify({
        pid: 4242,
        boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        version: '1.2.3',
        started_at: 1,
        profile: 'test',
      }),
    );
    f.alive.add(4242);
    f.files.set(
      '/data/fathom/run/registry.json',
      JSON.stringify({
        v: 1,
        boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        profile: 'test',
        app_version: '1.2.3',
        supervisor_pid: 4242,
        state: 'ready',
        updated_at: 1,
        notices: [],
        services: {
          gateway: {
            pid: 1,
            port: 4747,
            state: 'ready',
            started_at: 1,
            restarts: 0,
            last_exit_code: null,
            reason: null,
          },
        },
      }),
    );
    f.routes.set('POST /api/v1/cli/bootstrap-token', {
      ok: true,
      value: { status: 201, body: { open_url: OPEN_URL }, problem: null },
    });
    expect(await run(['open', '--profile=test'], f.deps)).toBe(1);
    expect(stderrText(f)).toContain('브라우저를 열지 못했습니다');
    expect(stderrText(f)).toContain('fathom open');
    expect(stderrText(f)).not.toContain(SENTINEL);
  });
});
