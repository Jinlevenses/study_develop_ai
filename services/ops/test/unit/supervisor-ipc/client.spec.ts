import { IpcOpsToSupervisor } from '@fathom/contracts/admin/ipc';
import { Ulid } from '@fathom/contracts/common/ids';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorControl } from '../../../src/infra/supervisor-ipc/client.js';
import { createSupervisorControl } from '../../../src/infra/supervisor-ipc/client.js';
import type { FakeChannel } from './fixtures/fake-channel.js';
import { ALL_CURSORS, createFakeChannel, STATUS_ROW } from './fixtures/fake-channel.js';

afterEach(() => {
  vi.useRealTimers();
});

function setup(timeoutsMs?: Parameters<typeof createSupervisorControl>[0]['timeoutsMs']): {
  fake: FakeChannel;
  control: SupervisorControl;
} {
  const fake = createFakeChannel();
  let n = 0;
  const control = createSupervisorControl({
    channel: fake.channel,
    newId: () => {
      n += 1;
      return fixedUlid(n);
    },
    ...(timeoutsMs === undefined ? {} : { timeoutsMs }),
  });
  return { fake, control };
}

/** 이벤트 루프를 한 번 돌려 대기 중인 프로미스가 아직 안 끝났음을 확인한다(고정 sleep 아님). */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void p.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  return !settled;
}

const ack = (re: string, ok = true, error: string | null = null): Record<string, unknown> => ({
  type: 'svc.ack',
  v: 1,
  re,
  ok,
  error,
});

