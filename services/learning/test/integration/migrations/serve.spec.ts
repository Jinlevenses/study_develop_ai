import path from 'node:path';
import { Healthz, Readyz } from '@fathom/contracts/admin/admin-routes';
import { ROUTING } from '@fathom/contracts/events/routing.gen';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { learningDbOptions } from '../../../src/infra/db/open.js';
import { bootServe, CALLER_TOKENS, getJson, postInbox, runMode, withTempHome } from './helpers/boot.js';

function inboxEvent(type: string, seq: number, producer = 'content'): Record<string, unknown> {
  return {
    event_id: fixedUlid(seq),
    type,
    schema_version: 1,
    producer,
    producer_seq: seq,
    occurred_at: 1_790_000_000_000,
    correlation_id: fixedUlid(900),
    causation_id: null,
    traceparent: null,
    payload: {},
  };
}

describe('learning serve', () => {
  it('IT-317 serve 정상: listening → ready(schema_versions) → healthz·readyz → shutdown 0 [FR-SET-001][IF-COM-001][IF-COM-002]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      // Act
      const served = await bootServe(home.path);
      // Assert
      expect(served.port).toBeGreaterThanOrEqual(1);
      expect(served.ready).toMatchObject({
        type: 'ready',
        app_version: '0.0.0',
        schema_versions: {
          'learning.db': { _infra: 3, ledger: 1, 'learner-model': 1, practice: 1, 'curriculum-ref': 1 },
          'insight.db': { _infra: 1, insight: 1 },
        },
      });
      const health = await getJson(served.port ?? 0, '/healthz');
      expect(health.status).toBe(200);
      expect(Healthz.parse(health.body)).toMatchObject({ ok: true, svc: 'learning' });
      const ready = await getJson(served.port ?? 0, '/readyz');
      expect(ready.status).toBe(200);
      expect(Readyz.parse(ready.body)).toMatchObject({ ready: true, svc: 'learning' });
      expect(await served.stop()).toBe(0);
      // 핸들러 0개 → 기동 로그에 inbox.handler.missing 1줄(의도된 동작)
      expect(served.stdout().filter((l) => l.includes('inbox.handler.missing'))).toHaveLength(1);
    });
  });

  it('IT-323 serve 후 종료 → outbox_delivery = ROUTING.learning [NFR-DATA-013][IF-COM-004]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const served = await bootServe(home.path);
      expect(await served.stop()).toBe(0);
      // Act
      const db = openDb(path.join(home.path, 'data', 'learning.db'), learningDbOptions(true));
      const rows = db.prepare('SELECT dest, mode FROM outbox_delivery ORDER BY dest').all();
      db.close();
      // Assert
      const expected = Object.entries(ROUTING.learning)
        .map(([dest, r]) => ({ dest, mode: r.mode }))
        .sort((a, b) => a.dest.localeCompare(b.dest));
      expect(rows).toEqual(expected);
      expect(expected).toEqual([
        { dest: 'content', mode: 'durable' },
        { dest: 'gateway', mode: 'notify' },
        { dest: 'ops-api', mode: 'durable' },
      ]);
    });
  });

  it('IT-324 inbox: 미구독 ack · halt 독 이벤트 503 · 호출자≠producer 403 [NFR-DATA-013][IF-COM-004]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const served = await bootServe(home.path);
      const port = served.port ?? 0;
      // Act / Assert ① 미구독 이벤트
      const skipped = await postInbox(port, CALLER_TOKENS.content, {
        producer: 'content',
        events: [inboxEvent('catalog.overlay.conflicted', 1)],
      });
      expect(skipped).toMatchObject({ status: 200, body: { acked_through_seq: 1 } });
      // ② 구독 + halt + 핸들러 0
      const halted = await postInbox(port, CALLER_TOKENS.content, {
        producer: 'content',
        events: [inboxEvent('grading.verdict.issued', 2)],
      });
      expect(halted.status).toBe(503);
      expect(halted.body).toMatchObject({ code: 'LR-DEP-910', acked_through_seq: 1 });
      // ③ gateway 토큰으로 producer content
      const forged = await postInbox(port, CALLER_TOKENS.gateway, {
        producer: 'content',
        events: [inboxEvent('catalog.overlay.conflicted', 3)],
      });
      expect(forged.status).toBe(403);
      expect(forged.body).toMatchObject({ code: 'LR-ACL-900' });
      expect(await served.stop()).toBe(0);
    });
  });
});
