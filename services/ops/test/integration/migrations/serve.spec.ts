import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Healthz, IntegrityResult, Readyz, SnapshotResult } from '@fathom/contracts/admin/admin-routes';
import { ROUTING } from '@fathom/contracts/events/routing.gen';
import { createJobRunner } from '@fathom/shared-kernel/jobs/jobs';
import { buildServiceApp } from '@fathom/shared-kernel/service/service';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { createFakePeer } from '@fathom/testkit/fakes/peers/peers';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serviceDefinition } from '../../../src/config.js';
import {
  bootServe,
  CALLER_TOKENS,
  execArgvFor,
  getJson,
  MAIN,
  postInbox,
  runMode,
  SERVICE_DIR,
  withTempHome,
} from './helpers/boot.js';

const OPS_OPTS = { synchronous: 'NORMAL', recursiveTriggers: false, readOnly: true } as const;
const SQLITE_VALUE_IMPORT =
  /(?:import|export)\s+(?!type\b)[^;]*?from\s+['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]|import\s*\(\s*['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]\s*\)|import\s+['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]/;
const runners: { shutdown(): Promise<void> }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const r of runners.splice(0)) {
    await r.shutdown();
  }
});

function learningEvent(seq: number, type: string): Record<string, unknown> {
  return {
    event_id: fixedUlid(seq),
    type,
    schema_version: 1,
    producer: 'learning',
    producer_seq: seq,
    occurred_at: 1_790_000_000_000,
    correlation_id: fixedUlid(900),
    causation_id: null,
    traceparent: null,
    payload: {},
  };
}

