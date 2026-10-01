import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, createOutbox } from '../../../src/eventing/outbox.js';
import type { Relay } from '../../../src/eventing/relay.js';
import { startRelay } from '../../../src/eventing/relay.js';
import { rewindCursors } from '../../../src/eventing/rewind.js';
import { createInboxTransport } from '../../../src/eventing/transport.js';
import { createMetrics } from '../../../src/metrics/metrics.js';
import { assembleApp } from '../../../src/service/app.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { migrate, openDb } from '../../../src/sqlite/sqlite.js';
import { captureLogger, INFRA_DIR, PAYLOADS } from '../../unit/eventing/support.js';
import { consumerInbox, FIXTURE_MIGRATIONS, FULL, fixtureDef } from '../service/fixtures/def.js';
import { withHome } from '../service/harness.js';

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) {
    await c();
  }
});

function openFile(file: string, modules: { module: string; dir: string }[], appId: number): SqlitePort {
  const db = openDb(file, { synchronous: 'NORMAL' });
  const r = migrate(db, [{ module: '_infra', dir: INFRA_DIR }, ...modules], {
    dryRun: false,
    profile: 'full',
    applicationId: appId,
    clock: createFakeClock(),
  });
  if (!r.ok) {
    throw new Error(`migrate failed: ${r.error.reason}`);
  }
  closers.push(() => db.close());
  return db;
}

/** 소비자(content, 파일 DB·durable inbox) 앱을 127.0.0.1:0에 띄운다. 같은 DB로 다시 부르면 "재시작"이다. */
async function startConsumer(db: SqlitePort, handled: number[]): Promise<{ url: string; stop(): Promise<void> }> {
  const def = fixtureDef({ databases: [FULL], inbox: consumerInbox((n) => void handled.push(n)) });
  const internals = await assembleApp(def, {
    callerTokens: TEST_CALLER_TOKENS,
    clock: createFakeClock(Date.now()),
    home: '/tmp/unused',
    log: captureLogger().log,
    dbs: { 'content.db': db },
  });
  await internals.handle.fastify.listen({ host: '127.0.0.1', port: 0 });
  const { port } = internals.handle.fastify.server.address() as AddressInfo;
  const stop = async (): Promise<void> => {
    await internals.handle.close();
  };
  closers.push(stop);
  return { url: `http://127.0.0.1:${port}`, stop };
}

describe('outbox → relay → inbox 왕복', () => {
  it('UT-SK-163 250건 append → 소비자 핸들러 정확히 250회·커서 = head, 소비자 재시작 + rewindCursors(0) 재전송 → dedupe로 핸들러 추가 0 [NFR-DATA-013]', async () => {
    await withHome(async (home) => {
      // Arrange: 생산자(learning, 파일 DB) · 소비자(content, 파일 DB)
      const producer = openFile(path.join(home.path, 'learning.db'), [], 1_700_000_010);
      const consumerDb = openFile(
        path.join(home.path, 'content.db'),
        [{ module: 'fixture', dir: FIXTURE_MIGRATIONS }],
        FULL.applicationId,
      );
      const handled: number[] = [];
      let consumer = await startConsumer(consumerDb, handled);
      const clock = createFakeClock(Date.now());
      const metrics = createMetrics();
      const log = captureLogger(clock).log;
      const transport = createInboxTransport({
        selfToken: TEST_CALLER_TOKENS.learning,
        baseUrl: (d) => (d === 'content' ? consumer.url : null),
      });
      closers.push(() => transport.close());
      const relay: Relay = startRelay({
        db: producer,
        svc: 'learning',
        routing: { content: { mode: 'durable', types: ['a.b.c'] } },
        transport,
        clock,
        log,
        metrics,
      });
      closers.push(() => relay.stop());
      const outbox = createOutbox({
        db: producer,
        svc: 'learning',
        clock,
        payloads: PAYLOADS,
        currentTraceparent: () => null,
        onAppended: () => relay.kick(),
      });
      // Act: 3개 tx로 250건
      for (const [from, to] of [
        [1, 100],
        [101, 200],
        [201, 250],
      ] as const) {
        producer.tx(() => {
          for (let n = from; n <= to; n += 1) {
            appendEvent(outbox, { type: 'a.b.c', schema_version: 1, correlation_id: fixedUlid(1), payload: { n } });
          }
        });
      }
      const cursor = (): number =>
        Number(producer.prepare("SELECT last_acked_seq AS v FROM outbox_delivery WHERE dest = 'content'").get()?.v);
      await expect.poll(cursor, { timeout: 20_000, interval: 25 }).toBe(250);
      // Assert 1: 핸들러 정확히 250회, 순서대로(목적지별 FIFO), 소비자 DB 반영·워터마크
      expect(handled).toHaveLength(250);
      expect(handled).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
      expect(consumerDb.prepare('SELECT count(*) AS n FROM fx_item').get()).toEqual({ n: 250 });
      expect(
        consumerDb.prepare("SELECT last_producer_seq AS v FROM inbox_watermark WHERE producer = 'learning'").get(),
      ).toEqual({ v: 250 });
      // Act 2: 소비자 재시작(새 앱, 같은 DB) + 생산자 커서를 0으로 되감기
      await consumer.stop();
      consumer = await startConsumer(consumerDb, handled);
      expect(rewindCursors(producer, { content: 0 }, clock)).toBe(1);
      relay.kick();
      // Assert 2: 전량 재전송되어 커서는 다시 250, 핸들러는 추가 호출 0
      await expect.poll(cursor, { timeout: 20_000, interval: 25 }).toBe(250);
      expect(handled).toHaveLength(250);
      expect(consumerDb.prepare('SELECT count(*) AS n FROM fx_item').get()).toEqual({ n: 250 });
      expect(consumerDb.prepare('SELECT count(*) AS n FROM inbox_dedupe').get()).toEqual({ n: 250 });
    });
  }, 60_000);
});
