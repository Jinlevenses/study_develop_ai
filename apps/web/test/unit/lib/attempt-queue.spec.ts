import 'fake-indexeddb/auto';
import { SessionsAttemptsSubmitRoute } from '@fathom/contracts/http/gateway/v1/sessions';
import { createFakeClock, FIXED_EPOCH_MS } from '@fathom/testkit/clock';
import { openDB } from 'idb';
import { describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../../../src/lib/api-client.js';
import { createApiClient } from '../../../src/lib/api-client.js';
import {
  type AttemptRecord,
  openAttemptQueue,
  RETENTION_MS,
  type SendOutcome,
} from '../../../src/lib/attempt-queue.js';
import { createCsrfStore } from '../../../src/lib/csrf.js';
import {
  attemptPayload,
  fakeFetch,
  manualTimers,
  newAttempt,
  problemBody,
  problemResponse,
  ULID_A,
  ULID_B,
} from './support/fixtures.js';

let dbSeq = 0;
const nextDb = (): string => {
  dbSeq += 1;
  return `attempts-test-${String(dbSeq)}`;
};

const ok = (data: unknown = { status: 'graded' }): ApiResult<unknown> => ({
  ok: true,
  status: 200,
  data,
  replayed: false,
});
const prob = (status: number, code: string, extra: Parameters<typeof problemBody>[2] = {}): ApiResult<unknown> => ({
  ok: false,
  kind: 'problem',
  status,
  problem: problemBody(status, code, extra),
});
const net: ApiResult<unknown> = { ok: false, kind: 'network', message: 'offline' };

async function harness(
  responses: ApiResult<unknown>[] | ((rec: AttemptRecord) => ApiResult<unknown>),
  dbName = nextDb(),
) {
  const clock = createFakeClock();
  const timers = manualTimers();
  const sent: AttemptRecord[] = [];
  let i = 0;
  const onChange = vi.fn();
  const onSent = vi.fn();
  const send = vi.fn((rec: AttemptRecord): Promise<ApiResult<unknown>> => {
    sent.push(rec);
    if (typeof responses === 'function') {
      return Promise.resolve(responses(rec));
    }
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return Promise.resolve(r ?? ok());
  });
  const queue = await openAttemptQueue({ send, now: () => clock.now(), ...timers, dbName, onChange, onSent });
  return { queue, clock, timers, sent, send, onChange, onSent, dbName };
}

describe('attempt-queue', () => {
  it('UT-WEB-001 submit은 put이 send보다 먼저고 200은 삭제·sent, 503은 유지·retrying 지연 1000 → 2000 → 4000이다 [NFR-AVL-002][NFR-AVL-011]', async () => {
    const seen: boolean[] = [];
    const h = await harness([
      prob(503, 'LR-DEP-001', { retryable: true }),
      prob(503, 'LR-DEP-001', { retryable: true }),
      prob(503, 'LR-DEP-001', { retryable: true }),
      ok(),
    ]);
    h.send.mockImplementation(async (rec) => {
      const stored = await h.queue.list();
      seen.push(stored.some((r) => r.idempotency_key === rec.idempotency_key));
      const n = seen.length;
      return n < 4 ? prob(503, 'LR-DEP-001', { retryable: true }) : ok({ done: true });
    });
    const first = await h.queue.submit(newAttempt(ULID_A));
    expect(first).toEqual({ kind: 'retrying', delayMs: 1000, code: 'LR-DEP-001' });
    expect(await h.queue.list()).toHaveLength(1);
    expect(h.timers.pending().map((t) => t.ms)).toEqual([1000]);

    expect(h.timers.fire()).toBe(1000);
    await h.queue.flush();
    expect(h.timers.pending().map((t) => t.ms)).toEqual([2000]);
    expect(h.timers.fire()).toBe(2000);
    await h.queue.flush();
    expect(h.timers.pending().map((t) => t.ms)).toEqual([4000]);
    expect(h.timers.fire()).toBe(4000);
    await h.queue.flush();
    expect(seen).toEqual([true, true, true, true]);
    expect(await h.queue.list()).toHaveLength(0);
    expect(h.onSent).toHaveBeenCalledWith(ULID_A, { done: true });
    expect(h.queue.counts()).toEqual({ pending: 0, sending: 0, failed_permanent: 0, retryInMs: null });
    h.queue.close();
  });

  it('UT-WEB-002 재전송 3회 모두 같은 idempotency_key가 send에 전달되고 api-client 경유 시 idempotency-key 헤더도 같다 [NFR-AVL-011][IF-GW-020]', async () => {
    const f = fakeFetch(() => problemResponse(503, 'LR-DEP-001', { retryable: true }));
    const csrf = createCsrfStore();
    const api = createApiClient({ fetch: f.fetch, csrf, newKey: () => 'SHOULD-NOT-BE-USED' });
    const keys: string[] = [];
    const clock = createFakeClock();
    const timers = manualTimers();
    const queue = await openAttemptQueue({
      send: (rec) => {
        keys.push(rec.idempotency_key);
        return api.call(
          SessionsAttemptsSubmitRoute,
          { params: { session_id: rec.session_id }, body: rec.payload },
          { idempotencyKey: rec.idempotency_key },
        );
      },
      now: () => clock.now(),
      ...timers,
      dbName: nextDb(),
    });
    await queue.submit(newAttempt(ULID_A));
    timers.fire();
    await queue.flush();
    timers.fire();
    await queue.flush();
    expect(keys).toEqual([ULID_A, ULID_A, ULID_A]);
    expect(f.calls.map((c) => c.headers['idempotency-key'])).toEqual([ULID_A, ULID_A, ULID_A]);
    expect(f.calls[0]?.url).toBe(`/api/v1/sessions/${ULID_A}/attempts`);
    queue.close();
  });

  it('UT-WEB-019 400·404·422·409 비-in-flight는 failed_permanent+코드, 409 CONFLICT-002는 retrying, 429는 retry_after_ms 지연이다 [IF-01 §2.5][NFR-AVL-011]', async () => {
    const cases: [ApiResult<unknown>, SendOutcome][] = [
      [prob(400, 'LR-VAL-001'), { kind: 'failed_permanent', code: 'LR-VAL-001' }],
      [prob(404, 'LR-NOTFOUND-001'), { kind: 'failed_permanent', code: 'LR-NOTFOUND-001' }],
      [prob(422, 'LR-VAL-002'), { kind: 'failed_permanent', code: 'LR-VAL-002' }],
      [prob(409, 'LR-CONFLICT-010'), { kind: 'failed_permanent', code: 'LR-CONFLICT-010' }],
      [prob(409, 'LR-CONFLICT-002', { retryable: true }), { kind: 'retrying', delayMs: 1000, code: 'LR-CONFLICT-002' }],
      [prob(429, 'LR-LIMIT-001', { retry_after_ms: 2500 }), { kind: 'retrying', delayMs: 2500, code: 'LR-LIMIT-001' }],
      [prob(429, 'LR-LIMIT-001'), { kind: 'retrying', delayMs: 1000, code: 'LR-LIMIT-001' }],
      [net, { kind: 'retrying', delayMs: 1000, code: null }],
      [
        { ok: false, kind: 'contract', status: 200, detail: 'x' },
        { kind: 'failed_permanent', code: 'WEB-CONTRACT' },
      ],
    ];
    for (const [result, expected] of cases) {
      const h = await harness([result]);
      expect(await h.queue.submit(newAttempt(ULID_A))).toEqual(expected);
      const [rec] = await h.queue.list();
      expect(rec?.state).toBe(expected.kind === 'failed_permanent' ? 'failed_permanent' : 'pending');
      expect(rec?.last_error_code).toBe(
        expected.kind === 'failed_permanent' ? expected.code : expected.kind === 'retrying' ? expected.code : null,
      );
      h.queue.close();
    }
  });

  it('UT-WEB-020 500 연속은 시도 1~3이 retrying이고 4번째가 failed_permanent다 [NFR-AVL-011]', async () => {
    const h = await harness([prob(500, 'LR-INTERNAL-001')]);
    const outcomes: SendOutcome[] = [await h.queue.submit(newAttempt(ULID_A))];
    for (let n = 0; n < 3; n += 1) {
      h.timers.fire();
      await h.queue.flush();
      const [rec] = await h.queue.list();
      outcomes.push(
        rec?.state === 'failed_permanent'
          ? { kind: 'failed_permanent', code: rec.last_error_code ?? '' }
          : { kind: 'retrying', delayMs: 0, code: rec?.last_error_code ?? null },
      );
    }
    expect(outcomes.map((o) => o.kind)).toEqual(['retrying', 'retrying', 'retrying', 'failed_permanent']);
    expect(h.send).toHaveBeenCalledTimes(4);
    expect(h.queue.counts().failed_permanent).toBe(1);
    h.queue.close();
  });

  it('UT-WEB-021 지연 상한은 tries 1..7에서 1000·2000·4000·8000·16000·30000·30000이다 [NFR-AVL-011]', async () => {
    const h = await harness([net]);
    const delays: number[] = [];
    const first = await h.queue.submit(newAttempt(ULID_A));
    if (first.kind === 'retrying') {
      delays.push(first.delayMs);
    }
    for (let n = 1; n < 7; n += 1) {
      h.timers.fire();
      await h.queue.flush();
      delays.push(h.timers.pending().at(-1)?.ms ?? -1);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    h.queue.close();
  });

  it('UT-WEB-022 open 시 8일 전 레코드는 삭제·7일 미만은 유지하고 잔존 sending은 pending으로 되돌려 flush한다 [NFR-AVL-002]', async () => {
    const dbName = nextDb();
    const now = FIXED_EPOCH_MS;
    const seed = await openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore('attempts', { keyPath: 'idempotency_key' });
      },
    });
    const rec = (key: string, createdAt: number, state: AttemptRecord['state']): AttemptRecord => ({
      ...newAttempt(key),
      payload: attemptPayload(key),
      created_at: createdAt,
      tries: 1,
      state,
      last_error_code: null,
    });
    const OLD = '01J000000000000000000000OL'.replace('O', '0');
    await seed.put('attempts', rec(OLD, now - 8 * 86_400_000, 'pending'));
    await seed.put('attempts', rec('01J0000000000000000000000F', now - (RETENTION_MS - 1000), 'pending'));
    await seed.put('attempts', rec('01J0000000000000000000000S', now - 1000, 'sending'));
    await seed.put('attempts', rec('01J0000000000000000000000X', now - 500, 'failed_permanent'));
    seed.close();

    const h = await harness([ok()], dbName);
    await h.queue.flush();
    const keys = (await h.queue.list()).map((r) => r.idempotency_key);
    expect(keys).toEqual(['01J0000000000000000000000X']); // 나머지는 전송되어 삭제, 오래된 것은 청소
    expect(h.sent.map((r) => r.idempotency_key).sort()).toEqual([
      '01J0000000000000000000000F',
      '01J0000000000000000000000S',
    ]);
    expect(h.sent.some((r) => r.idempotency_key === OLD)).toBe(false);
    h.queue.close();
  });

  it('UT-WEB-023 flush는 created_at 순서·동시 호출 한 번·online 이벤트·retryNow·discard·counts·onChange를 지킨다 [NFR-AVL-002]', async () => {
    const h = await harness([net]);
    const A = '01J0000000000000000000000A';
    const B = '01J0000000000000000000000B';
    const C = '01J0000000000000000000000C';
    await h.queue.submit(newAttempt(B));
    h.clock.advance(1000);
    await h.queue.submit(newAttempt(A));
    h.clock.advance(1000);
    await h.queue.submit(newAttempt(C));
    h.sent.length = 0;

    // 첫 레코드가 retrying이면 뒤 레코드는 보내지 않는다(순서 보존)
    await h.queue.flush();
    expect(h.sent.map((r) => r.idempotency_key)).toEqual([B]);

    // 성공으로 바꾸면 created_at 오름차순(B → A → C)
    h.send.mockImplementation((rec) => {
      h.sent.push(rec);
      return Promise.resolve(ok());
    });
    h.sent.length = 0;
    const p1 = h.queue.flush();
    const p2 = h.queue.flush();
    expect(p1).toBe(p2);
    await p1;
    expect(h.sent.map((r) => r.idempotency_key)).toEqual([B, A, C]);
    expect(h.queue.counts()).toMatchObject({ pending: 0, sending: 0, failed_permanent: 0 });

    // online 이벤트 → flush
    h.send.mockImplementation((rec) => {
      h.sent.push(rec);
      return Promise.resolve(net);
    });
    await h.queue.submit(newAttempt(A));
    h.sent.length = 0;
    h.send.mockImplementation((rec) => {
      h.sent.push(rec);
      return Promise.resolve(ok());
    });
    window.dispatchEvent(new Event('online'));
    await h.queue.flush();
    expect(h.sent.map((r) => r.idempotency_key)).toEqual([A]);

    // retryNow · discard
    h.send.mockImplementation(() => Promise.resolve(prob(400, 'LR-VAL-001')));
    await h.queue.submit(newAttempt(C));
    expect(h.queue.counts().failed_permanent).toBe(1);
    h.send.mockImplementation(() => Promise.resolve(ok()));
    expect(await h.queue.retryNow(C)).toEqual({ kind: 'sent', response: { status: 'graded' } });
    expect(await h.queue.retryNow(C)).toEqual({ kind: 'failed_permanent', code: 'WEB-NOT-FOUND' });
    h.send.mockImplementation(() => Promise.resolve(prob(400, 'LR-VAL-001')));
    await h.queue.submit(newAttempt(B));
    await h.queue.discard(B);
    expect(await h.queue.list()).toHaveLength(0);
    expect(h.onChange).toHaveBeenCalled();
    h.queue.close();
    window.dispatchEvent(new Event('online')); // close 이후에는 무시
  });

  it('UT-WEB-024 DB fathom-attempts v1·store attempts·keyPath·인덱스 0·레코드 키 집합 고정, 본문 attempt_id ≠ key는 TypeError다 [NFR-AVL-002]', async () => {
    const h = await harness([net], 'fathom-attempts');
    await h.queue.submit(newAttempt(ULID_A));
    const db = await openDB('fathom-attempts');
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames]).toEqual(['attempts']);
    const tx = db.transaction('attempts');
    expect(tx.store.keyPath).toBe('idempotency_key');
    expect([...tx.store.indexNames]).toEqual([]);
    const [rec] = await tx.store.getAll();
    expect(Object.keys(rec ?? {}).sort()).toEqual(
      [
        'answered_at',
        'block_id',
        'created_at',
        'idempotency_key',
        'item_id',
        'last_error_code',
        'payload',
        'session_id',
        'state',
        'tries',
      ].sort(),
    );
    expect(rec).toMatchObject({ tries: 1, state: 'pending', created_at: FIXED_EPOCH_MS });
    db.close();
    await expect(
      h.queue.submit({ ...newAttempt(ULID_A), idempotency_key: '01J0000000000000000000000Z' }),
    ).rejects.toBeInstanceOf(TypeError);
    h.queue.close();
  });

  it('UT-WEB-023 send가 reject하면 sending에 멈추지 않고 network 결과로 pending·백오프이며, flush 도중 영구 실패로 바뀐 레코드는 다시 보내지 않는다 [NFR-AVL-002][NFR-AVL-011]', async () => {
    const h = await harness([net]);
    h.send.mockImplementation(() => Promise.reject(new Error('res.text() 실패')));
    const outcome = await h.queue.submit(newAttempt(ULID_A));
    expect(outcome).toEqual({ kind: 'retrying', delayMs: 1000, code: null });
    expect(h.queue.counts()).toMatchObject({ pending: 1, sending: 0, failed_permanent: 0 });
    expect((await h.queue.list())[0]).toMatchObject({ state: 'pending', tries: 1 });
    h.queue.close();

    const g = await harness([net]);
    await g.queue.submit(newAttempt(ULID_A));
    await g.queue.submit(newAttempt(ULID_B));
    let releaseA: (r: ApiResult<unknown>) => void = () => undefined;
    g.send.mockImplementation((rec) =>
      rec.idempotency_key === ULID_A
        ? new Promise<ApiResult<unknown>>((resolve) => {
            releaseA = resolve;
          })
        : Promise.resolve(prob(400, 'LR-VALIDATION-001')),
    );
    g.send.mockClear();
    const flushing = g.queue.flush();
    await vi.waitFor(() => expect(g.send).toHaveBeenCalledTimes(1)); // A가 전송 중(스냅샷에는 A·B 둘 다 있다)
    expect(await g.queue.retryNow(ULID_B)).toEqual({ kind: 'failed_permanent', code: 'LR-VALIDATION-001' });
    releaseA(ok());
    await flushing;
    const bSends = g.send.mock.calls.filter(([rec]) => rec.idempotency_key === ULID_B);
    expect(bSends).toHaveLength(1);
    expect((await g.queue.list()).map((r) => [r.idempotency_key, r.state, r.tries])).toEqual([
      [ULID_B, 'failed_permanent', 2],
    ]);
    g.queue.close();
  });
});
