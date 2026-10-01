import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { AdminEventsView, IntegrityResult, SnapshotResult } from '@fathom/contracts/admin/admin-routes';
import { Problem } from '@fathom/contracts/common/problem';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { createJobRunner } from '../../../src/jobs/jobs.js';
import { createMetrics } from '../../../src/metrics/metrics.js';
import { assembleApp } from '../../../src/service/app.js';
import { createService } from '../../../src/service/boot.js';
import type { ServiceDefinition } from '../../../src/service/types.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { openDb } from '../../../src/sqlite/sqlite.js';
import { captureLogger } from '../../unit/eventing/support.js';
import { fakePort } from '../../unit/service/support-boot.js';
import { EXEC_ARGV, FULL, fixtureDef, MAIN } from './fixtures/def.js';
import { withHome } from './harness.js';

const OPS = { authorization: `Bearer ${TEST_CALLER_TOKENS['ops-api']}` };
const JSON_H = { 'content-type': 'application/json; charset=utf-8' };
const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    await c();
  }
});

async function start(home: string, def: ServiceDefinition<null> = fixtureDef({ databases: [FULL] })) {
  const fp = fakePort({ argv: ['--mode=migrate'], hasIpc: false, env: { FATHOM_HOME: home } });
  expect(await createService(def, { process: fp.port, logDestination: { write: () => undefined } })).toEqual({
    kind: 'exited',
    code: 0,
  });
  const db = openDb(path.join(home, 'data', 'content.db'), { synchronous: 'NORMAL' });
  const metrics = createMetrics();
  const jobs = createJobRunner({
    entry: MAIN,
    execArgv: EXEC_ARGV,
    onStdoutLine: () => undefined,
    onStderrLine: () => undefined,
  });
  const cap = captureLogger();
  const internals = await assembleApp(def, {
    callerTokens: TEST_CALLER_TOKENS,
    clock: createFakeClock(Date.now()),
    home,
    log: cap.log,
    dbs: { 'content.db': db },
    jobs,
    metrics,
  });
  closers.push(async () => {
    await internals.handle.close();
    await jobs.shutdown();
    db.close();
  });
  let n = 1000;
  const post = (url: string, body: unknown) =>
    internals.handle.fastify.inject({
      method: 'POST',
      url,
      headers: { ...JSON_H, ...OPS, 'idempotency-key': fixedUlid(n++) },
      payload: JSON.stringify(body),
    });
  const get = (url: string) => internals.handle.fastify.inject({ method: 'GET', url, headers: OPS });
  return { db, post, get, metrics, cap };
}

const seed = (db: SqlitePort): void => {
  db.tx(() => {
    for (let i = 1; i <= 3; i += 1) {
      db.prepare("INSERT INTO fx_item(id, name) VALUES (:i, 'x')").run({ i });
      db.prepare(
        'INSERT INTO outbox(event_id, type, schema_version, occurred_at, correlation_id, payload) VALUES (:e, :t, 1, 1, :c, :p)',
      ).run({ e: fixedUlid(i), t: 'a.b.c', c: fixedUlid(500), p: '{"n":1}' });
    }
    db.prepare(
      "INSERT INTO outbox_delivery(dest, mode, last_acked_seq, updated_at) VALUES ('learning', 'durable', 2, 0)",
    ).run();
    db.prepare(
      "INSERT INTO outbox_delivery(dest, mode, last_acked_seq, updated_at) VALUES ('gateway', 'notify', 3, 0)",
    ).run();
    db.prepare("INSERT INTO inbox_watermark(producer, last_producer_seq, updated_at) VALUES ('learning', 77, 0)").run();
  });
};

