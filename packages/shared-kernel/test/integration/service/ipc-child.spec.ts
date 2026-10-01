import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { envelope, SELF_TOKEN } from '../../unit/service/support-boot.js';
import { forkService, runMode, withHome } from './harness.js';

function get(port: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: url }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      })
      .on('error', reject);
  });
}

describe('serve 모드 자식 프로세스 (실제 IPC)', () => {
  it('UT-SK-007 봉투 listen.host 0.0.0.0 → fatal{78, listen_host_forbidden} + exit 78, 토큰은 출력에 없다 [NFR-SEC-001]', async () => {
    await withHome(async (home) => {
      // Arrange
      const svc = forkService([], { FATHOM_HOME: home.path });
      // Act
      svc.child.send({ ...envelope({ home: home.path }), listen: { host: '0.0.0.0', port: 4762 } });
      const fatal = await svc.waitFor('fatal');
      // Assert
      expect(fatal).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: 'listen_host_forbidden' });
      expect(await svc.exit).toBe(78);
      expect(svc.stdout() + svc.stderr()).not.toContain(SELF_TOKEN);
    });
  }, 30_000);

  it('UT-SK-007 FATHOM_DEPLOY=container → 78 container_mode_unsupported [NFR-SEC-001]', async () => {
    await withHome(async (home) => {
      const svc = forkService([], { FATHOM_HOME: home.path, FATHOM_DEPLOY: 'container' });
      svc.child.send(envelope({ home: home.path }));
      expect(await svc.waitFor('fatal')).toMatchObject({ exit_code: 78, code: 'container_mode_unsupported' });
      expect(await svc.exit).toBe(78);
    });
  }, 30_000);

  it('UT-SK-007 정상 기동: 127.0.0.1 바인딩·listening → ready·실제 소켓 응답·IPC shutdown → exit 0 [NFR-SEC-001][FR-SET-002]', async () => {
    await withHome(async (home) => {
      // Arrange
      expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home.path })).code).toBe(0);
      const svc = forkService([], { FATHOM_HOME: home.path });
      // Act
      svc.child.send(envelope({ home: home.path }));
      const listening = await svc.waitFor('listening');
      const ready = await svc.waitFor('ready');
      // Assert
      expect(svc.messages.map((m) => (m as { type: string }).type)).toEqual(['listening', 'ready']);
      expect(ready.schema_versions).toEqual({ 'content.db': { _infra: 3, fixture: 1 }, 'derived.db': { _infra: 1 } });
      const health = await get(listening.port as number, '/healthz');
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toMatchObject({ ok: true, svc: 'content' });
      svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      expect(await svc.exit).toBe(0);
      expect(svc.stdout() + svc.stderr()).not.toContain(SELF_TOKEN);
      // 한 줄 JSON 로그(필수 필드)
      const logLines = svc
        .stdout()
        .split('\n')
        .filter((l) => l.startsWith('{'));
      expect(logLines.length).toBeGreaterThan(0);
      for (const l of logLines) {
        expect(JSON.parse(l)).toMatchObject({
          svc: 'content',
          level: expect.any(String),
          ts: expect.any(Number),
          msg: expect.any(String),
        });
      }
    });
  }, 30_000);
});
