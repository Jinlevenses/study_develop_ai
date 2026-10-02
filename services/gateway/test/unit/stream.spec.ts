import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Problem } from '@fathom/contracts/common/problem';
import { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import type { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import { ActivityView } from '@fathom/contracts/http/gateway/v1/internal';
import { SseEventData } from '@fathom/contracts/http/gateway/v1/stream';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SseClient } from '../../src/application/stream/hub.js';
import { createSseHub, MAX_STALLED_WRITES } from '../../src/application/stream/hub.js';
import { gatewayManifest } from '../../src/application/stream/manifest.js';
import { createStreamHandler } from '../../src/application/stream/register.js';
import type { GatewayContext } from '../../src/config.js';
import { GATEWAY_LIMITS } from '../../src/config.js';
import type { SseConn } from './sse.js';
import { openSse } from './sse.js';
import type { Rig } from './support.js';
import { AI_AUTH, BOOT_ID, CONTENT_AUTH, HOST, makeRig, OPS_AUTH } from './support.js';

const rigs: Rig[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

const BOOT = fixedUlid(1);
const OTHER_BOOT = fixedUlid(2);
const T0 = 1_790_000_000_000;

function event(
  n: number,
  type = 'catalog.pack.activated',
  payload: Record<string, unknown> = { n },
): IntegrationEventEnvelope {
  return {
    event_id: fixedUlid(1000 + n),
    type,
    schema_version: 1,
    producer: 'content',
    producer_seq: n,
    occurred_at: T0 + n,
    correlation_id: fixedUlid(900),
    causation_id: null,
    traceparent: null,
    payload,
  };
}

function hub(over: Partial<Parameters<typeof createSseHub>[0]> = {}) {
  const h = createSseHub({
    ring: GATEWAY_LIMITS.sseRing,
    heartbeatMs: GATEWAY_LIMITS.sseHeartbeatMs,
    retryMs: GATEWAY_LIMITS.sseRetryMs,
    maxPerSession: GATEWAY_LIMITS.sseMaxPerSession,
    ...over,
  });
  h.attach({ bootId: BOOT, appVersion: '0.1.0', clock: { now: () => T0 } });
  return h;
}
function fake(): SseClient & { writes: string[]; closed: boolean } {
  const c = {
    writes: [] as string[],
    closed: false,
    write(s: string): boolean {
      c.writes.push(s);
      return true;
    },
    close(): void {
      c.closed = true;
    },
  };
  return c;
}
const frames = (c: { writes: string[] }): string[] => c.writes.filter((w) => !w.startsWith('retry:'));
const eventNames = (c: { writes: string[] }): string[] => c.writes.flatMap((w) => /^event: (.+)$/m.exec(w)?.[1] ?? []);

describe('SSE 허브 (프레임 · 링 · 재연결)', () => {
  it('UT-GW-050 1,001번째 publish → 링 최소 seq = 2, Last-Event-ID <boot>.0 → resync ring_overflow, <boot>.1은 재개 [NFR-AVL-005][IR-016]', () => {
    // Arrange
    const h = hub();
    for (let i = 1; i <= 1001; i += 1) {
      h.publish([event(i)]);
    }
    // Act
    const overflow = fake();
    h.open(overflow, { sid: 's', lastEventId: `${BOOT}.0` });
    const edge = fake();
    h.open(edge, { sid: 's', lastEventId: `${BOOT}.1` });
    // Assert
    expect(eventNames(overflow)).toEqual(['hello', 'resync']);
    expect(frames(overflow)[1]).toBe(`id: ${BOOT}.1001\nevent: resync\ndata: {"reason":"ring_overflow"}\n\n`);
    expect(eventNames(edge)).toHaveLength(1 + 1000); // hello + 재전송 seq 2..1001
    expect(frames(edge)[0]).toContain(`id: ${BOOT}.1\nevent: hello\n`);
  });

  it('UT-GW-051 다른 boot의 Last-Event-ID → resync gateway_restarted, resync 프레임 id = <boot>.<head> [IR-016]', () => {
    const h = hub();
    h.publish([event(1), event(2)]);
    const c = fake();
    h.open(c, { sid: 's', lastEventId: `${OTHER_BOOT}.99` });
    expect(eventNames(c)).toEqual(['hello', 'resync']);
    expect(frames(c)[1]).toBe(`id: ${BOOT}.2\nevent: resync\ndata: {"reason":"gateway_restarted"}\n\n`);
    expect(frames(c)[0]).toContain(`id: ${BOOT}.2\nevent: hello\n`);
  });

  it('UT-GW-052 프레임 텍스트 정확 일치 · data = SseEventData 통과·payload 원본 동일 [IR-016][IF-GW-005]', () => {
    // Arrange
    const h = hub();
    const c = fake();
    h.open(c, { sid: 's', lastEventId: undefined });
    // Act
    const ev = event(1, 'catalog.pack.activated', { pack_id: 'k8s', nested: { a: [1, 2] } });
    h.publish([ev]);
    // Assert
    const last = c.writes[c.writes.length - 1] ?? '';
    const m = /^id: (\S+)\nevent: (\S+)\ndata: (.+)\n\n$/.exec(last);
    expect(m?.[1]).toBe(`${BOOT}.1`);
    expect(m?.[2]).toBe('catalog.pack.activated');
    const data = SseEventData.parse(JSON.parse(m?.[3] ?? ''));
    expect(data).toEqual({
      type: ev.type,
      schema_version: 1,
      event_id: ev.event_id,
      occurred_at: ev.occurred_at,
      correlation_id: ev.correlation_id,
      producer: 'content',
      payload: ev.payload,
    });
  });

  it('UT-GW-053 같은 event_id 재publish → 송신 0 [IR-016]', () => {
    const h = hub();
    const c = fake();
    h.open(c, { sid: 's', lastEventId: undefined });
    h.publish([event(1)]);
    const before = c.writes.length;
    h.publish([event(1)]);
    expect(c.writes).toHaveLength(before);
  });

  it('UT-GW-054 유효 Last-Event-ID → hello(id·hub_seq = 그 seq) 뒤 이후 항목을 순서대로 재전송 [IR-016][IF-GW-005]', () => {
    const h = hub();
    h.publish([event(1), event(2), event(3)]);
    const c = fake();
    h.open(c, { sid: 's', lastEventId: `${BOOT}.1` });
    expect(c.writes[0]).toBe('retry: 2000\n\n');
    expect(c.writes[1]).toBe(
      `id: ${BOOT}.1\nevent: hello\ndata: ${JSON.stringify({ boot_id: BOOT, hub_seq: 1, server_time: T0, app_version: '0.1.0', ai_mode: 'OFFLINE' })}\n\n`,
    );
    expect(c.writes.slice(2).map((w) => /^id: (\S+)/.exec(w)?.[1])).toEqual([`${BOOT}.2`, `${BOOT}.3`]);
    // Last-Event-ID 없음 = 재전송 0, hello는 head
    const fresh = fake();
    h.open(fresh, { sid: 's', lastEventId: undefined });
    expect(eventNames(fresh)).toEqual(['hello']);
    expect(frames(fresh)[0]).toContain(`id: ${BOOT}.3\n`);
  });

  it('UT-GW-055 형식 오류·미래 seq → resync unknown_last_event_id [IR-016][NFR-AVL-005]', () => {
    const h = hub();
    h.publish([event(1)]);
    for (const bad of ['garbage', `${BOOT}.x`, `${BOOT}.2`, `${BOOT.toLowerCase()}.1`]) {
      const c = fake();
      h.open(c, { sid: 's', lastEventId: bad });
      expect(frames(c)[1], bad).toBe(`id: ${BOOT}.1\nevent: resync\ndata: {"reason":"unknown_last_event_id"}\n\n`);
    }
  });

  it('UT-GW-056 가짜 타이머 15,000ms마다 `: hb <ms>`, 해제 후 중단 [IR-016][NFR-AVL-005]', () => {
    // Arrange
    vi.useFakeTimers();
    let now = T0;
    const h = createSseHub({ ring: 10, heartbeatMs: 15_000, retryMs: 2000, maxPerSession: 8 });
    h.attach({ bootId: BOOT, appVersion: '0.1.0', clock: { now: () => now } });
    const c = fake();
    const opened = h.open(c, { sid: 's', lastEventId: undefined });
    const base = c.writes.length;
    // Act
    now += 15_000;
    vi.advanceTimersByTime(15_000);
    now += 15_000;
    vi.advanceTimersByTime(15_000);
    // Assert
    expect(c.writes.slice(base)).toEqual([`: hb ${T0 + 15_000}\n\n`, `: hb ${T0 + 30_000}\n\n`]);
    if (opened.ok) {
      opened.value();
    }
    vi.advanceTimersByTime(60_000);
    expect(c.writes).toHaveLength(base + 2);
    expect(h.activeStreams()).toBe(0);
  });

  it('UT-GW-057 첫 출력 `retry: 2000` [IR-016][NFR-AVL-005]', () => {
    const h = hub();
    const c = fake();
    h.open(c, { sid: 's', lastEventId: undefined });
    expect(c.writes[0]).toBe('retry: 2000\n\n');
  });

  it('UT-GW-063 허브: 같은 세션 9번째 → too_many, 하나 해제 후 다시 허용, 다른 세션 독립 [NFR-SEC-017][IF-GW-005]', () => {
    const h = hub();
    const releases: (() => void)[] = [];
    for (let i = 0; i < 8; i += 1) {
      const r = h.open(fake(), { sid: 'a', lastEventId: undefined });
      expect(r.ok).toBe(true);
      if (r.ok) {
        releases.push(r.value);
      }
    }
    expect(h.open(fake(), { sid: 'a', lastEventId: undefined })).toEqual({ ok: false, error: 'too_many' });
    expect(h.open(fake(), { sid: 'b', lastEventId: undefined }).ok).toBe(true);
    releases[0]?.();
    expect(h.open(fake(), { sid: 'a', lastEventId: undefined }).ok).toBe(true);
  });

  it('UT-GW-064 허브: attach 전 publish·open = invariant, 쓰기 예외 → 해제 [IR-016]', () => {
    const h = createSseHub({ ring: 10, heartbeatMs: 1000, retryMs: 2000, maxPerSession: 8 });
    expect(() => h.publish([event(1)])).toThrow(/invariant/);
    const h2 = hub();
    const broken: SseClient = {
      write(): boolean {
        throw new Error('EPIPE');
      },
      close(): void {},
    };
    expect(h2.open(broken, { sid: 's', lastEventId: undefined }).ok).toBe(true);
    expect(h2.activeStreams()).toBe(0);
  });

  it('UT-GW-066 허브: write()가 연속 false(백프레셔)인 느린 클라이언트 → 한도(32) 도달 시 해제 + close, 한 번 true면 카운트 리셋 [IR-016][STD-ASY-10]', () => {
    // Arrange
    const h = hub();
    const state = { accept: false };
    const slow: SseClient & { closed: boolean } = {
      closed: false,
      write(): boolean {
        return state.accept;
      },
      close(): void {
        slow.closed = true;
      },
    };
    expect(h.open(slow, { sid: 's', lastEventId: undefined }).ok).toBe(true); // retry·hello 2회 = false 2회
    // Act / Assert: 한도 직전까지는 유지, 중간에 true가 한 번 오면 리셋
    for (let n = 1; n <= MAX_STALLED_WRITES - 3; n += 1) {
      h.publish([event(n)]);
    }
    expect(h.activeStreams()).toBe(1);
    state.accept = true;
    h.publish([event(100)]);
    state.accept = false;
    for (let n = 101; n <= 100 + MAX_STALLED_WRITES - 1; n += 1) {
      h.publish([event(n)]);
    }
    expect(h.activeStreams()).toBe(1);
    expect(slow.closed).toBe(false);
    h.publish([event(999)]);
    expect(h.activeStreams()).toBe(0);
    expect(slow.closed).toBe(true);
  });

  it('UT-GW-062 gatewayManifest() 17구독·전부 notify/drop·ConsumerManifest 통과 [NFR-AVL-005][IF-COM-004]', () => {
    const m = gatewayManifest();
    expect(ConsumerManifest.parse(m).consumer).toBe('gateway');
    expect(m.subscriptions).toHaveLength(17);
    expect(m.subscriptions.every((s) => s.mode === 'notify' && s.on_poison === 'drop')).toBe(true);
  });
});

describe('SSE 핸들러 (끊긴 연결 · 느린 클라이언트)', () => {
  type RawStub = EventEmitter & {
    destroyed: boolean;
    writableLength: number;
    writableNeedDrain: boolean;
    writeHead(): void;
    write(): boolean;
    end(): void;
    destroy(): void;
  };
  const rawStub = (o: { destroyed: boolean; writableLength?: number }): RawStub => {
    const raw: RawStub = Object.assign(new EventEmitter(), {
      destroyed: o.destroyed,
      writableLength: o.writableLength ?? 0,
      writableNeedDrain: false,
      writeHead: (): void => undefined,
      write: (): boolean => true,
      end: (): void => undefined,
      destroy: (): void => {
        raw.destroyed = true;
        raw.emit('close');
      },
    });
    return raw;
  };
  const invoke = (h: ReturnType<typeof hub>, raw: RawStub): Promise<void> => {
    const ctx = {
      sessionReader: { read: () => ({ sid: 'sid-1' }) },
      hub: h,
    } as unknown as GatewayContext;
    const handler = createStreamHandler(ctx);
    const route = { requestId: fixedUlid(5), raw: { headers: {}, socket: { destroyed: raw.destroyed } } };
    const reply = { hijack: (): void => undefined, raw };
    return handler(
      route as unknown as Parameters<typeof handler>[0],
      reply as unknown as Parameters<typeof handler>[1],
    );
  };

  it('UT-GW-067 인증 중 이미 끊긴 요청(raw.destroyed) → open 직후 연결 해제 · 열려 있는 연결은 close 이벤트로 해제 · 버퍼 상한 초과 → destroy로 해제 [IR-016][STD-ASY-10]', async () => {
    // Arrange / Act: 이미 끊긴 요청
    const h = hub();
    await invoke(h, rawStub({ destroyed: true }));
    // Assert: 연결이 허브에 남지 않는다(8개 한도·active_streams 누수 0)
    expect(h.activeStreams()).toBe(0);
    // Act: 정상 연결 → close 이벤트
    const live = rawStub({ destroyed: false });
    await invoke(h, live);
    expect(h.activeStreams()).toBe(1);
    live.emit('close');
    expect(h.activeStreams()).toBe(0);
    // Act: 쓰기 버퍼가 상한을 넘은 느린 클라이언트 — 다음 쓰기(하트비트·이벤트)에서 destroy
    const slow = rawStub({ destroyed: false });
    await invoke(h, slow);
    expect(h.activeStreams()).toBe(1);
    slow.writableLength = GATEWAY_LIMITS.sseMaxBufferedBytes + 1;
    h.publish([event(1)]);
    expect(slow.destroyed).toBe(true);
    expect(h.activeStreams()).toBe(0);
  });
});

async function listening(r: Rig): Promise<number> {
  await r.app.fastify.listen({ host: '127.0.0.1', port: 0 });
  return (r.app.fastify.server.address() as AddressInfo).port;
}
async function stream(
  port: number,
  s: { headers(): Record<string, string> },
  extra: Record<string, string> = {},
): Promise<SseConn> {
  const res = await openSse(port, { host: HOST, ...s.headers(), ...extra });
  if (res.kind !== 'stream') {
    throw new Error(`expected stream, got ${res.status}`);
  }
  await res.conn.waitFor('event: hello');
  return res.conn;
}
const deliver = (
  r: Rig,
  auth: Record<string, string>,
  producer: string,
  events: IntegrationEventEnvelope[],
): ReturnType<Rig['inject']> => r.inject('POST', '/internal/v1/inbox', { headers: auth, body: { producer, events } });

describe('SSE 라우트 (실 소켓)', () => {
  it('UT-GW-065 응답 헤더 3종(text/event-stream; charset=utf-8·no-store·x-accel-buffering: no) + retry 첫 출력 [IR-016][NFR-AVL-005]', async () => {
    const r = await makeRig();
    rigs.push(r);
    const port = await listening(r);
    const s = await r.login();
    const conn = await stream(port, s);
    expect(conn.status).toBe(200);
    expect(conn.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(conn.headers['cache-control']).toBe('no-store');
    expect(conn.headers['x-accel-buffering']).toBe('no');
    expect(conn.text().startsWith('retry: 2000\n\n')).toBe(true);
    conn.close();
  });

  it('UT-GW-058 같은 세션 9번째 연결 → 429 GW-LIMIT-002(하이잭 전 problem+json), 하나 닫으면 다시 허용, 다른 세션 독립 [NFR-SEC-017][IF-GW-005]', async () => {
    // Arrange
    const r = await makeRig();
    rigs.push(r);
    const port = await listening(r);
    const a = await r.login();
    const b = await r.login();
    const open: SseConn[] = [];
    for (let i = 0; i < 8; i += 1) {
      open.push(await stream(port, a));
    }
    // Act
    const ninth = await openSse(port, { host: HOST, ...a.headers() });
    // Assert
    expect(ninth.kind).toBe('problem');
    if (ninth.kind === 'problem') {
      expect(ninth.status).toBe(429);
      expect(Problem.parse(JSON.parse(ninth.body)).code).toBe('GW-LIMIT-002');
      expect(ninth.headers['content-type']).toContain('application/problem+json');
    }
    const independent = await stream(port, b);
    independent.close();
    open[0]?.close();
    await vi.waitFor(async () => {
      const again = await openSse(port, { host: HOST, ...a.headers() });
      expect(again.kind).toBe('stream');
      if (again.kind === 'stream') {
        again.conn.close();
      }
    });
    for (const c of open) {
      c.close();
    }
  });

  it('UT-GW-059 POST /internal/v1/inbox(content 토큰, gateway 구독 type) → ack + 연결 클라이언트 수신, 미구독 type → 송신 0 [IR-016][FR-AI-003]', async () => {
    // Arrange
    const r = await makeRig();
    rigs.push(r);
    const port = await listening(r);
    const conn = await stream(port, await r.login());
    // Act
    const subscribed = await deliver(r, CONTENT_AUTH, 'content', [
      event(1, 'catalog.pack.activated', { pack_id: 'k8s' }),
    ]);
    const unsubscribed = await deliver(r, CONTENT_AUTH, 'content', [event(2, 'catalog.concept.changed')]);
    // Assert
    expect(subscribed.status).toBe(200);
    expect(JSON.parse(subscribed.body)).toEqual({ acked_through_seq: 1 });
    expect(unsubscribed.status).toBe(200);
    await conn.waitFor('event: catalog.pack.activated');
    expect(conn.text()).toContain(`id: ${BOOT_ID}.1\nevent: catalog.pack.activated\n`);
    expect(conn.text()).not.toContain('catalog.concept.changed');
    conn.close();
  });

  it('UT-GW-060 hello ai_mode 초기 OFFLINE, ai.mode.changed{FULL} 후 새 연결 hello ai_mode FULL [IR-016][FR-AI-003]', async () => {
    const r = await makeRig();
    rigs.push(r);
    const port = await listening(r);
    const s = await r.login();
    const first = await stream(port, s);
    expect(first.text()).toContain('"ai_mode":"OFFLINE"');
    const aiEvent: IntegrationEventEnvelope = {
      ...event(1, 'ai.mode.changed', { mode: 'FULL', changed_at: 1 }),
      producer: 'ai-gateway',
    };
    expect((await deliver(r, AI_AUTH, 'ai-gateway', [aiEvent])).status).toBe(200);
    const second = await stream(port, s);
    expect(second.text()).toContain('"ai_mode":"FULL"');
    first.close();
    second.close();
  });

  it('UT-GW-061 종료(onShutdown 훅 실행) → 열린 스트림 전부 end·activeStreams = 0 [NFR-AVL-005][IF-COM-004]', async () => {
    // Arrange
    const r = await makeRig();
    rigs.push(r);
    const port = await listening(r);
    const s = await r.login();
    const conns = [await stream(port, s), await stream(port, s)];
    const active = async (): Promise<number> =>
      ActivityView.parse((await r.inject('GET', '/internal/v1/activity', { headers: OPS_AUTH })).json()).active_streams;
    expect(await active()).toBe(2);
    // Act
    for (const hook of r.internals.shutdownHooks) {
      await hook();
    }
    // Assert
    await Promise.all(conns.map((c) => c.closed()));
    expect(await active()).toBe(0);
  });
});