describe('admin snapshot (실제 job fork)', () => {
  it('UT-SK-182 사본 sha256·bytes 일치·outbox_head_seq·delivery·inbox_watermark = 사본 값·SnapshotResult 통과·snap 밖 dir → 400 [NFR-DATA-012][IF-COM-006]', async () => {
    await withHome(async (home) => {
      // Arrange
      const rig = await start(home.path);
      seed(rig.db);
      const epoch = fixedUlid(600);
      const dir = path.join(home.path, 'backups', 'snap', epoch);
      // Act
      const res = await rig.post('/internal/v1/admin/snapshot', { epoch_id: epoch, dir });
      // Assert
      expect(res.statusCode).toBe(200);
      const result = SnapshotResult.parse(JSON.parse(res.body));
      const copy = path.join(dir, 'content.db');
      expect(result.files).toEqual([
        {
          file: 'content.db',
          sha256: createHash('sha256').update(readFileSync(copy)).digest('hex'),
          bytes: statSync(copy).size,
        },
      ]);
      expect(result).toMatchObject({
        epoch_id: epoch,
        svc: 'content',
        schema: { _infra: 3, fixture: 1 },
        outbox_head_seq: 3,
        delivery: { gateway: 0, content: 0, learning: 2, 'ai-gateway': 0, 'ops-api': 0 }, // durable만, 5키
        inbox_watermark: { gateway: 0, content: 0, learning: 77, 'ai-gateway': 0, 'ops-api': 0 },
      });
      // 사본은 snapshot 시점 값을 담는다 — 라이브가 이후 바뀌어도 사본은 그대로
      rig.db.prepare("UPDATE outbox_delivery SET last_acked_seq = 3 WHERE dest = 'learning'").run();
      const copyDb = openDb(copy, { readOnly: true, synchronous: 'NORMAL' });
      expect(copyDb.prepare("SELECT last_acked_seq AS v FROM outbox_delivery WHERE dest = 'learning'").get()).toEqual({
        v: 2,
      });
      copyDb.close();
      // snap 밖 dir → 400 VAL-900 snapshot_dir
      const outside = await rig.post('/internal/v1/admin/snapshot', {
        epoch_id: epoch,
        dir: path.join(home.path, 'backups', 'other'),
      });
      expect(outside.statusCode).toBe(400);
      expect(Problem.parse(JSON.parse(outside.body)).errors?.[0]?.rule).toBe('snapshot_dir');
      const sibling = await rig.post('/internal/v1/admin/snapshot', { epoch_id: epoch, dir: `${dir}-evil` });
      expect(sibling.statusCode).toBe(400);
      // 하위 디렉터리는 허용된다
      const nested = path.join(dir, 'nested');
      mkdirSync(nested, { recursive: true });
      expect((await rig.post('/internal/v1/admin/snapshot', { epoch_id: epoch, dir: nested })).statusCode).toBe(200);
      // 이미 사본이 있는 dir → job 실패 → 500 INTERNAL-900 + job_failures_total
      const again = await rig.post('/internal/v1/admin/snapshot', { epoch_id: epoch, dir });
      expect(again.statusCode).toBe(500);
      expect(Problem.parse(JSON.parse(again.body)).code).toBe('CT-INTERNAL-900');
      expect(rig.metrics.render()).toContain('job_failures_total{job="snapshot"} 1');
      expect(rig.metrics.render()).toContain('job_duration_ms_count{job="snapshot"} 2');
    });
  }, 60_000);
});

describe('admin integrity · events', () => {
  it('UT-SK-183 integrity quick/full + FK 위반 수 [NFR-DATA-012][IF-COM-010]', async () => {
    await withHome(async (home) => {
      // Arrange
      const rig = await start(home.path);
      // Act: 정상
      const quick = IntegrityResult.parse(
        JSON.parse((await rig.post('/internal/v1/admin/integrity', { level: 'quick' })).body),
      );
      const full = IntegrityResult.parse(
        JSON.parse((await rig.post('/internal/v1/admin/integrity', { level: 'full' })).body),
      );
      // Assert
      expect(quick).toMatchObject({
        svc: 'content',
        level: 'quick',
        ok: true,
        files: [{ file: 'content.db', check: 'ok', foreign_key_violations: 0 }],
      });
      expect(full).toMatchObject({ level: 'full', ok: true });
      // FK 위반(제약을 끄고 넣는다) → ok false, 위반 수 1
      rig.db.exec(
        'CREATE TABLE fk_parent(id INTEGER PRIMARY KEY) STRICT; CREATE TABLE fk_child(id INTEGER PRIMARY KEY, p INTEGER REFERENCES fk_parent(id)) STRICT',
      );
      rig.db.exec('PRAGMA foreign_keys = OFF');
      rig.db.exec('INSERT INTO fk_child(id, p) VALUES (1, 99)');
      const bad = IntegrityResult.parse(
        JSON.parse((await rig.post('/internal/v1/admin/integrity', { level: 'full' })).body),
      );
      expect(bad).toMatchObject({ ok: false, files: [{ check: 'ok', foreign_key_violations: 1 }] });
    });
  }, 60_000);

  it('UT-SK-184 events → AdminEventsView(상관 ID별 outbox·delivered 5키·inbox []) [IF-COM-009]', async () => {
    await withHome(async (home) => {
      // Arrange
      const rig = await start(home.path);
      seed(rig.db);
      // Act
      const res = await rig.get(`/internal/v1/admin/events?correlation_id=${fixedUlid(500)}`);
      const none = await rig.get(`/internal/v1/admin/events?correlation_id=${fixedUlid(501)}`);
      const bad = await rig.get('/internal/v1/admin/events?correlation_id=nope');
      // Assert
      expect(res.statusCode).toBe(200);
      const view = AdminEventsView.parse(JSON.parse(res.body));
      expect(view.svc).toBe('content');
      expect(view.outbox.map((o) => [o.seq, o.delivered.learning, o.delivered.gateway])).toEqual([
        [1, true, true],
        [2, true, true],
        [3, false, true],
      ]);
      expect(view.inbox).toEqual([]);
      expect(AdminEventsView.parse(JSON.parse(none.body)).outbox).toEqual([]);
      expect(bad.statusCode).toBe(400);
    });
  }, 60_000);
});
