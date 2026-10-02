import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IntegrityResult, SnapshotResult } from '@fathom/contracts/admin/admin-routes';
import { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import { ROUTING } from '@fathom/contracts/events/routing.gen';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { contentManifest } from '../../../src/infra/events/inbox.js';
import {
  contentDbPath,
  envelope,
  forkContent,
  httpRequest,
  type IpcChild,
  jsonLines,
  killAlive,
  LEARNING_TOKEN,
  OPS_TOKEN,
  openWritable,
  queryRows,
  runMode,
  SELF_TOKEN,
  withHome,
} from './support.js';

afterEach(() => {
  killAlive();
});

const opsHeaders = (key?: string): Record<string, string> => ({
  authorization: `Bearer ${OPS_TOKEN}`,
  ...(key === undefined ? {} : { 'idempotency-key': key }),
});

async function migrate(home: string): Promise<void> {
  expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home })).code).toBe(0);
}

/** 마이그레이션 → serve 기동(`listening`·`ready`까지). */
async function serve(home: string): Promise<{ svc: IpcChild; port: number; ready: Record<string, unknown> }> {
  await migrate(home);
  const svc = forkContent({ FATHOM_HOME: home });
  svc.child.send(envelope(home));
  const listening = await svc.waitFor('listening');
  const ready = await svc.waitFor('ready');
  return { svc, port: Number(listening.port), ready };
}

