import { once } from 'node:events';
import { closeSync, existsSync, openSync, writeSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Readyz } from '@fathom/contracts/admin/admin-routes';
import { InboxDeliverRoute } from '@fathom/contracts/events/inbox';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../src/errors/errors.js';
import { createService } from '../../../src/service/boot.js';
import type { ServiceDefinition, ServiceDeps, ServiceRunResult } from '../../../src/service/types.js';
import { openDb } from '../../../src/sqlite/sqlite.js';
import { envelope, fakePort, lines } from '../../unit/service/support-boot.js';
import { EXEC_ARGV, FULL, fixtureDef } from './fixtures/def.js';
import { withHome } from './harness.js';

type Booted = { fp: ReturnType<typeof fakePort>; result: ServiceRunResult; chunks: string[] };
const running: { shutdown(g: number): Promise<void> }[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  for (const s of running.splice(0)) {
    await s.shutdown(0).catch(() => undefined);
  }
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

async function migrateHome(def: ServiceDefinition<null>, home: string): Promise<void> {
  const fp = fakePort({ argv: ['--mode=migrate'], hasIpc: false, env: { FATHOM_HOME: home } });
  const result = await createService(def, { process: fp.port, logDestination: { write: () => undefined } });
  expect(result).toEqual({ kind: 'exited', code: 0 });
}

async function boot(
  def: ServiceDefinition<null>,
  home: string,
  over: Parameters<typeof envelope>[0] = {},
  env: Parameters<typeof fakePort>[0] = {},
): Promise<Booted> {
  const fp = fakePort(env);
  const chunks: string[] = [];
  const pending = createService(def, {
    process: fp.port,
    logDestination: { write: (c: string) => void chunks.push(c) },
    jobExecArgv: EXEC_ARGV,
  });
  fp.deliver(envelope({ home, ...over }));
  const result = await pending;
  if (result.kind === 'serving') {
    running.push(result.service);
  }
  return { fp, result, chunks };
}

const fatalCode = (b: Booted): unknown =>
  b.fp.sent.find((m) => typeof m === 'object' && m !== null && 'type' in m && m.type === 'fatal');
const dbFile = (home: string): string => path.join(home, 'data', 'content.db');

async function freePort(): Promise<number> {
  const s = http.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}
async function occupy(): Promise<number> {
  const s = http.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  servers.push(s);
  return (s.address() as AddressInfo).port;
}

describe('serve 기동 검사', () => {
  it('UT-SK-186 DB 없음 → 78 needs_migrate, application_id·스키마 불일치 → 78 [FR-SET-007][NFR-SEC-001][FR-SET-002]', async () => {
    await withHome(async (home) => {
      // Arrange / Act: DB 없음
      const none = await boot(fixtureDef(), home.path);
      // Assert
      expect(none.result).toEqual({ kind: 'exited', code: 78 });
      expect(fatalCode(none)).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: 'needs_migrate' });
      expect(none.fp.exits).toEqual([78]);
      // application_id 불일치: 다른 id로 migrate한 파일
      await migrateHome(fixtureDef({ databases: [{ ...FULL, applicationId: 1_999_999 }] }), home.path);
      const alien = await boot(fixtureDef({ databases: [FULL] }), home.path);
      expect(fatalCode(alien)).toMatchObject({ exit_code: 78, code: 'application_id_mismatch' });
    });
    await withHome(async (home) => {
      // 스키마: 행 삭제(뒤처짐)·sha 변조·모르는 행(다운그레이드)
      await migrateHome(fixtureDef({ databases: [FULL] }), home.path);
      const tamper = (sql: string): void => {
        const db = openDb(dbFile(home.path), { synchronous: 'NORMAL' });
        db.exec(sql);
        db.close();
      };
      tamper("DELETE FROM schema_migrations WHERE module = 'fixture'");
      expect(fatalCode(await boot(fixtureDef({ databases: [FULL] }), home.path))).toMatchObject({
        code: 'schema_needs_migrate',
      });
      tamper(
        "INSERT INTO schema_migrations(module, version, name, sha256, applied_at) VALUES ('fixture', 1, 'fixture_items', '" +
          'e'.repeat(64) +
          "', 0)",
      );
      expect(fatalCode(await boot(fixtureDef({ databases: [FULL] }), home.path))).toMatchObject({
        code: 'schema_sha_mismatch',
      });
      tamper(
        "DELETE FROM schema_migrations WHERE module = 'fixture'; INSERT INTO schema_migrations(module, version, name, sha256, applied_at) VALUES ('zzz', 1, 'unknown', '" +
          'e'.repeat(64) +
          "', 0)",
      );
      expect(fatalCode(await boot(fixtureDef({ databases: [FULL] }), home.path))).toMatchObject({
        code: 'schema_downgrade',
      });
    });
  });

  it('UT-SK-188 정책 로드 실패 → 78 policy_<reason> [FR-SET-007][NFR-SEC-001]', async () => {
    await withHome(async (home) => {
      // Arrange
      await migrateHome(fixtureDef(), home.path);
      const def = fixtureDef({
        loadPolicies: () => err({ reason: 'hash_mismatch', exitCode: 78, ref: 'fsrs_params@v1', detail: 'x' }),
      });
      // Act
      const b = await boot(def, home.path);
      // Assert
      expect(b.result).toEqual({ kind: 'exited', code: 78 });
      expect(fatalCode(b)).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: 'policy_hash_mismatch' });
    });
  });

  it('UT-SK-186 register가 던지면 70 register_failed [FR-SET-007]', async () => {
    await withHome(async (home) => {
      await migrateHome(fixtureDef(), home.path);
      const b = await boot(
        fixtureDef({
          register: () => {
            throw new Error('route table broken');
          },
        }),
        home.path,
      );
      expect(b.result).toEqual({ kind: 'exited', code: 70 });
      expect(fatalCode(b)).toMatchObject({ exit_code: 70, code: 'register_failed' });
      expect(lines(b.chunks).some((l) => l.event === 'service.register.failed' && l.level === 'error')).toBe(true);
    });
  });
});

