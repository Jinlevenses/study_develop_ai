import { IpcJob } from '@fathom/contracts/admin/jobs';
import { describe, expect, it } from 'vitest';
import type { JobChannel } from '../../../src/jobs/jobs.js';
import { defineJob, serveJob } from '../../../src/jobs/jobs.js';

const ID = '01J0000000000000000000000A';

function fakeChannel(): {
  channel: JobChannel;
  sent: unknown[];
  deliver(msg: unknown): void;
  disconnect(): void;
} {
  let onMessage: (msg: unknown) => void = () => undefined;
  let onDisconnect: () => void = () => undefined;
  const sent: unknown[] = [];
  return {
    channel: {
      send: (msg) => void sent.push(msg),
      onMessage: (cb) => {
        onMessage = cb;
      },
      onDisconnect: (cb) => {
        onDisconnect = cb;
      },
    },
    sent,
    deliver: (msg) => onMessage(msg),
    disconnect: () => onDisconnect(),
  };
}

const start = (job: string, args: Record<string, unknown> = {}): unknown => ({
  type: 'job.start',
  v: 1,
  id: ID,
  job,
  args,
});

function expectAllIpcJob(sent: readonly unknown[]): void {
  for (const m of sent) {
    expect(IpcJob.safeParse(m).success, JSON.stringify(m)).toBe(true);
  }
}

