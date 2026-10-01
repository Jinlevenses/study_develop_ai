import { IpcJob } from '@fathom/contracts/admin/jobs';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { JobChannel } from '@fathom/shared-kernel/jobs/jobs';
import { defineJob, serveJob } from '@fathom/shared-kernel/jobs/jobs';
import { describe, expect, it } from 'vitest';

type Sent = unknown[];
function fakeChannel(): { channel: JobChannel; sent: Sent; deliver(m: unknown): void; disconnect(): void } {
  const sent: Sent = [];
  const handlers: ((m: unknown) => void)[] = [];
  const disconnects: (() => void)[] = [];
  return {
    sent,
    channel: {
      send: (m) => void sent.push(m),
      onMessage: (cb) => void handlers.push(cb),
      onDisconnect: (cb) => void disconnects.push(cb),
    },
    deliver: (m) => {
      for (const cb of handlers) {
        cb(m);
      }
    },
    disconnect: () => {
      for (const cb of disconnects) {
        cb();
      }
    },
  };
}

describe('job IPC (shared-kernel serveJob ↔ IpcJob, IF-IPC-018~022)', () => {
  const start = (job: string): Record<string, unknown> => ({
    type: 'job.start',
    v: 1,
    id: ulid(),
    job,
    args: { n: 1 },
  });

  it('CT-SUP-718 job.start(부모가 보내는 샘플)가 IpcJob 통과 [IF-IPC-018]', () => {
    expect(IpcJob.safeParse(start('snapshot')).success).toBe(true);
    expect(IpcJob.safeParse({ ...start('snapshot'), job: 'nope' }).success).toBe(false);
  });

  it('CT-SUP-719 job.progress: 자식이 낸 메시지가 IpcJob 통과·re = job.start id [IF-IPC-019]', async () => {
    const fx = fakeChannel();
    const job = defineJob('snapshot', (_args, ctx) => {
      ctx.progress(50, 'half');
      return Promise.resolve({ done: true });
    });
    const exit = serveJob([job], fx.channel);
    const msg = start('snapshot');
    fx.deliver(msg);
    expect(await exit).toBe(0);
    const progress = fx.sent.find((m) => (m as { type: string }).type === 'job.progress');
    expect(IpcJob.safeParse(progress).success).toBe(true);
    expect(progress).toMatchObject({ re: msg.id, pct: 50, step: 'half' });
  });

  it('CT-SUP-720 job.result: IpcJob 통과 [IF-IPC-020]', async () => {
    const fx = fakeChannel();
    const exit = serveJob([defineJob('integrity', () => Promise.resolve({ ok: 1 }))], fx.channel);
    fx.deliver(start('integrity'));
    expect(await exit).toBe(0);
    const result = fx.sent.find((m) => (m as { type: string }).type === 'job.result');
    expect(IpcJob.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ result: { ok: 1 } });
  });

  it('CT-SUP-721 job.error: 핸들러 실패가 IpcJob 통과·종료 70 [IF-IPC-021]', async () => {
    const fx = fakeChannel();
    const exit = serveJob([defineJob('merge', () => Promise.reject(new Error('boom')))], fx.channel);
    fx.deliver(start('merge'));
    expect(await exit).toBe(70);
    const error = fx.sent.find((m) => (m as { type: string }).type === 'job.error');
    expect(IpcJob.safeParse(error).success).toBe(true);
    expect(error).toMatchObject({ code: 'handler_failed' });
  });

  it('CT-SUP-722 job.cancel(부모 샘플 IpcJob 통과) → job.error{code:cancelled} [IF-IPC-022]', async () => {
    const fx = fakeChannel();
    const job = defineJob(
      'rebuild',
      (_args, ctx) =>
        new Promise<Record<string, unknown>>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const exit = serveJob([job], fx.channel);
    fx.deliver(start('rebuild'));
    const cancel = { type: 'job.cancel', v: 1 };
    expect(IpcJob.safeParse(cancel).success).toBe(true);
    fx.deliver(cancel);
    expect(await exit).toBe(0);
    const error = fx.sent.find((m) => (m as { type: string }).type === 'job.error');
    expect(IpcJob.safeParse(error).success).toBe(true);
    expect(error).toMatchObject({ code: 'cancelled' });
  });
});
