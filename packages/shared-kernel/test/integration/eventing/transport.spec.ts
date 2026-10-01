import type { IncomingHttpHeaders } from 'node:http';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { InboxDelivery } from '@fathom/contracts/events/inbox';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { createInboxTransport } from '../../../src/eventing/transport.js';

const TOKEN = 'ab'.repeat(32);
const BODY: InboxDelivery = {
  producer: 'content',
  events: [
    {
      event_id: fixedUlid(1),
      type: 'a.b.c',
      schema_version: 1,
      producer: 'content',
      producer_seq: 7,
      occurred_at: 1_790_000_000_000,
      correlation_id: fixedUlid(2),
      causation_id: null,
      traceparent: null,
      payload: { n: 1 },
    },
  ],
};

type Seen = { headers: IncomingHttpHeaders; body: string; url: string; method: string };
const servers: http.Server[] = [];

async function serve(
  respond: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        url: req.url ?? '',
        method: req.method ?? '',
      });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function transportFor(url: string | null, over: Partial<Parameters<typeof createInboxTransport>[0]> = {}) {
  return createInboxTransport({ selfToken: TOKEN, baseUrl: () => url, ...over });
}

describe('createInboxTransport (실제 127.0.0.1 서버)', () => {
  it('UT-SK-149 헤더 5종·200 InboxAck·503 -DEP-910 → INBOX-HALT+seq·닫힌 포트 → DEP-CONNECT·계약 위반 → CONTRACT [IF-COM-004]', async () => {
    // Arrange: 200
    const ok = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ acked_through_seq: 7 }));
    });
    const t = transportFor(ok.url);
    // Act
    const r = await t.deliver('learning', BODY, 3);
    // Assert
    expect(r).toEqual({ ok: true, value: { acked_through_seq: 7 } });
    const seen = ok.seen[0];
    expect(seen?.method).toBe('POST');
    expect(seen?.url).toBe('/internal/v1/inbox');
    expect(seen?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen?.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(seen?.headers['x-request-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(seen?.headers['x-fathom-delivery-attempt']).toBe('3');
    expect(seen?.headers['x-fathom-deadline-ms']).toBe('5000');
    expect(JSON.parse(seen?.body ?? '{}')).toEqual(BODY);
    t.close();

    // 503 CT-DEP-910 → INBOX-HALT + acked_through_seq
    const halt = await serve((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/problem+json' }).end(
        JSON.stringify({
          type: 'urn:fathom:problem:lr-dep-910',
          title: 'x',
          status: 503,
          code: 'LR-DEP-910',
          error_id: fixedUlid(5),
          request_id: fixedUlid(6),
          retryable: true,
          acked_through_seq: 4,
        }),
      );
    });
    expect(await transportFor(halt.url).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'INBOX-HALT', acked_through_seq: 4 },
    });
    // 503이지만 다른 코드 → HTTP-503
    const busy = await serve((_req, res) => {
      res.writeHead(503, { 'content-type': 'application/problem+json' }).end(
        JSON.stringify({
          type: 'urn:fathom:problem:lr-dep-901',
          title: 'x',
          status: 503,
          code: 'LR-DEP-901',
          error_id: fixedUlid(5),
          request_id: fixedUlid(6),
          retryable: true,
        }),
      );
    });
    expect(await transportFor(busy.url).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'HTTP-503', acked_through_seq: null },
    });
    // 그 밖의 상태
    const forbidden = await serve((_req, res) => void res.writeHead(403).end('{}'));
    expect(await transportFor(forbidden.url).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'HTTP-403', acked_through_seq: null },
    });

    // 계약 위반 본문
    const bad = await serve(
      (_req, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end('{"nope":1}'),
    );
    expect(await transportFor(bad.url).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'CONTRACT', acked_through_seq: null },
    });
    const garbage = await serve((_req, res) => void res.writeHead(200).end('not json'));
    expect(await transportFor(garbage.url).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'CONTRACT', acked_through_seq: null },
    });

    // 닫힌 포트 → DEP-CONNECT
    const closed = await serve(() => undefined);
    const closedUrl = closed.url;
    const [server] = servers.splice(servers.length - 1, 1);
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    expect(await transportFor(closedUrl).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'DEP-CONNECT', acked_through_seq: null },
    });

    // 피어 URL 없음 → 요청 없이 DEP-NOPEER
    expect(await transportFor(null).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'DEP-NOPEER', acked_through_seq: null },
    });
  });

  it('UT-SK-149 전체 기한 초과 → DEP-TIMEOUT, 1 MiB 넘는 응답 → CONTRACT [IF-COM-004]', async () => {
    // Arrange
    const slow = await serve(() => undefined); // 응답하지 않는다
    const huge = await serve(
      (_req, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end('x'.repeat(1024 * 1024 + 10)),
    );
    // Act / Assert
    expect(await transportFor(slow.url, { deadlineMs: 100 }).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'DEP-TIMEOUT', acked_through_seq: null },
    });
    expect(await transportFor(huge.url).deliver('learning', BODY, 1)).toEqual({
      ok: false,
      error: { code: 'CONTRACT', acked_through_seq: null },
    });
  });
});
