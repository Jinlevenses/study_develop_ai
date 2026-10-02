import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Problem } from '@fathom/contracts/common/problem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cspFor } from '../../src/config.js';
import { cachePolicy } from '../../src/infra/static/cache-policy.js';
import type { Rig } from './support.js';
import { HOST, makeRig, OPS_AUTH } from './support.js';

const rigs: Rig[] = [];
const dirs: string[] = [];
let web = '';
const INDEX = '<!doctype html><html><body>fathom-index</body></html>';

beforeEach(() => {
  web = mkdtempSync(path.join(tmpdir(), 'gw-web-'));
  dirs.push(web);
  mkdirSync(path.join(web, 'assets'));
  writeFileSync(path.join(web, 'index.html'), INDEX);
  writeFileSync(path.join(web, 'sw.js'), 'self.skipWaiting();');
  writeFileSync(path.join(web, 'manifest.webmanifest'), '{}');
  writeFileSync(path.join(web, 'assets', 'app-AbCdEf12.js'), 'console.log(1);');
  writeFileSync(path.join(web, 'assets', 'plain.js'), 'console.log(2);');
});
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});
async function rig(o: Parameters<typeof makeRig>[0] = {}): Promise<Rig> {
  const r = await makeRig({ webRoot: web, ...o });
  rigs.push(r);
  return r;
}
async function listen(r: Rig): Promise<number> {
  await r.app.fastify.listen({ host: '127.0.0.1', port: 0 });
  return (r.app.fastify.server.address() as AddressInfo).port;
}
function rawGet(port: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: url, headers: { host: HOST } }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}
const code = (body: string): string => Problem.parse(JSON.parse(body)).code;

