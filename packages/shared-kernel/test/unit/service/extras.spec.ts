import { Problem } from '@fathom/contracts/common/problem';
import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { InboxConfig } from '../../../src/eventing/inbox.js';
import { defineInboxHandler } from '../../../src/eventing/inbox.js';
import { appendEvent } from '../../../src/eventing/outbox.js';
import { toFastifyPath } from '../../../src/service/route-path.js';
import { nfcDeep } from '../../../src/service/route-runner.js';
import { startMaintenanceTimers } from '../../../src/service/timers.js';
import { captureLogger, openInfraDb, PAYLOADS } from '../eventing/support.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, LEARNING, rigOf } from './support.js';

const rigs: Rig[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

const json = { 'content-type': 'application/json; charset=utf-8' };
const ev = (seq: number, type = 'a.b.c', payload: unknown = { n: seq }) => ({
  event_id: fixedUlid(seq),
  type,
  schema_version: 1,
  producer: 'learning',
  producer_seq: seq,
  occurred_at: 1_790_000_000_000,
  correlation_id: fixedUlid(900),
  causation_id: null,
  traceparent: null,
  payload,
});

describe('inbox 라우트', () => {
  const V1 = { 1: z.object({ n: z.number().int() }).strict() } as const;
  const inbox = (onPoison: 'halt' | 'dead_letter', fail: (n: number) => boolean): InboxConfig => ({
    mode: 'durable',
    manifest: {
      consumer: 'content',
      subscriptions: [{ type: 'a.b.c', schema_versions: [1], mode: 'durable', on_poison: onPoison, reads: ['n'] }],
    },
    handlers: [
      defineInboxHandler('a.b.c', V1, (_e, p) => {
        if (fail(p.n)) {
          throw new Error('poison');
        }
      }),
    ],
  });
  const deliver = (rig: Rig, body: unknown, headers: Record<string, string> = LEARNING, attempt?: string) =>
    rig.app.fastify.inject({
      method: 'POST',
      url: '/internal/v1/inbox',
      headers: { ...json, ...headers, ...(attempt === undefined ? {} : { 'x-fathom-delivery-attempt': attempt }) },
      payload: JSON.stringify(body),
    });

  it('UT-SK-152 ack → 200 {acked_through_seq}·producer 불일치 403 ACL-900·seq 비증가 400 VAL-900 [IF-COM-004]', async () => {
    // Arrange
    const rig = await rigOf({ ...defOf('content'), inbox: inbox('halt', () => false) });
    rigs.push(rig);
    // Act / Assert
    const ok = await deliver(rig, { producer: 'learning', events: [ev(1), ev(2)] });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ acked_through_seq: 2 });
    const mismatch = await deliver(rig, { producer: 'learning', events: [ev(3)] }, GATEWAY); // gateway 토큰으로 learning 이벤트
    expect(mismatch.statusCode).toBe(403);
    expect(Problem.parse(JSON.parse(mismatch.body)).code).toBe('CT-ACL-900');
    const order = await deliver(rig, { producer: 'learning', events: [ev(5), ev(5)] });
    expect(order.statusCode).toBe(400);
    expect(Problem.parse(JSON.parse(order.body)).errors?.[0]?.rule).toBe('producer_seq_order');
    // 계약 위반(빈 이벤트)은 파이프라인 검증이 먼저 400
    expect((await deliver(rig, { producer: 'learning', events: [] })).statusCode).toBe(400);
    // 라우트별 본문 한도(inbox 8 MiB)는 기본 256 KiB를 넘어도 받는다
    const big = await deliver(rig, { producer: 'learning', events: [ev(9, 'x.y.z', { blob: 'z'.repeat(400_000) })] });
    expect(big.statusCode).toBe(200);
    expect(JSON.parse(big.body)).toEqual({ acked_through_seq: 9 });
  });

  it('UT-SK-014 halt → 503 CT-DEP-910 + acked_through_seq + retry-after, dead_letter는 x-fathom-delivery-attempt ≥ 3에서 격리 [IF-COM-004][NFR-AVL-005]', async () => {
    // Arrange
    const haltRig = await rigOf({ ...defOf('content'), inbox: inbox('halt', (n) => n === 2) });
    const deadRig = await rigOf({ ...defOf('content'), inbox: inbox('dead_letter', (n) => n === 2) });
    rigs.push(haltRig, deadRig);
    const body = { producer: 'learning', events: [ev(1), ev(2), ev(3)] };
    // Act / Assert: halt
    const halted = await deliver(haltRig, body);
    expect(halted.statusCode).toBe(503);
    expect(halted.headers['retry-after']).toBe('1');
    expect(Problem.parse(JSON.parse(halted.body))).toMatchObject({
      code: 'CT-DEP-910',
      retryable: true,
      acked_through_seq: 1,
    });
    // dead_letter: attempt 헤더가 없거나 무효면 1로 본다 → ack(직전 seq)
    for (const attempt of [undefined, 'abc', '0', '2']) {
      const r = await deliver(deadRig, body, LEARNING, attempt);
      expect(JSON.parse(r.body), String(attempt)).toEqual({ acked_through_seq: 1 });
    }
    expect(deadRig.db?.prepare('SELECT count(*) AS n FROM inbox_dead').get()).toEqual({ n: 0 });
    const third = await deliver(deadRig, body, LEARNING, '3');
    expect(JSON.parse(third.body)).toEqual({ acked_through_seq: 3 });
    expect(deadRig.db?.prepare('SELECT event_id, attempts FROM inbox_dead').get()).toEqual({
      event_id: fixedUlid(2),
      attempts: 3,
    });
  });
});

