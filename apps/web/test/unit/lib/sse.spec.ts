import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../src/lib/api-client.js';
import { createCsrfStore } from '../../../src/lib/csrf.js';
import type { Invalidation } from '../../../src/lib/invalidation-map.js';
import { createSseConnection } from '../../../src/lib/sse.js';
import { EVENT_FIXTURES, sseData } from './support/events.js';
import { FakeEventSource } from './support/fake-event-source.js';
import { fakeFetch, jsonResponse, manualTimers, problemResponse, ULID_A } from './support/fixtures.js';

const HELLO = (mode = 'FULL'): string =>
  JSON.stringify({ boot_id: ULID_A, hub_seq: 0, server_time: 1_790_000_000_000, app_version: '0.0.0', ai_mode: mode });

function setup(statusResponse: () => Response | Error = () => jsonResponse(200, {}), flush = vi.fn()) {
  FakeEventSource.instances = [];
  const timers = manualTimers();
  const f = fakeFetch(statusResponse as () => Response);
  const api = createApiClient({ fetch: f.fetch, csrf: createCsrfStore(), newKey: () => 'K' });
  const invalidate = vi.fn<(inv: Invalidation) => void>();
  const onSessionLost = vi.fn();
  const onResync = vi.fn();
  const conn = createSseConnection({
    EventSourceCtor: FakeEventSource,
    invalidate,
    api,
    onSessionLost,
    onResync,
    onFlushAttempts: flush,
    ...timers,
  });
  const es = (i = 0): FakeEventSource => {
    const e = FakeEventSource.instances[i];
    if (e === undefined) {
      throw new Error('no event source');
    }
    return e;
  };
  return { conn, timers, invalidate, onSessionLost, onResync, flush, es, f };
}

