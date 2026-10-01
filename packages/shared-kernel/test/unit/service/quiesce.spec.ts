import { QuiesceAck, ResumeAck } from '@fathom/contracts/admin/admin-routes';
import { Problem } from '@fathom/contracts/common/problem';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWriteGate } from '../../../src/service/write-gate.js';
import type { Probes } from './routes.js';
import { fixtureDef } from './routes.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, OPS, rigOf } from './support.js';

const rigs: Rig[] = [];
const probes: Probes = { puts: 0, slowRelease: null, slowStarted: null };
const relay = { pause: vi.fn(), resume: vi.fn(), kick: vi.fn(), collectGauges: vi.fn() };

async function make(gate?: { waitMs?: number; autoReopenMs?: number }): Promise<Rig> {
  probes.puts = 0;
  probes.slowRelease = null;
  relay.pause.mockClear();
  relay.resume.mockClear();
  const rig = await rigOf(fixtureDef(defOf('content'), probes), { relay }, gate === undefined ? {} : { gate });
  rigs.push(rig);
  return rig;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

let seq = 100;
const idem = (): string => fixedUlid(seq++);
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const quiesce = (rig: Rig, epoch: string, ack = 2000) =>
  rig.app.fastify.inject({
    method: 'POST',
    url: '/internal/v1/admin/quiesce',
    headers: { ...jsonHeaders, ...OPS, 'idempotency-key': idem() },
    payload: JSON.stringify({ epoch_id: epoch, ack_deadline_ms: ack }),
  });
const resume = (rig: Rig, epoch: string) =>
  rig.app.fastify.inject({
    method: 'POST',
    url: '/internal/v1/admin/resume',
    headers: { ...jsonHeaders, ...OPS, 'idempotency-key': idem() },
    payload: JSON.stringify({ epoch_id: epoch, outcome: 'completed' }),
  });
const write = (rig: Rig, body: unknown = { v: 1 }) =>
  rig.app.fastify.inject({
    method: 'POST',
    url: '/internal/v1/test/put',
    headers: { ...jsonHeaders, ...GATEWAY, 'idempotency-key': idem() },
    payload: JSON.stringify(body),
  });
const read = (rig: Rig) => rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/items/x', headers: GATEWAY });

describe('quiesce 쓰기 게이트', () => {
  it('UT-SK-181 쓰기 대기 → resume 후 처리·GET 통과·relay pause/resume·ack [NFR-DATA-012][IF-COM-005][IF-COM-007]', async () => {
    // Arrange
    const rig = await make();
    const epoch = fixedUlid(50);
    // Act: quiesce
    const q = await quiesce(rig, epoch);
    expect(q.statusCode).toBe(200);
    expect(QuiesceAck.parse(JSON.parse(q.body))).toMatchObject({ epoch_id: epoch, in_flight_drained: true });
    expect(relay.pause).toHaveBeenCalledTimes(1);
    // 쓰기는 대기, GET은 통과
    let settled = false;
    const pending = write(rig).then((r) => {
      settled = true;
      return r;
    });
    expect((await read(rig)).statusCode).toBe(200);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    expect(probes.puts).toBe(0);
    // Act: resume → 대기하던 쓰기가 처리된다
    const r = await resume(rig, epoch);
    expect(r.statusCode).toBe(200);
    expect(ResumeAck.parse(JSON.parse(r.body)).epoch_id).toBe(epoch);
    expect((await pending).statusCode).toBe(201);
    expect(relay.resume).toHaveBeenCalledTimes(1);
    expect(probes.puts).toBe(1);
    // resume은 멱등: 이미 열려 있어도 ack
    expect((await resume(rig, epoch)).statusCode).toBe(200);
    expect(relay.resume).toHaveBeenCalledTimes(1);
  });

  it('UT-SK-181 대기 시간 초과 → 503 DEP-900 + retry-after: 1·진행 중 쓰기 drain 후 ack [NFR-DATA-012][IF-COM-005]', async () => {
    // Arrange: 대기 한도를 60ms로 줄인 게이트(기본 3s는 createWriteGate 단위 테스트가 본다)
    const rig = await make({ waitMs: 60 });
    const inFlight = write(rig, { v: 1, mode: 'slow' });
    await expect.poll(() => probes.slowRelease !== null).toBe(true);
    // Act: quiesce는 진행 중 쓰기가 끝나야 ack한다
    let acked = false;
    const q = quiesce(rig, fixedUlid(51)).then((r) => {
      acked = true;
      return r;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(acked).toBe(false);
    probes.slowRelease?.();
    expect((await inFlight).statusCode).toBe(201);
    expect((await q).statusCode).toBe(200);
    // 닫힌 동안 들어온 쓰기는 한도 뒤 503
    const res = await write(rig);
    // Assert
    expect(res.statusCode).toBe(503);
    expect(Problem.parse(JSON.parse(res.body)).code).toBe('CT-DEP-900');
    expect(res.headers['retry-after']).toBe('1');
    expect(probes.puts).toBe(1);
    expect((await read(rig)).statusCode).toBe(200);
  });

  it('UT-SK-181 ack 기한 초과 → 503 + 게이트 다시 열림, resume이 없으면 자동 재개 + warn [NFR-DATA-012][IF-COM-005]', async () => {
    // Arrange: 자동 재개를 200ms로 줄인 게이트
    const rig = await make({ autoReopenMs: 200 });
    const inFlight = write(rig, { v: 1, mode: 'slow' });
    await expect.poll(() => probes.slowRelease !== null).toBe(true);
    // Act: 기한 100ms 안에 drain 안 됨
    const res = await quiesce(rig, fixedUlid(52), 100);
    // Assert
    expect(res.statusCode).toBe(503);
    expect(Problem.parse(JSON.parse(res.body)).code).toBe('CT-DEP-900');
    expect(relay.resume).toHaveBeenCalledTimes(1); // 닫혔다 즉시 다시 열림
    probes.slowRelease?.();
    expect((await inFlight).statusCode).toBe(201);
    expect((await write(rig)).statusCode).toBe(201); // 열려 있으므로 대기 없이 처리
    // 자동 재개
    relay.pause.mockClear();
    relay.resume.mockClear();
    expect((await quiesce(rig, fixedUlid(53))).statusCode).toBe(200);
    expect(relay.pause).toHaveBeenCalledTimes(1);
    expect(relay.resume).not.toHaveBeenCalled();
    await expect.poll(() => relay.resume.mock.calls.length).toBe(1);
    expect(rig.cap.lines().some((l) => l.event === 'admin.quiesce.auto_reopened' && l.level === 'warn')).toBe(true);
    expect((await write(rig)).statusCode).toBe(201);
  });
});

describe('createWriteGate', () => {
  it('UT-SK-181 닫힌 채 epoch 교체·onChange는 전이 때만·release는 멱등 [NFR-DATA-012]', async () => {
    // Arrange
    const changes: string[] = [];
    const gate = createWriteGate({ clock: createFakeClock(), onChange: (s) => void changes.push(s) });
    // Act / Assert
    expect(gate.state).toBe('open');
    const entered = await gate.enter();
    expect(entered.ok).toBe(true);
    const q1 = gate.quiesce('E1', 1000);
    expect(gate.state).toBe('closed');
    expect(gate.epochId).toBe('E1');
    if (entered.ok) {
      entered.value();
      entered.value(); // 두 번 해제해도 카운터는 한 번만 줄어든다
    }
    expect(await q1).toMatchObject({ ok: true });
    expect(await gate.quiesce('E2', 1000)).toMatchObject({ ok: true });
    expect(gate.epochId).toBe('E2');
    expect(changes).toEqual(['closed']);
    gate.resume('E2');
    expect(gate.state).toBe('open');
    expect(gate.epochId).toBeNull();
    expect(changes).toEqual(['closed', 'open']);
  });

  it('UT-SK-181 기본값: 대기 3s 초과 → timeout, 자동 재개 60s [NFR-DATA-012]', async () => {
    // Arrange
    vi.useFakeTimers();
    const changes: string[] = [];
    let auto = 0;
    const gate = createWriteGate({
      clock: createFakeClock(),
      onChange: (s) => void changes.push(s),
      onAutoReopen: () => {
        auto += 1;
      },
    });
    void gate.quiesce('E1', 5000);
    // Act: 대기 2999ms에는 아직, 3001ms에는 timeout
    const waiter = gate.enter();
    let result: Awaited<typeof waiter> | null = null;
    void waiter.then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    // Assert
    expect(result).toEqual({ ok: false, error: 'timeout' });
    await vi.advanceTimersByTimeAsync(56_998); // 누적 59_999ms
    expect(gate.state).toBe('closed');
    await vi.advanceTimersByTimeAsync(2);
    expect(gate.state).toBe('open');
    expect(auto).toBe(1);
    expect(changes).toEqual(['closed', 'open']);
  });
});