describe('outbox ↔ 요청 컨텍스트', () => {
  it('UT-SK-140 핸들러 안 appendEvent의 traceparent = 요청의 traceparent, 롤백되면 행 없음 [NFR-DATA-013][IF-COM-004]', async () => {
    // Arrange
    const AppendRoute = defineRoute({
      ifId: 'IF-CT-001',
      paginated: false,
      freeze: 'O',
      slice: 'R0',
      fr: [],
      id: 'content.test.append',
      method: 'POST',
      path: '/internal/v1/test/append',
      allowedCallers: ['gateway'],
      idempotent: true,
      request: { body: S({ fail: z.boolean() }) },
      response: { 201: S({ seq: z.number().int(), traceparent: z.string() }) },
    });
    const def = {
      ...defOf('content'),
      events: { payloads: PAYLOADS, routing: {} },
      register: (
        app: Parameters<ReturnType<typeof defOf>['register']>[0],
        deps: Parameters<ReturnType<typeof defOf>['register']>[1],
      ) => {
        const outbox = deps.outbox;
        if (outbox === null) {
          throw new Error('outbox expected');
        }
        app.route(AppendRoute, (ctx) => {
          const out = outbox.db.tx(() => {
            const r = appendEvent(outbox, {
              type: 'a.b.c',
              schema_version: 1,
              correlation_id: fixedUlid(1),
              payload: { n: 1 },
            });
            if (ctx.body.fail) {
              throw new Error('state change failed');
            }
            return r;
          });
          return Promise.resolve({ status: 201, body: { seq: out.seq, traceparent: ctx.traceparent } });
        });
      },
    };
    const rig = await rigOf(def);
    rigs.push(rig);
    const call = (fail: boolean, k: number) =>
      rig.app.fastify.inject({
        method: 'POST',
        url: '/internal/v1/test/append',
        headers: {
          ...json,
          ...GATEWAY,
          'idempotency-key': fixedUlid(k),
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        },
        payload: JSON.stringify({ fail }),
      });
    // Act
    const failed = await call(true, 10);
    const ok = await call(false, 11);
    // Assert
    expect(failed.statusCode).toBe(500);
    expect(ok.statusCode).toBe(201);
    const body = JSON.parse(ok.body) as { seq: number; traceparent: string };
    expect(rig.db?.prepare('SELECT count(*) AS n FROM outbox').get()).toEqual({ n: 1 }); // 롤백된 것은 없다
    expect(rig.db?.prepare('SELECT traceparent FROM outbox WHERE seq = :s').get({ s: body.seq })).toEqual({
      traceparent: body.traceparent,
    });
    expect(body.traceparent).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
  });
});

describe('작은 부품', () => {
  it('toFastifyPath: {name} → :name, 콜론 동사 → ::, 둘 다 [§4.4]', () => {
    expect(toFastifyPath('/internal/v1/items/{id}')).toBe('/internal/v1/items/:id');
    expect(toFastifyPath('/internal/v1/items:select')).toBe('/internal/v1/items::select');
    expect(toFastifyPath('/internal/v1/items/{id}:retry')).toBe('/internal/v1/items/:id::retry');
    expect(toFastifyPath('/healthz')).toBe('/healthz');
  });

  it('nfcDeep: 문자열 값 NFC·원 객체 불변·깊이 32 초과 → 400 [STD-API-35]', () => {
    const nfd = '한'.normalize('NFD');
    const input = { a: nfd, b: [nfd, { c: nfd }], n: 1, nil: null };
    const out = nfcDeep(input, 'content');
    expect(out).toEqual({ a: '한', b: ['한', { c: '한' }], n: 1, nil: null });
    expect(input.a).toBe(nfd);
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 40; i += 1) {
      deep = { d: deep };
    }
    expect(() => nfcDeep(deep, 'content')).toThrow(expect.objectContaining({ code: 'CT-VAL-900', status: 400 }));
  });

  it('startMaintenanceTimers: 5분 뒤 첫 정리 + 10분마다·5분마다 체크포인트·quiesce 중 건너뜀·stop 후 0 [§4.9]', async () => {
    // Arrange
    vi.useFakeTimers();
    const clock = createFakeClock();
    const db = openInfraDb(clock);
    const old = clock.now() - 8 * 86_400_000;
    db.prepare(
      "INSERT INTO idem_request(key, caller, route_id, request_hash, status, response_json, created_at) VALUES ('k1', 'gateway', 'r', 'h', 200, '{}', :c)",
    ).run({ c: old });
    let paused = false;
    const checkpoints: string[] = [];
    const spy = {
      ...db,
      prepare: (sql: string) => {
        checkpoints.push(sql);
        return db.prepare(sql);
      },
    };
    const timers = startMaintenanceTimers({
      clock,
      log: captureLogger(clock).log,
      fullDb: db,
      writeDbs: [spy],
      isPaused: () => paused,
    });
    const count = (): number => Number(db.prepare('SELECT count(*) AS n FROM idem_request').get()?.n);
    // Act / Assert
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(count()).toBe(1);
    expect(checkpoints).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(count()).toBe(0); // 5분 뒤 첫 정리
    expect(checkpoints).toEqual(['PRAGMA wal_checkpoint(PASSIVE)']); // 5분마다 체크포인트
    paused = true;
    db.prepare(
      "INSERT INTO idem_request(key, caller, route_id, request_hash, status, response_json, created_at) VALUES ('k2', 'gateway', 'r', 'h', 200, '{}', :c)",
    ).run({ c: old });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(count()).toBe(1); // quiesce 중에는 정리·체크포인트를 건너뛴다
    expect(checkpoints).toHaveLength(1);
    paused = false;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(count()).toBe(0);
    expect(checkpoints.length).toBeGreaterThan(1);
    timers.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
