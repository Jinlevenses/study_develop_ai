import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cspFor } from '../../src/config.js';
import type { Rig } from '../unit/support.js';
import { HOST, makeRig } from '../unit/support.js';
import { cleanup, request, startServer } from './support.js';

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

async function listen(r: Rig): Promise<number> {
  await r.app.fastify.listen({ host: '127.0.0.1', port: 0 });
  return (r.app.fastify.server.address() as AddressInfo).port;
}

describe('정적 · CSP (실 소켓)', () => {
  it('IT-101 정적 index·해시 자산 캐시 헤더, CSP가 정적·/api/v1/session/csrf·problem 응답 모두에 동일, /api/** no-store [NFR-PORT-006][CR-61]', async () => {
    // Arrange
    const web = mkdtempSync(path.join(tmpdir(), 'gw-it-web-'));
    dirs.push(web);
    mkdirSync(path.join(web, 'assets'));
    writeFileSync(path.join(web, 'index.html'), '<html>fathom</html>');
    writeFileSync(path.join(web, 'assets', 'index-Zx81QaBc.js'), 'export {};');
    const r = await makeRig({ webRoot: web });
    rigs.push(r);
    const session = await r.login();
    const port = await listen(r);
    const host = { host: HOST }; // gateway는 listenPort 4747을 기대한다 — 실 소켓은 Host만 맞춘다
    const csp = cspFor('test', 4747);
    // Act
    const index = await request(port, 'GET', '/', { headers: host });
    const asset = await request(port, 'GET', '/assets/index-Zx81QaBc.js', { headers: host });
    const csrf = await request(port, 'GET', '/api/v1/session/csrf', { headers: { ...host, ...session.headers() } });
    const problem = await request(port, 'GET', '/api/v1/nope', { headers: host });
    // Assert
    expect(index.status).toBe(200);
    expect(index.body).toBe('<html>fathom</html>');
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    for (const res of [index, asset, csrf, problem]) {
      expect(res.headers['content-security-policy']).toBe(csp);
    }
    expect(csrf.status).toBe(200);
    expect(csrf.headers['cache-control']).toBe('no-store');
    expect(problem.status).toBe(404);
    expect(problem.headers['cache-control']).toBe('no-store');
    expect(String(problem.headers['content-type'])).toContain('application/problem+json');
  });
});

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

describe('dev 단일 origin (Vite 프록시)', () => {
  it('IT-102 dev: /src/main.tsx?x=1 경로·쿼리 그대로 중계, /api는 업스트림 미도달, Host가 틀린 업그레이드는 421로 업스트림 upgrade 미도달, 옳은 업그레이드는 도달해 101 수신 [AP-12][NFR-PORT-006]', async () => {
    // Arrange: 업스트림 = 테스트 node:http 서버(수동 WebSocket 핸드셰이크)
    const seen: string[] = [];
    let upgraded: string | null = null;
    const upstreamSockets: Duplex[] = [];
    const { server, port: upstream } = await startServer((req, res) => {
      seen.push(req.url ?? '');
      res.setHeader('content-type', 'text/javascript');
      res.end('export const vite = true;');
    });
    server.on('upgrade', (req, socket) => {
      upgraded = req.url ?? '';
      upstreamSockets.push(socket);
      const key = String(req.headers['sec-websocket-key']);
      const accept = createHash('sha1')
        .update(key + GUID)
        .digest('base64');
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.on('error', () => undefined);
    });
    const r = await makeRig({ profile: 'dev', proxy: true, viteOrigin: `http://127.0.0.1:${upstream}` });
    rigs.push(r);
    const port = await listen(r);
    const host = { host: HOST };
    // Act: HTTP 중계
    const js = await request(port, 'GET', '/src/main.tsx?x=1', { headers: host });
    const api = await request(port, 'GET', '/api/v1/session', { headers: host });
    const evil = await request(port, 'GET', '/src/main.tsx', { headers: { host: 'evil.test:4747' } });
    // Assert
    expect(js.status).toBe(200);
    expect(js.body).toBe('export const vite = true;');
    expect(seen).toEqual(['/src/main.tsx?x=1']);
    expect(api.status).toBe(401); // gateway 자체 인증 — 업스트림 미도달
    expect(seen).toHaveLength(1);
    expect(evil.status).toBe(421);
    expect(js.headers['content-security-policy']).toBe(cspFor('dev', 4747));
    // Act: 업그레이드(HMR WebSocket) — Host가 틀린 요청(preHandler 421)과 옳은 요청
    const key = Buffer.from('0123456789abcdef').toString('base64');
    const upgradeHead = (hostHeader: string): string =>
      `GET /?token=abc HTTP/1.1\r\nhost: ${hostHeader}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: ${key}\r\nsec-websocket-protocol: vite-hmr\r\n\r\n`;
    // 원시 소켓으로 보낸다 — 421은 비-업그레이드 응답 직후 소켓이 닫혀 http.request는 'socket hang up'을 낼 수 있다
    const upgrade = (hostHeader: string): Promise<number> =>
      new Promise<number>((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(upgradeHead(hostHeader)));
        let head = '';
        socket.on('data', (c: Buffer) => {
          head += c.toString('latin1');
          const line = /^HTTP\/1\.1 (\d{3}) /.exec(head);
          if (line !== null) {
            socket.destroy();
            resolve(Number(line[1]));
          }
        });
        socket.on('error', reject);
      });
    const evilUpgrade = await upgrade('evil.test:4747');
    expect(evilUpgrade).toBe(421); // 업그레이드도 fastify 라우팅(preHandler)을 지난다 — 업스트림에는 닿지 않는다
    expect(upgraded).toBeNull();
    const status = await upgrade(HOST);
    expect(status).toBe(101);
    await vi.waitFor(() => expect(upgraded).toBe('/?token=abc'));
    for (const socket of upstreamSockets) {
      socket.destroy(); // 프록시가 연결을 정리해 fastify.close가 끝나게 한다
    }
  });
});