describe('content serve 기동 검사', () => {
  it('IT-214 DB 없음 → fatal needs_migrate + exit 78, 적용 파일 변조(sha256) → serve exit 78 schema_sha_mismatch [DB-01 §11.3][E0-4]', async () => {
    await withHome(async (home) => {
      // Arrange / Act: DB 없음
      const none = forkContent({ FATHOM_HOME: home.path });
      none.child.send(envelope(home.path));
      // Assert
      expect(await none.waitFor('fatal')).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: 'needs_migrate' });
      expect(await none.exit).toBe(78);
      // Arrange: 마이그레이션 후 한 행의 sha256 변조
      await migrate(home.path);
      const db = await openWritable(contentDbPath(home.path));
      db.prepare("UPDATE schema_migrations SET sha256 = :s WHERE module = 'catalog' AND version = 2").run({
        s: 'f'.repeat(64),
      });
      db.close();
      // Act
      const tampered = forkContent({ FATHOM_HOME: home.path });
      tampered.child.send(envelope(home.path));
      // Assert
      expect(await tampered.waitFor('fatal')).toEqual({
        type: 'fatal',
        v: 1,
        exit_code: 78,
        code: 'schema_sha_mismatch',
      });
      expect(await tampered.exit).toBe(78);
    });
  }, 60_000);

  it('IT-219 serve 기동: listening → ready(schema_versions) → healthz·readyz 200 → IPC shutdown exit 0 [NFR-MAINT-001][IF-COM-001][IF-COM-002]', async () => {
    await withHome(async (home) => {
      // Arrange / Act
      const { svc, port, ready } = await serve(home.path);
      // Assert
      expect(svc.messages.map((m) => (m as { type: string }).type)).toEqual(['listening', 'ready']);
      expect(ready).toEqual({
        type: 'ready',
        v: 1,
        contracts_hash: 'c'.repeat(64),
        schema_versions: {
          'content.db': { _infra: 3, catalog: 2, acquisition: 1, itembank: 1, grading: 1, runner: 1 },
        },
        app_version: '0.1.0',
      });
      const health = await httpRequest(port, 'GET', '/healthz');
      expect(health.status).toBe(200);
      expect(JSON.parse(health.body)).toMatchObject({ ok: true, svc: 'content', version: '0.1.0' });
      const readyz = await httpRequest(port, 'GET', '/readyz');
      expect(readyz.status).toBe(200);
      // Act: IPC shutdown
      svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      // Assert
      expect(await svc.exit).toBe(0);
      expect(svc.stdout() + svc.stderr()).not.toContain(SELF_TOKEN);
    });
  }, 60_000);

  it('IT-227 퍼센트 인코딩 접두사 우회: /%69nternal/v1/metrics·/%69nternal/v1/admin/quiesce(토큰 없음) → 404 CT-NOTFOUND-900(정규형은 401) [NFR-SEC-003][NFR-SEC-019]', async () => {
    await withHome(async (home) => {
      // Arrange
      const { svc, port } = await serve(home.path);
      // Act
      const plain = await httpRequest(port, 'GET', '/internal/v1/metrics');
      const encoded = await httpRequest(port, 'GET', '/%69nternal/v1/metrics');
      const encodedPost = await httpRequest(
        port,
        'POST',
        '/%69nternal/v1/admin/quiesce',
        { 'idempotency-key': fixedUlid(700) },
        { epoch_id: fixedUlid(701) },
      );
      // Assert
      expect(plain.status).toBe(401);
      expect(encoded.status).toBe(404);
      expect(JSON.parse(encoded.body)).toMatchObject({ code: 'CT-NOTFOUND-900' });
      expect(encodedPost.status).toBe(404);
      expect(JSON.parse(encodedPost.body)).toMatchObject({ code: 'CT-NOTFOUND-900' });
      svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      expect(await svc.exit).toBe(0);
    });
  }, 60_000);

  it('IT-220 quiesce → snapshot(사본 sha256 = 파일) → resume, integrity full ok [NFR-DATA-012][IF-COM-005][IF-COM-006][IF-COM-007][IF-COM-010]', async () => {
    await withHome(async (home) => {
      // Arrange
      const { svc, port } = await serve(home.path);
      const epoch = fixedUlid(600);
      const post = (url: string, body: unknown, n: number): ReturnType<typeof httpRequest> =>
        httpRequest(port, 'POST', url, opsHeaders(fixedUlid(n)), body);
      // Act
      const quiesce = await post('/internal/v1/admin/quiesce', { epoch_id: epoch }, 1);
      const dir = path.join(home.path, 'backups', 'snap', epoch);
      const snap = await post('/internal/v1/admin/snapshot', { epoch_id: epoch, dir }, 2);
      const resume = await post('/internal/v1/admin/resume', { epoch_id: epoch, outcome: 'completed' }, 3);
      const integrity = await post('/internal/v1/admin/integrity', { level: 'full' }, 4);
      // Assert
      expect(quiesce.status).toBe(200);
      expect(snap.status).toBe(200);
      const result = SnapshotResult.parse(JSON.parse(snap.body));
      const copy = path.join(dir, 'content.db');
      expect(result.files).toEqual([
        {
          file: 'content.db',
          sha256: createHash('sha256').update(readFileSync(copy)).digest('hex'),
          bytes: expect.any(Number),
        },
      ]);
      expect(result.schema).toEqual({
        _infra: 3,
        catalog: 2,
        acquisition: 1,
        itembank: 1,
        grading: 1,
        runner: 1,
      });
      expect(resume.status).toBe(200);
      expect(integrity.status).toBe(200);
      expect(IntegrityResult.parse(JSON.parse(integrity.body))).toMatchObject({
        svc: 'content',
        level: 'full',
        ok: true,
      });
      svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      expect(await svc.exit).toBe(0);
    });
  }, 90_000);

  it('IT-221 서비스 정지 후 --mode=restore(5키 되감기 0) → exit 0 → 재기동 ready [NFR-DATA-012][IF-COM-010]', async () => {
    await withHome(async (home) => {
      // Arrange: 스냅샷을 만든다
      const first = await serve(home.path);
      const epoch = fixedUlid(601);
      const dir = path.join(home.path, 'backups', 'snap', epoch);
      const snap = await httpRequest(first.port, 'POST', '/internal/v1/admin/snapshot', opsHeaders(fixedUlid(10)), {
        epoch_id: epoch,
        dir,
      });
      expect(snap.status).toBe(200);
      first.svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      expect(await first.svc.exit).toBe(0);
      // Act
      const rewind = JSON.stringify({ gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 });
      const restored = await runMode(['--mode=restore', `--from=${dir}`, `--rewind-cursors=${rewind}`], {
        FATHOM_HOME: home.path,
      });
      // Assert
      expect(restored.code).toBe(0);
      expect(jsonLines(restored).find((l) => l.event === 'mode.restore.completed')).toMatchObject({ level: 'info' });
      const svc = forkContent({ FATHOM_HOME: home.path });
      svc.child.send(envelope(home.path));
      await svc.waitFor('listening');
      expect((await svc.waitFor('ready')).type).toBe('ready');
      svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      expect(await svc.exit).toBe(0);
    });
  }, 90_000);
});