describe('정적 파일 · SPA 폴백', () => {
  it('UT-GW-150 해시 자산 immutable·JS content-type, index.html·sw.js·manifest no-cache, SPA 폴백 200, 없는 자산 404, /api 404는 problem [AP-12][NFR-PORT-006]', async () => {
    // Arrange
    const r = await rig();
    // Act
    const asset = await r.inject('GET', '/assets/app-AbCdEf12.js');
    const plain = await r.inject('GET', '/assets/plain.js');
    const index = await r.inject('GET', '/');
    const sw = await r.inject('GET', '/sw.js');
    const manifest = await r.inject('GET', '/manifest.webmanifest');
    const spa = await r.inject('GET', '/concepts/x');
    const missing = await r.inject('GET', '/assets/missing.js');
    const api = await r.inject('GET', '/api/v1/nope');
    // Assert
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(String(asset.headers['content-type'])).toMatch(/javascript/);
    expect(plain.headers['cache-control']).toBe('no-cache');
    for (const res of [index, sw, manifest]) {
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
    }
    expect(index.body).toBe(INDEX);
    expect(spa.status).toBe(200);
    expect(spa.body).toBe(INDEX);
    expect(spa.headers['cache-control']).toBe('no-cache');
    expect(missing.status).toBe(404);
    expect(code(missing.body)).toBe('GW-NOTFOUND-900');
    expect(api.status).toBe(404);
    expect(code(api.body)).toBe('GW-NOTFOUND-900');
    expect(api.body).not.toContain('fathom-index');
    expect(cachePolicy('assets/app-AbCdEf12.woff2')).toBe('public, max-age=31536000, immutable');
    expect(cachePolicy('assets/app.js')).toBe('no-cache');
  });

  it('UT-GW-152 경로 조작(%2e%2e·%2f·NUL·잘못된 %) → 404, 응답 본문에 루트 밖 파일 내용 0 [STD-SEC-03][NFR-PORT-006]', async () => {
    // Arrange: 루트 밖 형제 파일
    const secret = path.join(path.dirname(web), `${path.basename(web)}-secret.txt`);
    writeFileSync(secret, 'TOP-SECRET-CONTENT');
    dirs.push(secret);
    const r = await rig();
    // Act / Assert
    for (const url of [
      '/..%2f..%2fetc%2fpasswd',
      `/..%2f${path.basename(secret)}`,
      '/a%00b',
      '/%E0%A4%A',
      '/%',
      '/.git/config',
    ]) {
      const res = await r.inject('GET', url);
      // 잘못된 `%` 시퀀스는 Fastify 라우터가 핸들러 전에 400으로 거른다(Brief는 404 — deviations[]). 어느 쪽이든 파일 접근은 없다.
      const malformed = url.startsWith('/%') && !url.startsWith('/%2');
      expect(res.status, url).toBe(malformed ? 400 : 404);
      if (!malformed) {
        expect(code(res.body), url).toBe('GW-NOTFOUND-900');
      }
      expect(res.body, url).not.toContain('TOP-SECRET-CONTENT');
      expect(res.body, url).not.toContain('root:');
    }
    // light-my-request는 `%2e%2e` 점 세그먼트를 URL 파서로 접어 버린다 — 원문 경로는 실 소켓으로 보낸다.
    const port = await listen(r);
    for (const url of [
      '/%2e%2e/x',
      '/assets/%2e%2e/%2e%2e/index.html',
      `/%2e%2e/${path.basename(secret)}`,
      '/%2E%2E%2f%2E%2E%2fetc%2fpasswd',
    ]) {
      const res = await rawGet(port, url);
      expect(res.status, url).toBe(404);
      expect(res.body, url).not.toContain('TOP-SECRET-CONTENT');
    }
  });

  it('UT-GW-153 정적 Host: evil.test → 421, CSP prod/test 정확 일치·nosniff·no-referrer, /internal/* 응답에는 CSP 없음 [NFR-SEC-002][CR-61]', async () => {
    const r = await rig();
    const evil = await r.inject('GET', '/', { headers: { host: 'evil.test:4747' } });
    expect(evil.status).toBe(421);
    expect(code(evil.body)).toBe('GW-AUTH-005');
    const ok = await r.inject('GET', '/');
    expect(ok.headers['content-security-policy']).toBe(cspFor('test', 4747));
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['referrer-policy']).toBe('no-referrer');
    expect(evil.headers['content-security-policy']).toBe(cspFor('test', 4747)); // problem 응답에도 적용
    const internal = await r.inject('GET', '/internal/v1/activity', { headers: OPS_AUTH });
    expect(internal.status).toBe(200);
    expect(internal.headers['content-security-policy']).toBeUndefined();
  });

  it('UT-GW-154 profileOverride dev → script-src unsafe-inline·connect-src ws://127.0.0.1:4747 [NFR-SEC-002][CR-61]', async () => {
    const r = await rig({ profile: 'dev' });
    const res = await r.inject('GET', '/');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws://127.0.0.1:4747");
    expect(csp).toBe(cspFor('dev', 4747));
    const prod = await (await rig({ profile: 'prod' })).inject('GET', '/');
    expect(String(prod.headers['content-security-policy'])).not.toContain("unsafe-inline'; style");
    expect(String(prod.headers['content-security-policy'])).toContain("script-src 'self';");
  });

  it('UT-GW-155 webRoot = 빈 디렉터리 → 기동 warn 1줄(gateway.static.web_root_missing)·SPA 경로 404·/api/v1/session 정상 [AP-12][NFR-PORT-006]', async () => {
    // Arrange
    const empty = mkdtempSync(path.join(tmpdir(), 'gw-empty-'));
    dirs.push(empty);
    // Act
    const r = await rig({ webRoot: empty });
    // Assert
    expect(r.logs.filter((l) => l.includes('gateway.static.web_root_missing'))).toHaveLength(1);
    expect((await r.inject('GET', '/concepts/x')).status).toBe(404);
    expect((await r.inject('GET', '/')).status).toBe(404);
    const session = await r.inject('GET', '/api/v1/session');
    expect(session.status).toBe(401);
    expect(code(session.body)).toBe('GW-AUTH-003');
  });

  it('UT-GW-157 HEAD / → 200 본문 0, POST / → 404, webRoot null → 정적 라우트 없음 [AP-12][FR-SET-001]', async () => {
    const r = await rig();
    const head = await r.inject('HEAD', '/');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    const post = await r.inject('POST', '/', { body: {} });
    expect(post.status).toBe(404);
    const none = await rig({ webRoot: null });
    expect((await none.inject('GET', '/')).status).toBe(404);
    expect(HOST).toBe('127.0.0.1:4747');
  });

  it('UT-GW-114 /%61pi/v1/nope·/%69nternal/x → SPA index가 아니라 404 GW-NOTFOUND-900 [AP-12][NFR-SEC-019]', async () => {
    const r = await rig();
    for (const url of ['/%61pi/v1/nope', '/%69nternal/v1/x']) {
      const res = await r.inject('GET', url);
      expect(res.status, url).toBe(404);
      expect(code(res.body), url).toBe('GW-NOTFOUND-900');
      expect(res.body, url).not.toContain('fathom-index');
    }
  });
});