describe('serve 기동 성공', () => {
  it('UT-SK-189 listening → ready 순서·schema_versions 파일 키·127.0.0.1 바인딩 [FR-SET-007][NFR-SEC-001][FR-SET-002]', async () => {
    await withHome(async (home) => {
      // Arrange
      await migrateHome(fixtureDef(), home.path);
      // Act
      const b = await boot(fixtureDef(), home.path);
      // Assert
      expect(b.result.kind).toBe('serving');
      if (b.result.kind !== 'serving') {
        return;
      }
      const { service } = b.result;
      const address = service.app.fastify.server.address();
      expect(address).toMatchObject({ address: '127.0.0.1', port: service.port });
      expect(b.fp.sent).toEqual([
        { type: 'listening', v: 1, port: service.port },
        {
          type: 'ready',
          v: 1,
          contracts_hash: 'c'.repeat(64),
          schema_versions: { 'content.db': { _infra: 3, fixture: 1 }, 'derived.db': { _infra: 1 } },
          app_version: '0.1.0',
        },
      ]);
      const health = await service.app.fastify.inject({ method: 'GET', url: '/healthz' });
      expect(JSON.parse(health.body)).toMatchObject({ ok: true, svc: 'content', version: '0.1.0' });
      expect(
        Readyz.parse(JSON.parse((await service.app.fastify.inject({ method: 'GET', url: '/readyz' })).body)).ready,
      ).toBe(true);
      // 실제 소켓으로도 응답한다
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: service.port, path: '/healthz' }, (res) => {
            let text = '';
            res.on('data', (c: Buffer) => {
              text += c.toString('utf8');
            });
            res.on('end', () => resolve(text));
          })
          .on('error', reject);
      });
      expect(JSON.parse(body).ok).toBe(true);
    });
  });

  it('UT-SK-189 registry.updated로 피어 URL이 교체되고 log.level이 반영되며 잘못된 IPC 메시지는 warn 후 무시된다 [FR-SET-007][FR-SET-002]', async () => {
    await withHome(async (home) => {
      // Arrange: 두 피어 서버, 첫 URL은 A
      const hits: string[] = [];
      const peerServer = async (name: string): Promise<string> => {
        const s = http.createServer((_req, res) => {
          hits.push(name);
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"acked_through_seq":0}');
        });
        s.listen(0, '127.0.0.1');
        await once(s, 'listening');
        servers.push(s);
        return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
      };
      const urlA = await peerServer('A');
      const urlB = await peerServer('B');
      await migrateHome(fixtureDef(), home.path);
      let captured: ServiceDeps<null> | null = null;
      const def = fixtureDef({
        peers: ['learning'],
        register: (_app, deps) => {
          captured = deps;
        },
      });
      const peers = (u: string): NonNullable<NonNullable<Parameters<typeof envelope>[0]>['peers']> => ({
        gateway: { url: u },
        content: { url: u },
        learning: { url: u },
        'ai-gateway': { url: u },
        'ops-api': { url: u },
      });
      const b = await boot(def, home.path, { peers: peers(urlA) });
      expect(b.result.kind).toBe('serving');
      const deps = captured as ServiceDeps<null> | null;
      expect(deps).not.toBeNull();
      const call = (): Promise<unknown> =>
        deps?.peers.learning?.call(InboxDeliverRoute, {
          body: {
            producer: 'content',
            events: [
              {
                event_id: fixedUlid(1),
                type: 'a.b.c',
                schema_version: 1,
                producer: 'content',
                producer_seq: 1,
                occurred_at: 1,
                correlation_id: fixedUlid(2),
                causation_id: null,
                traceparent: null,
                payload: {},
              },
            ],
          },
        }) ?? Promise.reject(new Error('no peer'));
      // Act
      await call();
      b.fp.deliver({ type: 'registry.updated', v: 1, peers: peers(urlB) });
      await call();
      b.fp.deliver({ type: 'log.level', v: 1, level: 'debug' });
      b.fp.deliver({ type: 'registry.updated', v: 1, peers: 'nope' });
      // Assert
      expect(hits).toEqual(['A', 'B']);
      expect(deps?.log.level).toBe('debug');
      expect(lines(b.chunks).some((l) => l.event === 'ipc.invalid' && l.level === 'warn')).toBe(true);
    });
  });

  it('UT-SK-190 선호 포트 점유 → 폴백 → 0, listening.port = 실제 포트(127.0.0.1) [NFR-SEC-001][FR-SET-002]', async () => {
    await withHome(async (home) => {
      // Arrange
      await migrateHome(fixtureDef(), home.path);
      const p1 = await occupy();
      const p2 = await occupy();
      // Act: 폴백도 막혀 있으면 0
      const b = await boot(fixtureDef({ portFallbacks: [p2] }), home.path, { listen: { host: '127.0.0.1', port: p1 } });
      // Assert
      expect(b.result.kind).toBe('serving');
      if (b.result.kind !== 'serving') {
        return;
      }
      expect([p1, p2]).not.toContain(b.result.service.port);
      expect(b.fp.sent[0]).toEqual({ type: 'listening', v: 1, port: b.result.service.port });
      // 폴백이 비어 있으면 폴백을 쓴다
      await b.result.service.shutdown(0);
      const free = await freePort();
      const c = await boot(fixtureDef({ portFallbacks: [free] }), home.path, {
        listen: { host: '127.0.0.1', port: p1 },
      });
      expect(c.result.kind === 'serving' && c.result.service.port).toBe(free);
    });
  });

  it('UT-SK-185 IPC shutdown → 종료 절차(exit 0)·supervisor 연결 끊김 → 유예 0으로 exit 0 [IF-COM-008][NFR-AVL-003]', async () => {
    await withHome(async (home) => {
      // Arrange
      await migrateHome(fixtureDef(), home.path);
      const viaIpc = await boot(fixtureDef(), home.path);
      const viaDisconnect = await boot(fixtureDef(), home.path);
      // Act
      viaIpc.fp.deliver({ type: 'shutdown', v: 1, grace_ms: 50 });
      viaDisconnect.fp.disconnect();
      // Assert
      await expect.poll(() => viaIpc.fp.exits).toEqual([0]);
      await expect.poll(() => viaDisconnect.fp.exits).toEqual([0]);
      // 같은 서비스에 두 번째 종료 요청이 와도 exit는 한 번
      viaIpc.fp.deliver({ type: 'shutdown', v: 1, grace_ms: 0 });
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(viaIpc.fp.exits).toEqual([0]);
    });
  });
});