describe('content inbox · outbox 결선', () => {
  const event = (n: number, type: string, producer: string): Record<string, unknown> => ({
    event_id: fixedUlid(n),
    type,
    schema_version: 1,
    producer,
    producer_seq: n,
    occurred_at: 1,
    correlation_id: fixedUlid(900),
    causation_id: null,
    traceparent: null,
    payload: {},
  });
  const deliver = (
    port: number,
    token: string,
    producer: string,
    ev: Record<string, unknown>,
    attempt: number,
    n: number,
  ): ReturnType<typeof httpRequest> =>
    httpRequest(
      port,
      'POST',
      '/internal/v1/inbox',
      { authorization: `Bearer ${token}`, 'x-fathom-delivery-attempt': String(attempt), 'x-request-id': fixedUlid(n) },
      { producer, events: [ev] },
    );

  it('IT-225 미구독 → ack·dedupe 1행 · 구독(핸들러 0) attempt 1·2 보류, 3회째 inbox_dead 격리(유실 0) · 매니페스트 6구독 [NFR-DATA-013][IF-COM-004]', async () => {
    await withHome(async (home) => {
      // Arrange
      const { svc, port } = await serve(home.path);
      const file = contentDbPath(home.path);
      // Act / Assert: 미구독 ops.host_state.changed
      const unsub = await deliver(port, OPS_TOKEN, 'ops-api', event(5, 'ops.host_state.changed', 'ops-api'), 1, 501);
      expect(unsub.status).toBe(200);
      expect(JSON.parse(unsub.body)).toEqual({ acked_through_seq: 5 });
      expect(await queryRows(file, 'SELECT count(*) AS n FROM inbox_dedupe')).toEqual([{ n: 1 }]);
      // 구독 learning.session.completed — 핸들러 0
      const sub = event(7, 'learning.session.completed', 'learning');
      const a1 = await deliver(port, LEARNING_TOKEN, 'learning', sub, 1, 502);
      const a2 = await deliver(port, LEARNING_TOKEN, 'learning', sub, 2, 503);
      expect(JSON.parse(a1.body)).toEqual({ acked_through_seq: 6 }); // 직전 seq
      expect(JSON.parse(a2.body)).toEqual({ acked_through_seq: 6 });
      expect(await queryRows(file, 'SELECT count(*) AS n FROM inbox_dedupe')).toEqual([{ n: 1 }]);
      expect(await queryRows(file, 'SELECT count(*) AS n FROM inbox_dead')).toEqual([{ n: 0 }]);
      const a3 = await deliver(port, LEARNING_TOKEN, 'learning', sub, 3, 504);
      expect(JSON.parse(a3.body)).toEqual({ acked_through_seq: 7 });
      expect(await queryRows(file, 'SELECT count(*) AS n FROM inbox_dead')).toEqual([{ n: 1 }]);
      const manifest = ConsumerManifest.parse(contentManifest());
      expect(manifest.subscriptions).toHaveLength(6);
      expect(manifest.subscriptions.every((s) => s.mode === 'durable' && s.on_poison === 'dead_letter')).toBe(true);
      svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      expect(await svc.exit).toBe(0);
    });
  }, 90_000);

  it('IT-226 기동 후 outbox_delivery = ROUTING.content의 (목적지, mode) 집합 [NFR-DATA-013]', async () => {
    await withHome(async (home) => {
      // Arrange / Act
      const { svc } = await serve(home.path);
      const rows = await queryRows(contentDbPath(home.path), 'SELECT dest, mode FROM outbox_delivery ORDER BY dest');
      // Assert
      const expected = Object.entries(ROUTING.content)
        .map(([dest, r]) => ({ dest, mode: r.mode }))
        .sort((a, b) => a.dest.localeCompare(b.dest));
      expect(rows).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
      svc.child.send({ type: 'shutdown', v: 1, grace_ms: 200 });
      expect(await svc.exit).toBe(0);
    });
  }, 60_000);
});
