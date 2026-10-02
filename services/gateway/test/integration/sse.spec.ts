import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import type { SseConn } from '../unit/sse.js';
import { openSse } from '../unit/sse.js';
import { bootGateway, CONTENT_AUTH, cleanup, freePort, login, request, withHome, writeCliToken } from './support.js';

afterEach(async () => {
  expect(await cleanup()).toBe(0);
});

const shutdownMsg = { type: 'shutdown', v: 1, grace_ms: 300 };
const BOOT_1 = fixedUlid(7);
const BOOT_2 = fixedUlid(8);

function packEvent(n: number): Record<string, unknown> {
  return {
    event_id: fixedUlid(2000 + n),
    type: 'catalog.pack.activated',
    schema_version: 1,
    producer: 'content',
    producer_seq: n,
    occurred_at: 1_790_000_000_000 + n,
    correlation_id: fixedUlid(900),
    causation_id: null,
    traceparent: null,
    payload: { n },
  };
}

async function stream(port: number, cookieHeaders: Record<string, string>, lastEventId?: string): Promise<SseConn> {
  const res = await openSse(port, {
    host: `127.0.0.1:${port}`,
    ...cookieHeaders,
    ...(lastEventId === undefined ? {} : { 'last-event-id': lastEventId }),
  });
  if (res.kind !== 'stream') {
    throw new Error(`expected an event stream, got ${res.status}: ${res.body}`);
  }
  await res.conn.waitFor('event: hello');
  return res.conn;
}

describe('SSE 실 연결 (실 프로세스)', () => {
  it('IT-107 inbox 배치 → 수신, Last-Event-ID 재연결 → 누락분 재전송, gateway 재기동(새 boot) 후 재연결 → resync gateway_restarted [IR-016][NFR-AVL-005]', async () => {
    await withHome(async (home) => {
      // Arrange
      writeCliToken(home.path);
      const port = await freePort();
      const listen = { host: '127.0.0.1' as const, port };
      const first = await bootGateway(home.path, { listen });
      const session = await login(port);
      const conn = await stream(port, session.headers());
      const deliver = (n: number[]): ReturnType<typeof request> =>
        request(port, 'POST', '/internal/v1/inbox', {
          headers: CONTENT_AUTH,
          body: { producer: 'content', events: n.map(packEvent) },
        });
      // Act 1: 연결된 클라이언트가 배치를 받는다
      const batch = await deliver([1, 2]);
      expect(batch.status).toBe(200);
      expect(batch.json()).toEqual({ acked_through_seq: 2 });
      await conn.waitFor(`id: ${BOOT_1}.2\nevent: catalog.pack.activated\n`);
      expect(conn.text()).toContain(`id: ${BOOT_1}.1\nevent: catalog.pack.activated\n`);
      // Act 2: 끊긴 사이 이벤트 → Last-Event-ID로 재연결하면 누락분만 재전송
      conn.close();
      await conn.closed();
      expect((await deliver([3])).status).toBe(200);
      const resumed = await stream(port, session.headers(), `${BOOT_1}.2`);
      await resumed.waitFor(`id: ${BOOT_1}.3\nevent: catalog.pack.activated\n`);
      expect(resumed.text()).toContain(`id: ${BOOT_1}.2\nevent: hello\n`); // hello의 id·hub_seq = 재전송 시작점
      expect(resumed.text()).not.toContain(`id: ${BOOT_1}.1\nevent: catalog`);
      resumed.close();
      // Act 3: 재기동(새 boot) 후 옛 Last-Event-ID → resync
      first.svc.child.send(shutdownMsg);
      expect(await first.svc.exit).toBe(0);
      const second = await bootGateway(home.path, { boot_id: BOOT_2, listen });
      expect(second.port).toBe(port);
      const after = await stream(port, session.headers(), `${BOOT_1}.3`);
      await after.waitFor('event: resync');
      expect(after.text()).toContain('data: {"reason":"gateway_restarted"}');
      expect(after.text()).toContain(`id: ${BOOT_2}.0\nevent: resync\n`);
      after.close();
      second.svc.child.send(shutdownMsg);
      expect(await second.svc.exit).toBe(0);
    });
  }, 90_000);
});
