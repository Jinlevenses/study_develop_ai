import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Healthz, Readyz } from '@fathom/contracts/admin/admin-routes';
import { ROUTING } from '@fathom/contracts/events/routing.gen';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { bootServe, CALLER_TOKENS, getJson, postInbox, runMode, withTempHome } from './helpers/boot.js';

const AI_OPTS = { synchronous: 'NORMAL', recursiveTriggers: false, readOnly: true } as const;

function hostStateEvent(seq: number, type = 'ops.host_state.changed'): Record<string, unknown> {
  return {
    event_id: fixedUlid(seq),
    type,
    schema_version: 1,
    producer: 'ops-api',
    producer_seq: seq,
    occurred_at: 1_790_000_000_000,
    correlation_id: fixedUlid(900),
    causation_id: null,
    traceparent: null,
    payload: {},
  };
}

async function migratedServe(home: string): Promise<Awaited<ReturnType<typeof bootServe>>> {
  expect((await runMode(home, ['--mode=migrate'])).code).toBe(0);
  return bootServe(home);
}

describe('ai-gateway serve', () => {
  it('IT-416 serve 정상: ready.schema_versions·healthz·readyz·shutdown 0 [FR-SET-001][IF-COM-001][IF-COM-002]', async () => {
    await withTempHome(async (home) => {
      // Act
      const served = await migratedServe(home.path);
      // Assert
      expect(served.ready).toMatchObject({
        type: 'ready',
        schema_versions: {
          'ai.db': { _infra: 3, control: 1, routing: 1, judge: 1, privacy: 1 },
          'ai-cache.db': { _infra: 1, cache: 1 },
        },
      });
      const health = await getJson(served.port ?? 0, '/healthz');
      expect(health.status).toBe(200);
      expect(Healthz.parse(health.body)).toMatchObject({ svc: 'ai-gateway' });
      const ready = await getJson(served.port ?? 0, '/readyz');
      expect(ready.status).toBe(200);
      expect(Readyz.parse(ready.body)).toMatchObject({ ready: true, svc: 'ai-gateway' });
      expect(await served.stop()).toBe(0);
    });
  });

  it('IT-417 첫 기동 OFFLINE: 시드 1행·동의 0·이력 0·outbox 0, 2회차 불변 [FR-AI-003]', async () => {
    await withTempHome(async (home) => {
      const read = (): { mode: unknown[]; consent: unknown; history: unknown; outbox: unknown } => {
        const db = openDb(path.join(home.path, 'data', 'ai.db'), AI_OPTS);
        try {
          return {
            mode: db.prepare('SELECT id, mode, reasons_json, changed_at FROM ai_mode_state').all(),
            consent: db.prepare('SELECT count(*) AS n FROM ai_consent').get()?.n,
            history: db.prepare('SELECT count(*) AS n FROM ai_mode_history').get()?.n,
            outbox: db.prepare('SELECT count(*) AS n FROM outbox').get()?.n,
          };
        } finally {
          db.close();
        }
      };
      // Act: 1회차
      const first = await migratedServe(home.path);
      expect(await first.stop()).toBe(0);
      const afterFirst = read();
      // Assert
      expect(afterFirst.mode).toEqual([
        { id: 1, mode: 'OFFLINE', reasons_json: '["first_boot"]', changed_at: expect.any(Number) },
      ]);
      expect([afterFirst.consent, afterFirst.history, afterFirst.outbox]).toEqual([0, 0, 0]);
      expect(first.stdout().filter((l) => l.includes('control.mode.seeded'))).toHaveLength(1);
      // Act: 2회차
      const second = await bootServe(home.path);
      expect(await second.stop()).toBe(0);
      // Assert: 행 바이트 동일(changed_at 불변)·시드 로그 0
      expect(read()).toEqual(afterFirst);
      expect(second.stdout().filter((l) => l.includes('control.mode.seeded'))).toHaveLength(0);
    });
  });

  it('IT-420 serve 후 종료 → outbox_delivery = ROUTING[ai-gateway] [NFR-DATA-013][IF-COM-004]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      const served = await migratedServe(home.path);
      expect(await served.stop()).toBe(0);
      // Act
      const db = openDb(path.join(home.path, 'data', 'ai.db'), AI_OPTS);
      const rows = db.prepare('SELECT dest, mode FROM outbox_delivery ORDER BY dest').all();
      db.close();
      // Assert
      const expected = Object.entries(ROUTING['ai-gateway'])
        .map(([dest, r]) => ({ dest, mode: r.mode }))
        .sort((a, b) => a.dest.localeCompare(b.dest));
      expect(rows).toEqual(expected);
      expect(expected).toEqual([
        { dest: 'content', mode: 'durable' },
        { dest: 'gateway', mode: 'notify' },
        { dest: 'learning', mode: 'durable' },
        { dest: 'ops-api', mode: 'durable' },
      ]);
    });
  });

  it('IT-421 inbox: dead_letter 구독 — attempt 1은 직전 seq ack, attempt 3은 inbox_dead 기록 [NFR-DATA-013][IF-COM-004]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      const served = await migratedServe(home.path);
      const port = served.port ?? 0;
      const deadCount = (): unknown => {
        const db = openDb(path.join(home.path, 'data', 'ai.db'), AI_OPTS);
        try {
          return db.prepare('SELECT count(*) AS n FROM inbox_dead').get()?.n;
        } finally {
          db.close();
        }
      };
      // Act / Assert: attempt 1
      const first = await postInbox(
        port,
        CALLER_TOKENS['ops-api'],
        { producer: 'ops-api', events: [hostStateEvent(5)] },
        1,
      );
      expect(first).toMatchObject({ status: 200, body: { acked_through_seq: 4 } });
      expect(deadCount()).toBe(0);
      // attempt 3 → 격리 + ack
      const third = await postInbox(
        port,
        CALLER_TOKENS['ops-api'],
        { producer: 'ops-api', events: [hostStateEvent(5)] },
        3,
      );
      expect(third).toMatchObject({ status: 200, body: { acked_through_seq: 5 } });
      expect(deadCount()).toBe(1);
      // 미구독 type → 건너뜀 ack
      const skipped = await postInbox(port, CALLER_TOKENS['ops-api'], {
        producer: 'ops-api',
        events: [hostStateEvent(6, 'ops.backup.completed')],
      });
      expect(skipped).toMatchObject({ status: 200, body: { acked_through_seq: 6 } });
      expect(await served.stop()).toBe(0);
    });
  });

  it('IT-418 외부 소켓 0(E0-2): egress 기록기 block 모드에서 기록 0줄 [FR-AI-003][NFR-SEC-013]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const preload = import.meta.resolve('@fathom/testkit/preload/egress-recorder.mjs');
      // Act
      const served = await bootServe(home.path, { extraImports: [preload], env: { FATHOM_EGRESS_MODE: 'block' } });
      expect(served.ready).not.toBeNull();
      expect(await served.stop()).toBe(0);
      // Assert
      const dir = path.join(home.path, 'tmp', 'egress');
      const lines = existsSync(dir)
        ? readdirSync(dir).flatMap((f) =>
            readFileSync(path.join(dir, f), 'utf8')
              .split('\n')
              .filter((l) => l !== ''),
          )
        : [];
      expect(lines).toEqual([]);
    });
  });
});