describe('ops-api serve', () => {
  it('IT-515 serve 정상 + buildServiceApp(공통 3 + inbox 1, 지연 리스너) [FR-SET-001][IF-COM-001][IF-COM-002]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      // Act: serve
      const served = await bootServe(home.path);
      // Assert
      expect(served.ready).toMatchObject({
        type: 'ready',
        schema_versions: { 'ops.db': { _infra: 3, backup: 1, health: 1, telemetry: 1, upgrade: 1 } },
      });
      expect(Healthz.parse((await getJson(served.port ?? 0, '/healthz')).body)).toMatchObject({ svc: 'ops-api' });
      const ready = await getJson(served.port ?? 0, '/readyz');
      expect(ready.status).toBe(200);
      expect(Readyz.parse(ready.body)).toMatchObject({ ready: true, svc: 'ops-api' });
      expect(await served.stop()).toBe(0);
      // Act: buildServiceApp — 이 프로세스(vitest 작업자)에 IPC가 있어도 생성만으로 송신·리스너 등록 0
      const clock = createFakeClock();
      const db = openDb(path.join(home.path, 'data', 'ops.db'), { ...OPS_OPTS, readOnly: false });
      const sendSpy = typeof process.send === 'function' ? vi.spyOn(process, 'send') : null;
      const listenersBefore = process.listenerCount('message');
      try {
        const peers = Object.fromEntries(
          (['gateway', 'content', 'learning', 'ai-gateway'] as const).map((p) => [
            p,
            createFakePeer({ peer: p, clock, handlers: {} }),
          ]),
        );
        const app = await buildServiceApp(serviceDefinition(MAIN), {
          callerTokens: TEST_CALLER_TOKENS,
          clock,
          home: home.path,
          dbs: { 'ops.db': db },
          peers,
        });
        const routes = app
          .registeredRoutes()
          .map((r) => `${r.method} ${r.url}`)
          .sort();
        await app.close();
        // Assert
        expect(routes).toEqual(['GET /healthz', 'GET /internal/v1/metrics', 'GET /readyz', 'POST /internal/v1/inbox']);
        expect(process.listenerCount('message')).toBe(listenersBefore);
        expect(sendSpy?.mock.calls ?? []).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  it('IT-516 outbox_delivery = ROUTING[ops-api] · learning 토큰 inbox dead_letter [NFR-DATA-013][IF-COM-004]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const served = await bootServe(home.path);
      const port = served.port ?? 0;
      const deadCount = (): unknown =>
        (() => {
          const db = openDb(path.join(home.path, 'data', 'ops.db'), OPS_OPTS);
          try {
            return db.prepare('SELECT count(*) AS n FROM inbox_dead').get()?.n;
          } finally {
            db.close();
          }
        })();
      // Act: attempt 3 → 격리 + ack
      const dead = await postInbox(
        port,
        CALLER_TOKENS.learning,
        { producer: 'learning', events: [learningEvent(5, 'learning.session.completed')] },
        3,
      );
      // 미구독 type → 건너뜀 ack
      const skipped = await postInbox(port, CALLER_TOKENS.learning, {
        producer: 'learning',
        events: [learningEvent(6, 'learning.mastery.changed')],
      });
      expect(await served.stop()).toBe(0);
      // Assert
      expect(dead).toMatchObject({ status: 200, body: { acked_through_seq: 5 } });
      expect(deadCount()).toBe(1);
      expect(skipped).toMatchObject({ status: 200, body: { acked_through_seq: 6 } });
      const db = openDb(path.join(home.path, 'data', 'ops.db'), OPS_OPTS);
      const rows = db.prepare('SELECT dest, mode FROM outbox_delivery ORDER BY dest').all();
      db.close();
      const expected = Object.entries(ROUTING['ops-api'])
        .map(([dest, r]) => ({ dest, mode: r.mode }))
        .sort((a, b) => a.dest.localeCompare(b.dest));
      expect(rows).toEqual(expected);
      expect(expected).toEqual([
        { dest: 'ai-gateway', mode: 'durable' },
        { dest: 'gateway', mode: 'notify' },
        { dest: 'learning', mode: 'durable' },
      ]);
    });
  });

  it('IT-517 --disable-warning 없이 migrate → ExperimentalWarning 0 · src의 sqlite 값 import 0 [NFR-PORT-009]', async () => {
    await withTempHome(async (home) => {
      // Act
      const run = await runMode(home.path, ['--mode=migrate'], { noWarningFlag: true });
      // Assert
      expect(run.code).toBe(0);
      expect(run.stderr.filter((l) => l.includes('ExperimentalWarning'))).toEqual([]);
      const files = readdirSync(path.join(SERVICE_DIR, 'src'), { recursive: true, encoding: 'utf8' }).filter((f) =>
        f.endsWith('.ts'),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(SQLITE_VALUE_IMPORT.test(readFileSync(path.join(SERVICE_DIR, 'src', f), 'utf8')), f).toBe(false);
      }
    });
  });

  it('IT-518 기본 job: snapshot → files = [ops.db] · integrity full → ok [NFR-DATA-012]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const runner = createJobRunner({
        entry: MAIN,
        execArgv: execArgvFor(),
        onStdoutLine: () => undefined,
        onStderrLine: () => undefined,
      });
      runners.push(runner);
      const epoch = fixedUlid(61);
      // Act
      const snap = await runner.run(
        'snapshot',
        { epoch_id: epoch, dir: path.join(home.path, 'backups', 'snap', epoch), home: home.path },
        { timeoutMs: 30_000 },
      );
      const check = await runner.run('integrity', { level: 'full', home: home.path }, { timeoutMs: 30_000 });
      // Assert
      expect(snap.ok).toBe(true);
      const result = SnapshotResult.parse(snap.ok ? snap.value : null);
      expect(result.files.map((f) => f.file)).toEqual(['ops.db']);
      expect(result.svc).toBe('ops-api');
      expect(result.ledger_head).toBeUndefined();
      const integrity = IntegrityResult.parse(check.ok ? check.value : null);
      expect(integrity.ok).toBe(true);
      expect(integrity.files.map((f) => f.file)).toEqual(['ops.db']);
    });
  });
});