describe('supervisor IPC 클라이언트', () => {
  it('UT-OP-190 status(): 요청은 IpcOpsToSupervisor 통과, 같은 re의 status만 결과, 나머지는 무시 [FR-SET-002][IF-IPC-013][IF-IPC-014]', async () => {
    // Arrange
    const { fake, control } = setup();
    // Act
    const pending = control.status();
    const request = IpcOpsToSupervisor.parse(fake.sent[0]);
    const id = fake.lastId();
    // Assert: 요청 모양
    expect(request).toEqual({ type: 'status.get', v: 1, id });
    expect(Ulid.safeParse(id).success).toBe(true);
    // 무시되어야 하는 메시지들: 다른 re·re 없음·bootstrap·registry.updated·스키마 위반
    fake.emit({ type: 'status', v: 1, re: fixedUlid(999), services: [] });
    fake.emit({ type: 'status', v: 1, services: [] });
    fake.emit({ type: 'bootstrap', v: 1, re: id });
    fake.emit({ type: 'registry.updated', v: 1, re: id, peers: {} });
    fake.emit({ type: 'status', v: 1, re: id, services: [{ svc: 'learning' }] });
    fake.emit('garbage');
    expect(await stillPending(pending)).toBe(true);
    // 짝이 맞는 응답
    fake.emit({ type: 'status', v: 1, re: id, services: [STATUS_ROW] });
    expect(await pending).toEqual({ ok: true, value: [STATUS_ROW] });
  });

  it('UT-OP-191 stop·start·restart(vite 포함): ack ok → ok(null), ok:false → rejected [FR-SET-007][IF-IPC-008][IF-IPC-009][IF-IPC-010]', async () => {
    // Arrange
    const { fake, control } = setup();
    const calls = [
      ['svc.stop', (s: 'learning' | 'vite') => control.stop(s)],
      ['svc.start', (s: 'learning' | 'vite') => control.start(s)],
      ['svc.restart', (s: 'learning' | 'vite') => control.restart(s)],
    ] as const;
    for (const [type, call] of calls) {
      for (const svc of ['learning', 'vite'] as const) {
        // Act
        const okPending = call(svc);
        const okRequest = IpcOpsToSupervisor.parse(fake.sent[fake.sent.length - 1]);
        fake.emit(ack(fake.lastId()));
        const rejectedPending = call(svc);
        fake.emit(ack(fake.lastId(), false, 'not_managed'));
        // Assert
        expect(okRequest).toMatchObject({ type, svc, v: 1 });
        expect(await okPending).toEqual({ ok: true, value: null });
        expect(await rejectedPending).toEqual({ ok: false, error: { kind: 'rejected', detail: 'not_managed' } });
      }
    }
    // error 없는 거절 = 'unknown'
    const unknown = control.stop('content');
    fake.emit(ack(fake.lastId(), false, null));
    expect(await unknown).toEqual({ ok: false, error: { kind: 'rejected', detail: 'unknown' } });
  });

  it('UT-OP-192 runMode migrate·restore·verify: args 전달, 결과, 잘못된 응답 type·인자 [FR-SET-007][IF-IPC-011][IF-IPC-012]', async () => {
    // Arrange
    const { fake, control } = setup();
    const cases = [
      ['content', { mode: 'migrate', dry_run: true, db_copy_dir: null, app_dir: null }],
      ['learning', { mode: 'restore', from: '/home/u/.fathom/backups/e1', rewind_cursors: ALL_CURSORS }],
      ['ai-gateway', { mode: 'verify', replay: true, db_copy_dir: '/tmp/copy' }],
    ] as const;
    for (const [svc, args] of cases) {
      // Act
      const pending = control.runMode(svc, args);
      const request = IpcOpsToSupervisor.parse(fake.sent[fake.sent.length - 1]);
      fake.emit({ type: 'svc.run_mode.result', v: 1, re: fake.lastId(), exit_code: 78, tail: ['line'] });
      // Assert
      expect(request).toMatchObject({ type: 'svc.run_mode', svc, args });
      expect(await pending).toEqual({ ok: true, value: { exit_code: 78, tail: ['line'] } });
    }
    // 응답 type 불일치 → protocol(detail = 받은 type)
    const wrong = control.runMode('content', cases[0][1]);
    fake.emit(ack(fake.lastId()));
    expect(await wrong).toEqual({ ok: false, error: { kind: 'protocol', detail: 'svc.ack' } });
    // RunModeArgs 위반 → 던짐 + 전송 0
    const before = fake.sent.length;
    const bad = { mode: 'migrate' } as unknown as Parameters<typeof control.runMode>[1];
    await expect(control.runMode('content', bad)).rejects.toThrow();
    expect(fake.sent).toHaveLength(before);
  });

  it('UT-OP-193 logsTail·shutdownAll: 범위 밖 인자는 던지고 정상은 결과 [IF-IPC-015][IF-IPC-016][IF-IPC-017]', async () => {
    // Arrange
    const { fake, control } = setup();
    // Act / Assert: 범위 밖
    await expect(control.logsTail('learning', 0)).rejects.toThrow();
    await expect(control.logsTail('learning', 5001)).rejects.toThrow();
    await expect(control.shutdownAll(-1)).rejects.toThrow();
    await expect(control.shutdownAll(10_001)).rejects.toThrow();
    expect(fake.sent).toHaveLength(0);
    // 정상
    const logs = control.logsTail('supervisor', 5000);
    expect(IpcOpsToSupervisor.parse(fake.sent[0])).toMatchObject({ type: 'logs.tail', svc: 'supervisor', n: 5000 });
    fake.emit({ type: 'logs.tail.result', v: 1, re: fake.lastId(), svc: 'supervisor', lines: ['a', 'b'] });
    expect(await logs).toEqual({ ok: true, value: { svc: 'supervisor', lines: ['a', 'b'] } });
    const down = control.shutdownAll(10_000);
    expect(IpcOpsToSupervisor.parse(fake.sent[1])).toMatchObject({ type: 'shutdown.all', grace_ms: 10_000 });
    fake.emit(ack(fake.lastId()));
    expect(await down).toEqual({ ok: true, value: null });
  });

  it('UT-OP-194 유형별 시간 상한 초과 → timeout, 늦은 응답 무시 [FR-SET-002]', async () => {
    // Arrange
    vi.useFakeTimers();
    const { fake, control } = setup();
    const limits: [string, number, () => Promise<unknown>][] = [
      ['status', 2_000, () => control.status()],
      ['logs_tail', 5_000, () => control.logsTail('learning', 10)],
      ['stop', 10_000, () => control.stop('learning')],
      ['start', 40_000, () => control.start('learning')],
      ['restart', 40_000, () => control.restart('learning')],
      ['shutdown_all', 3_000 + 5_000, () => control.shutdownAll(3_000)],
      [
        'run_mode',
        610_000,
        () => control.runMode('content', { mode: 'migrate', dry_run: false, db_copy_dir: null, app_dir: null }),
      ],
    ];
    for (const [name, ms, call] of limits) {
      // Act
      const pending = call();
      const id = fake.lastId();
      let result: unknown = null;
      void pending.then((r) => {
        result = r;
      });
      await vi.advanceTimersByTimeAsync(ms - 1);
      // Assert: 상한 직전까지 대기
      expect(result, `${name} before limit`).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(result, name).toMatchObject({ ok: false, error: { kind: 'timeout' } });
      // 늦은 응답은 무시(예외 없음)
      fake.emit(ack(id));
    }
    // timeoutsMs 재정의
    const custom = setup({ status: 50 });
    const quick = custom.control.status();
    await vi.advanceTimersByTimeAsync(50);
    expect(await quick).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('UT-OP-195 병렬 3요청 + 역순 응답 → 각자 자기 결과, id 3개 서로 다름 [IF-IPC-013][IF-IPC-014]', async () => {
    // Arrange
    const { fake, control } = setup();
    // Act
    const status = control.status();
    const logs = control.logsTail('content', 3);
    const stop = control.stop('gateway');
    const ids = fake.sent.map((m) => String(m.id));
    fake.emit(ack(ids[2] ?? ''));
    fake.emit({ type: 'logs.tail.result', v: 1, re: ids[1], svc: 'content', lines: ['x'] });
    fake.emit({ type: 'status', v: 1, re: ids[0], services: [STATUS_ROW] });
    // Assert
    expect(new Set(ids).size).toBe(3);
    expect(await stop).toEqual({ ok: true, value: null });
    expect(await logs).toEqual({ ok: true, value: { svc: 'content', lines: ['x'] } });
    expect(await status).toEqual({ ok: true, value: [STATUS_ROW] });
  });

  it('UT-OP-196 지연 리스너: 생성만으로 on 0, 첫 요청에서 1회, close()가 대기를 끝내고 off 1회 [FR-SET-002]', async () => {
    // Arrange
    const { fake, control } = setup();
    expect(fake.state.on).toBe(0);
    // Act
    const first = control.status();
    const second = control.stop('learning');
    // Assert
    expect(fake.state.on).toBe(1);
    control.close();
    expect(await first).toEqual({ ok: false, error: { kind: 'closed', detail: expect.any(String) } });
    expect(await second).toEqual({ ok: false, error: { kind: 'closed', detail: expect.any(String) } });
    expect(fake.state.off).toBe(1);
    expect(await control.status()).toMatchObject({ ok: false, error: { kind: 'closed' } });
    expect(fake.sent).toHaveLength(2);
  });

  it('UT-OP-197 connected()=false·send=false·send 예외 → no_channel, 대기 0 [FR-SET-002]', async () => {
    // Arrange
    const { fake, control } = setup();
    // Act / Assert
    fake.state.connected = false;
    expect(await control.status()).toMatchObject({ ok: false, error: { kind: 'no_channel' } });
    fake.state.connected = true;
    fake.state.sendResult = false;
    expect(await control.status()).toMatchObject({ ok: false, error: { kind: 'no_channel' } });
    fake.state.sendResult = true;
    fake.state.sendThrows = true;
    expect(await control.status()).toMatchObject({ ok: false, error: { kind: 'no_channel' } });
    // 실패한 요청의 id는 대기 맵에 남지 않는다 — 같은 id의 늦은 응답이 와도 이후 요청에 영향 없음
    fake.state.sendThrows = false;
    const next = control.status();
    fake.emit({ type: 'status', v: 1, re: fake.lastId(), services: [] });
    expect(await next).toEqual({ ok: true, value: [] });
  });
});