describe('크래시 뒤 기동(after_crash)', () => {
  const crashed = { flags: { safe_mode: false, batch_enabled: false, after_crash: true } };

  it('UT-SK-187 정상 DB: ready 직후 integrity pending → 전체 검사 후 ok [FR-SET-007][NFR-SEC-001]', async () => {
    await withHome(async (home) => {
      // Arrange
      await migrateHome(fixtureDef(), home.path);
      // Act
      const b = await boot(fixtureDef(), home.path, crashed);
      // Assert
      expect(b.result.kind).toBe('serving');
      if (b.result.kind !== 'serving') {
        return;
      }
      const { service } = b.result;
      const readyz = async (): Promise<ReturnType<typeof Readyz.parse>> =>
        Readyz.parse(JSON.parse((await service.app.fastify.inject({ method: 'GET', url: '/readyz' })).body));
      expect((await readyz()).ready).toBe(true);
      await expect.poll(async () => (await readyz()).checks.integrity, { timeout: 30_000 }).toBe('ok');
    });
  }, 60_000);

  it('UT-SK-187 손상 DB: quick_check 실패 → failed + reason, ready는 유지 [FR-SET-007][NFR-SEC-001]', async () => {
    await withHome(async (home) => {
      // Arrange: fx_item 루트 페이지를 0으로 덮어 손상시킨다
      await migrateHome(fixtureDef(), home.path);
      const live = openDb(dbFile(home.path), { synchronous: 'NORMAL' });
      const root = Number(live.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'fx_item'").get()?.rootpage);
      const pageSize = Number(live.prepare('PRAGMA page_size').get()?.page_size);
      live.close();
      const fd = openSync(dbFile(home.path), 'r+');
      writeSync(fd, Buffer.alloc(pageSize, 0), 0, pageSize, (root - 1) * pageSize);
      closeSync(fd);
      // Act
      const b = await boot(fixtureDef(), home.path, crashed);
      // Assert
      expect(b.result.kind).toBe('serving');
      if (b.result.kind !== 'serving') {
        return;
      }
      const res = await b.result.service.app.fastify.inject({ method: 'GET', url: '/readyz' });
      const body = Readyz.parse(JSON.parse(res.body));
      expect(res.statusCode).toBe(200);
      expect(body).toMatchObject({ ready: true, checks: { integrity: 'failed' } });
      expect(body.reasons).toEqual(['integrity_failed:content.db']);
      expect(existsSync(dbFile(home.path))).toBe(true);
    });
  }, 60_000);
});