describe('serveJob', () => {
  it('UT-SK-117 성공: progress 송신 후 job.result와 종료 코드 0, 모든 메시지가 IpcJob이며 re = start id [NFR-AVL-004][IF-IPC-018~022]', async () => {
    // Arrange
    const f = fakeChannel();
    const done = serveJob(
      [
        defineJob('integrity', (args, ctx) => {
          ctx.progress(10, 'step-one');
          ctx.progress(null, 'x'.repeat(100));
          ctx.progress(250, 'clamped');
          return Promise.resolve({ echoed: args, aborted: ctx.signal.aborted });
        }),
      ],
      f.channel,
    );
    // Act
    f.deliver(start('integrity', { a: 1 }));
    // Assert
    expect(await done).toBe(0);
    expect(f.sent).toEqual([
      { type: 'job.progress', v: 1, re: ID, pct: 10, step: 'step-one' },
      { type: 'job.progress', v: 1, re: ID, pct: null, step: 'x'.repeat(60) },
      { type: 'job.progress', v: 1, re: ID, pct: 100, step: 'clamped' },
      { type: 'job.result', v: 1, re: ID, result: { echoed: { a: 1 }, aborted: false } },
    ]);
    expectAllIpcJob(f.sent);
  });

  it('UT-SK-118 핸들러 예외는 job.error handler_failed(메시지 ≤ 500자)와 종료 코드 70이다 [NFR-AVL-004][IF-IPC-018~022]', async () => {
    const f = fakeChannel();
    const done = serveJob(
      [
        defineJob('merge', () => {
          throw new Error('boom '.repeat(200));
        }),
        defineJob('rebuild', () => Promise.reject(new Error('async boom'))),
      ],
      f.channel,
    );
    f.deliver(start('merge'));
    expect(await done).toBe(70);
    expect(f.sent).toHaveLength(1);
    const msg = f.sent[0] as { type: string; code: string; message: string; re: string };
    expect(msg).toMatchObject({ type: 'job.error', code: 'handler_failed', re: ID });
    expect(msg.message.length).toBe(500);
    expectAllIpcJob(f.sent);

    const g = fakeChannel();
    const doneAsync = serveJob([defineJob('rebuild', () => Promise.reject(new Error('async boom')))], g.channel);
    g.deliver(start('rebuild'));
    expect(await doneAsync).toBe(70);
    expect(g.sent).toEqual([{ type: 'job.error', v: 1, re: ID, code: 'handler_failed', message: 'async boom' }]);
  });

  it('UT-SK-119 알 수 없는 job·첫 메시지가 job.start가 아님·시작 뒤 잘못된 메시지는 protocol 오류와 64다 [NFR-AVL-004][IF-IPC-018~022]', async () => {
    const defs = [defineJob('snapshot', () => new Promise<Record<string, unknown>>(() => undefined))];
    const unknown = fakeChannel();
    const a = serveJob(defs, unknown.channel);
    unknown.deliver(start('merge'));
    expect(await a).toBe(64);
    expect(unknown.sent).toEqual([
      { type: 'job.error', v: 1, re: ID, code: 'protocol', message: 'unknown job: merge' },
    ]);
    expectAllIpcJob(unknown.sent);

    for (const bad of [
      { type: 'job.cancel', v: 1 },
      'junk',
      null,
      { type: 'job.start', v: 1, job: 'nope', args: {} },
    ]) {
      const f = fakeChannel();
      const done = serveJob(defs, f.channel);
      f.deliver(bad);
      expect(await done, JSON.stringify(bad)).toBe(64);
      expect(f.sent).toHaveLength(1);
      expect(f.sent[0]).toMatchObject({ type: 'job.error', code: 'protocol' });
      expectAllIpcJob(f.sent);
    }

    const late = fakeChannel();
    const b = serveJob(defs, late.channel);
    late.deliver(start('snapshot'));
    late.deliver({ type: 'job.progress', v: 1, pct: 1, step: 's' });
    expect(await b).toBe(64);
    expect(late.sent[0]).toMatchObject({ type: 'job.error', code: 'protocol', re: ID });
  });

  it('UT-SK-120 cancel 수신은 AbortSignal을 켜고 job.error cancelled 후 종료 코드 0이다 [NFR-AVL-004][IF-IPC-018~022]', async () => {
    const f = fakeChannel();
    let sawAbort = false;
    const done = serveJob(
      [
        defineJob(
          'pack-load',
          (_args, ctx) =>
            new Promise<Record<string, unknown>>((resolve) => {
              ctx.signal.addEventListener('abort', () => {
                sawAbort = true;
                resolve({ late: true });
              });
            }),
        ),
      ],
      f.channel,
    );
    f.deliver(start('pack-load'));
    f.deliver({ type: 'job.cancel', v: 1, re: ID });
    expect(await done).toBe(0);
    await Promise.resolve();
    expect(sawAbort).toBe(true);
    // 취소 뒤 핸들러가 늦게 끝나도 추가 메시지는 없다.
    expect(f.sent).toEqual([{ type: 'job.error', v: 1, re: ID, code: 'cancelled', message: 'cancelled' }]);
    expectAllIpcJob(f.sent);
  });

  it('UT-SK-121 채널이 끊기면(부모 사망) abort 후 즉시 70이다 [NFR-AVL-004][IF-IPC-018~022]', async () => {
    const f = fakeChannel();
    let aborted = false;
    const done = serveJob(
      [
        defineJob(
          'replay-verify',
          (_args, ctx) =>
            new Promise<Record<string, unknown>>(() => {
              ctx.signal.addEventListener('abort', () => {
                aborted = true;
              });
            }),
        ),
      ],
      f.channel,
    );
    f.deliver(start('replay-verify'));
    f.disconnect();
    expect(await done).toBe(70);
    expect(aborted).toBe(true);
    expect(f.sent).toEqual([]);

    // 시작 전 끊김도 70
    const early = fakeChannel();
    const e = serveJob([], early.channel);
    early.disconnect();
    expect(await e).toBe(70);

    // 송신 실패(채널 닫힘)도 70
    const closed: JobChannel = {
      send: () => {
        throw new Error('channel closed');
      },
      onMessage: (cb) => queueMicrotask(() => cb(start('integrity'))),
      onDisconnect: () => undefined,
    };
    expect(await serveJob([defineJob('integrity', () => Promise.resolve({}))], closed)).toBe(70);
  });
});