describe('sse', () => {
  it('UT-WEB-025 hello는 open·aiMode·bootId, 타입 이벤트는 invalidate 인자, ai.mode.changed는 aiMode 갱신, 깨진 프레임은 무시하고 subscribe가 통지된다 [IR-016][FR-AI-003]', () => {
    const t = setup();
    expect(t.conn.getSnapshot()).toEqual({ state: 'closed', bootId: null, aiMode: 'OFFLINE', lastEventId: null });
    const notified = vi.fn();
    t.conn.subscribe(notified);
    t.conn.start();
    t.conn.start(); // 중복 start는 새 연결을 만들지 않는다
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(t.es().url).toBe('/api/v1/stream');
    expect(t.es().init).toEqual({ withCredentials: true });
    expect(t.conn.getSnapshot()).toMatchObject({ state: 'connecting', aiMode: 'OFFLINE' });

    t.es().emit('hello', HELLO('FULL'), `${ULID_A}.0`);
    const afterHello = t.conn.getSnapshot();
    expect(afterHello).toEqual({ state: 'open', bootId: ULID_A, aiMode: 'FULL', lastEventId: `${ULID_A}.0` });
    expect(t.invalidate).not.toHaveBeenCalled();
    expect(t.conn.getSnapshot()).toBe(afterHello); // 변경 없으면 같은 객체

    const got = vi.fn();
    const off = t.conn.on('learning.session.completed', got);
    t.es().emit(
      'learning.session.completed',
      sseData('learning.session.completed', EVENT_FIXTURES['learning.session.completed'] ?? {}),
      `${ULID_A}.1`,
    );
    expect(t.invalidate).toHaveBeenLastCalledWith([['home'], ['review', 'weekly']]);
    expect(got).toHaveBeenCalledTimes(1);
    expect(t.conn.getSnapshot().lastEventId).toBe(`${ULID_A}.1`);
    off();
    t.es().emit(
      'learning.session.completed',
      sseData('learning.session.completed', EVENT_FIXTURES['learning.session.completed'] ?? {}),
    );
    expect(got).toHaveBeenCalledTimes(1);

    t.es().emit(
      'ai.mode.changed',
      sseData('ai.mode.changed', { ...EVENT_FIXTURES['ai.mode.changed'], mode: 'JUDGE_ONLY' }),
    );
    expect(t.conn.getSnapshot().aiMode).toBe('JUDGE_ONLY');
    expect(notified).toHaveBeenCalled();

    const calls = t.invalidate.mock.calls.length;
    t.es().emit('learning.mastery.changed', '{깨진 JSON');
    t.es().emit('learning.mastery.changed', JSON.stringify({ type: 'learning.mastery.changed' }));
    t.es().emit(
      'learning.mastery.changed',
      sseData('learning.session.completed', EVENT_FIXTURES['learning.session.completed'] ?? {}),
    ); // type 불일치
    t.es().emit('hello', '{"boot_id":1}');
    expect(t.invalidate.mock.calls).toHaveLength(calls);
    // 스키마는 통과하지만 payload가 계약 위반 → 전체 무효화(IR-016)
    t.es().emit('learning.mastery.changed', sseData('learning.mastery.changed', { concept_id: 1 }));
    expect(t.invalidate).toHaveBeenLastCalledWith('all');

    t.conn.stop();
    expect(t.es().closed).toBe(true);
    expect(t.conn.getSnapshot().state).toBe('closed');
  });

  it('UT-WEB-026 resync는 전체 무효화+onResync, CLOSED는 status 401이면 onSessionLost·재생성 0, 아니면 지연 재생성(1000·2000) 후 첫 hello에서 전체 무효화+reconnected다 [IR-016]', async () => {
    const t = setup(() => jsonResponse(200, { ok: 'but-ignored' }));
    t.conn.start();
    t.es().emit('resync', JSON.stringify({ reason: 'ring_overflow' }));
    expect(t.invalidate).toHaveBeenLastCalledWith('all');
    expect(t.onResync).toHaveBeenLastCalledWith('ring_overflow');
    t.es().emit('resync', JSON.stringify({ reason: 'bogus' }));
    expect(t.onResync).toHaveBeenCalledTimes(1);

    // 브라우저 자동 재연결(CONNECTING)은 건드리지 않는다
    t.es().fail(0);
    expect(t.conn.getSnapshot().state).toBe('reconnecting');
    expect(FakeEventSource.instances).toHaveLength(1);

    // CLOSED → status 200(계약 위반이라도 401 아님) → 지연 1000 후 재생성
    t.es().fail(2);
    await vi.waitFor(() => expect(t.timers.pending().map((x) => x.ms)).toEqual([1000]));
    expect(t.conn.getSnapshot().state).toBe('closed');
    t.timers.fire();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(t.conn.getSnapshot().state).toBe('reconnecting');
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    t.es(1).fail(2);
    await vi.waitFor(() => expect(t.timers.pending().map((x) => x.ms)).toEqual([2000]));
    t.timers.fire();
    expect(FakeEventSource.instances).toHaveLength(3);

    const before = t.invalidate.mock.calls.length;
    t.es(2).emit('hello', HELLO('OFFLINE'));
    expect(t.invalidate.mock.calls).toHaveLength(before + 1);
    expect(t.invalidate).toHaveBeenLastCalledWith('all');
    expect(t.onResync).toHaveBeenLastCalledWith('reconnected');
    // 다음 hello는 일반(전체 무효화 0), 재생성 횟수는 0으로 초기화
    t.es(2).emit('hello', HELLO('OFFLINE'));
    expect(t.invalidate.mock.calls).toHaveLength(before + 1);
    t.es(2).fail(2);
    await vi.waitFor(() => expect(t.timers.pending().map((x) => x.ms)).toEqual([1000]));
    t.conn.stop();
    expect(t.timers.pending()).toHaveLength(0);

    // status 401 → 재생성 0
    const lost = setup(() => problemResponse(401, 'GW-AUTH-001'));
    lost.conn.start();
    lost.es().fail(2);
    await vi.waitFor(() => expect(lost.onSessionLost).toHaveBeenCalledWith('GW-AUTH-001'));
    expect(lost.timers.pending()).toHaveLength(0);
    expect(FakeEventSource.instances).toHaveLength(1);
    lost.conn.stop();
  });

  it('UT-WEB-027 ops.health.changed는 content·learning이 모두 ready일 때만 onFlushAttempts를 1회 부른다 [D-9][NFR-AVL-002]', () => {
    const t = setup();
    t.conn.start();
    const health = (learning: string): string =>
      sseData('ops.health.changed', {
        ...EVENT_FIXTURES['ops.health.changed'],
        services: [
          { svc: 'content', state: 'ready', restarts_60s: 0 },
          { svc: 'learning', state: learning, restarts_60s: 0 },
        ],
      });
    t.es().emit('ops.health.changed', health('degraded'));
    expect(t.flush).not.toHaveBeenCalled();
    t.es().emit('ops.health.changed', health('ready'));
    expect(t.flush).toHaveBeenCalledTimes(1);
    t.es().emit(
      'ops.health.changed',
      sseData('ops.health.changed', {
        ...EVENT_FIXTURES['ops.health.changed'],
        services: [{ svc: 'learning', state: 'ready', restarts_60s: 0 }],
      }),
    );
    expect(t.flush).toHaveBeenCalledTimes(1);
    t.conn.stop();
  });
});
