import { Problem } from '@fathom/contracts/common/problem';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import type { Probes } from '../service/routes.js';
import { fixtureDef } from '../service/routes.js';
import type { Rig } from '../service/support.js';
import { defOf, GATEWAY, rigOf } from '../service/support.js';

const rigs: Rig[] = [];
const probes: Probes = { puts: 0, slowRelease: null, slowStarted: null };
async function make(): Promise<Rig> {
  probes.puts = 0;
  probes.slowRelease = null;
  const rig = await rigOf(fixtureDef(defOf('content'), probes));
  rigs.push(rig);
  return rig;
}
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

const key = (n: number): string => fixedUlid(n);
const put = (rig: Rig, k: string | undefined, body: unknown, headers: Record<string, string> = GATEWAY) =>
  rig.app.fastify.inject({
    method: 'POST',
    url: '/internal/v1/test/put',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
      ...(k === undefined ? {} : { 'idempotency-key': k }),
    },
    payload: JSON.stringify(body),
  });

describe('멱등 HTTP (파이프라인 + 저장소)', () => {
  it('UT-SK-006 같은 키·다른 본문 → 422 CT-CONFLICT-001, 같은 키·같은 본문 → 상태·본문 바이트 동일 + idempotent-replayed: true [NFR-AVL-011]', async () => {
    // Arrange
    const rig = await make();
    // Act
    const first = await put(rig, key(1), { v: 1 });
    const same = await put(rig, key(1), { v: 1 });
    const other = await put(rig, key(1), { v: 2 });
    // Assert
    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(same.statusCode).toBe(201);
    expect(same.body).toBe(first.body);
    expect(same.headers['idempotent-replayed']).toBe('true');
    expect(same.headers['content-type']).toMatch(/^application\/json/);
    expect(probes.puts).toBe(1);
    expect(other.statusCode).toBe(422);
    expect(Problem.parse(JSON.parse(other.body)).code).toBe('CT-CONFLICT-001');
    expect(probes.puts).toBe(1);
    // 기본값 채움이 같은 의도를 같은 해시로 만든다(mode 생략 vs 명시)
    const a = await put(rig, key(2), { v: 5 });
    const b = await put(rig, key(2), { v: 5, mode: 'ok' });
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body).toBe(a.body);
  });

  it('UT-SK-164 처리 중 같은 키 → 409 CONFLICT-002(retryable, retry_after_ms 200) [NFR-AVL-011][IF-COM-005]', async () => {
    // Arrange
    const rig = await make();
    const slow = put(rig, key(3), { v: 1, mode: 'slow' });
    await expect.poll(() => probes.slowRelease !== null).toBe(true);
    // Act
    const dup = await put(rig, key(3), { v: 1, mode: 'slow' });
    // Assert
    expect(dup.statusCode).toBe(409);
    expect(Problem.parse(JSON.parse(dup.body))).toMatchObject({
      code: 'CT-CONFLICT-002',
      retryable: true,
      retry_after_ms: 200,
    });
    probes.slowRelease?.();
    expect((await slow).statusCode).toBe(201);
    // 끝난 뒤에는 재생
    expect((await put(rig, key(3), { v: 1, mode: 'slow' })).headers['idempotent-replayed']).toBe('true');
  });

  it('UT-SK-165 5xx·예외는 저장하지 않아 재요청이 다시 처리되고, 4xx AppError는 저장·재생된다 [NFR-AVL-011]', async () => {
    // Arrange
    const rig = await make();
    // Act / Assert: boom(예외 → 500)
    const boom1 = await put(rig, key(4), { v: 1, mode: 'boom' });
    expect(boom1.statusCode).toBe(500);
    const boom2 = await put(rig, key(4), { v: 1, mode: 'boom' });
    expect(boom2.statusCode).toBe(500);
    expect(probes.puts).toBe(2);
    expect(rig.db?.prepare('SELECT count(*) AS n FROM idem_request').get()).toEqual({ n: 0 });
    // conflict(422 AppError) 저장·재생
    const c1 = await put(rig, key(5), { v: 1, mode: 'conflict' });
    const c2 = await put(rig, key(5), { v: 1, mode: 'conflict' });
    expect(c1.statusCode).toBe(422);
    expect(c2.statusCode).toBe(422);
    expect(c2.headers['idempotent-replayed']).toBe('true');
    expect(c2.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(probes.puts).toBe(3);
    expect(Problem.parse(JSON.parse(c2.body)).error_id).toBe(Problem.parse(JSON.parse(c1.body)).error_id); // 저장된 본문 그대로
  });

  it('UT-SK-166 저장 키는 (key, caller, route_id)다 [NFR-AVL-011]', async () => {
    // Arrange
    const rig = await make();
    // Act
    await put(rig, key(6), { v: 1 });
    const again = await put(rig, key(6), { v: 1 });
    // Assert
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(probes.puts).toBe(1);
    expect(rig.db?.prepare('SELECT caller, route_id FROM idem_request').all()).toEqual([
      { caller: 'gateway', route_id: 'content.test.put' },
    ]);
  });

  it('UT-SK-167 7일 지난 행은 없음 취급 후 교체되고 204는 {}로 저장·재생 본문 0 [NFR-AVL-011][IF-COM-005]', async () => {
    // Arrange
    const rig = await make();
    await put(rig, key(7), { v: 1 });
    // Act: 7일 + 1ms 뒤 → 다른 본문도 새 요청
    rig.clock.advance(7 * 86_400_000 + 1);
    const fresh = await put(rig, key(7), { v: 9 });
    // Assert
    expect(fresh.statusCode).toBe(201);
    expect(fresh.headers['idempotent-replayed']).toBeUndefined();
    expect(probes.puts).toBe(2);
    // 204
    const nc = (k: string) =>
      rig.app.fastify.inject({
        method: 'POST',
        url: '/internal/v1/test/no-content',
        headers: { 'content-type': 'application/json; charset=utf-8', ...GATEWAY, 'idempotency-key': k },
        payload: '{"v":1}',
      });
    const n1 = await nc(key(8));
    expect(n1.statusCode).toBe(204);
    expect(n1.body).toBe('');
    expect(rig.db?.prepare('SELECT response_json FROM idem_request WHERE status = 204').get()).toEqual({
      response_json: '{}',
    });
    const n2 = await nc(key(8));
    expect(n2.statusCode).toBe(204);
    expect(n2.body).toBe('');
    expect(n2.headers['idempotent-replayed']).toBe('true');
  });

  it('UT-SK-168 키 없음·비 ULID → 400 VAL-901, db: null 저장소(gateway)는 in-flight만 [NFR-AVL-011][IF-COM-005]', async () => {
    // Arrange
    const rig = await make();
    // Act / Assert
    for (const k of [undefined, 'not-a-ulid', key(1).toLowerCase()]) {
      const r = await put(rig, k, { v: 1 });
      expect(r.statusCode).toBe(400);
      expect(Problem.parse(JSON.parse(r.body)).code).toBe('CT-VAL-901');
    }
    expect(probes.puts).toBe(0);
    // gateway(DB 없음): 같은 키를 다시 보내면 저장이 없어 재처리된다
    const gw = await rigOf(fixtureDef({ ...defOf('gateway'), databases: [] }, probes));
    rigs.push(gw);
    // gateway는 callerTokens에 자기 자신도 있으므로 같은 토큰으로 호출한다
    const first = await put(gw, key(9), { v: 1 });
    const second = await put(gw, key(9), { v: 1 });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(probes.puts).toBe(2);
  });
});
