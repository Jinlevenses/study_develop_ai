import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import type { IdemScope } from '../../../src/idempotency/idempotency.js';
import { createIdempotencyStore, requestHash } from '../../../src/idempotency/idempotency.js';
import { openInfraDb } from '../eventing/support.js';

const DAY = 86_400_000;
const scope = (key = 1, caller: IdemScope['caller'] = 'gateway', routeId = 'content.x.y'): IdemScope => ({
  key: fixedUlid(key),
  caller,
  routeId,
});

function rig() {
  const clock = createFakeClock();
  const db = openInfraDb(clock);
  const store = createIdempotencyStore({ db, clock });
  return { clock, db, store };
}

describe('IdempotencyStore', () => {
  it('UT-SK-164 처리 중 같은 키 → in_flight, complete/abandon이 해제한다 [NFR-AVL-011][IF-COM-005]', () => {
    // Arrange
    const { store } = rig();
    const h = requestHash({ a: 1 });
    // Act / Assert
    expect(store.begin(scope(), h)).toEqual({ kind: 'proceed' });
    expect(store.begin(scope(), h)).toEqual({ kind: 'in_flight' });
    expect(store.begin(scope(), requestHash({ a: 2 }))).toEqual({ kind: 'in_flight' });
    store.abandon(scope());
    expect(store.begin(scope(), h)).toEqual({ kind: 'proceed' });
    store.complete(scope(), h, 200, '{"ok":true}');
    expect(store.begin(scope(), h)).toEqual({ kind: 'replay', status: 200, responseJson: '{"ok":true}' });
  });

  it('UT-SK-165 5xx 미저장(재요청 재처리)·4xx 저장·재생·다른 본문 conflict_body [NFR-AVL-011][IF-COM-005]', () => {
    // Arrange
    const { store, db } = rig();
    const h = requestHash({ a: 1 });
    // Act / Assert: 5xx
    store.begin(scope(1), h);
    store.complete(scope(1), h, 503, '{"problem":1}');
    expect(db.prepare('SELECT count(*) AS n FROM idem_request').get()).toEqual({ n: 0 });
    expect(store.begin(scope(1), h)).toEqual({ kind: 'proceed' });
    // 4xx 저장·재생
    store.complete(scope(1), h, 409, '{"problem":2}');
    expect(store.begin(scope(1), h)).toEqual({ kind: 'replay', status: 409, responseJson: '{"problem":2}' });
    // 같은 키·다른 본문
    expect(store.begin(scope(1), requestHash({ a: 2 }))).toEqual({ kind: 'conflict_body' });
  });

  it('UT-SK-166 (key, caller, route) 범위는 서로 독립이다 [NFR-AVL-011]', () => {
    // Arrange
    const { store } = rig();
    const h = requestHash({});
    store.begin(scope(1, 'gateway', 'r1'), h);
    store.complete(scope(1, 'gateway', 'r1'), h, 200, '{}');
    // Act / Assert
    expect(store.begin(scope(1, 'gateway', 'r1'), h).kind).toBe('replay');
    expect(store.begin(scope(1, 'gateway', 'r2'), h).kind).toBe('proceed');
    expect(store.begin(scope(1, 'learning', 'r1'), h).kind).toBe('proceed');
    expect(store.begin(scope(2, 'gateway', 'r1'), h).kind).toBe('proceed');
  });

  it('UT-SK-167 7일 지난 행 = 없음 취급 후 교체·requestHash는 키 순서 무관·빈 응답은 {} 저장 [NFR-AVL-011][IF-COM-005]', () => {
    // Arrange
    const { store, db, clock } = rig();
    expect(requestHash({ a: 1, b: [1, 2] })).toBe(requestHash({ b: [1, 2], a: 1 }));
    expect(requestHash(undefined)).toBe(requestHash(null));
    const h1 = requestHash({ v: 1 });
    store.begin(scope(), h1);
    store.complete(scope(), h1, 200, '{"v":1}');
    // Act: 정확히 7일 → 아직 유효, 7일 + 1ms → 만료
    clock.advance(7 * DAY);
    expect(store.begin(scope(), h1).kind).toBe('replay');
    clock.advance(1);
    const h2 = requestHash({ v: 2 });
    expect(store.begin(scope(), h2)).toEqual({ kind: 'proceed' }); // 다른 본문이어도 만료라 충돌 아님
    store.complete(scope(), h2, 204, '');
    // Assert: 교체됨
    expect(
      db.prepare('SELECT count(*) AS n, max(response_json) AS r, max(request_hash) AS h FROM idem_request').get(),
    ).toEqual({ n: 1, r: '{}', h: h2 });
  });

  it('UT-SK-168 db: null 저장소는 in-flight만 추적한다 [NFR-AVL-011][IF-COM-005]', () => {
    // Arrange
    const clock = createFakeClock();
    const store = createIdempotencyStore({ db: null, clock });
    const h = requestHash({});
    // Act / Assert
    expect(store.begin(scope(), h).kind).toBe('proceed');
    expect(store.begin(scope(), h).kind).toBe('in_flight');
    store.complete(scope(), h, 200, '{}');
    expect(store.begin(scope(), h).kind).toBe('proceed'); // 저장 없음 — 다시 처리
  });
});
