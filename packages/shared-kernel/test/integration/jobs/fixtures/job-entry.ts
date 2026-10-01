// 통합 테스트용 job 진입점(`--mode=job --job=<name>`): args.mode로 동작을 고른다.
import { spawn } from 'node:child_process';
import { defineJob, processJobChannel, serveJob } from '../../../../src/jobs/jobs.js';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const handler = async (
  args: Readonly<Record<string, unknown>>,
  ctx: { progress(pct: number | null, step: string): void; readonly signal: AbortSignal },
): Promise<Record<string, unknown>> => {
  const mode = String(args.mode ?? 'echo');
  switch (mode) {
    case 'echo':
      return { echo: args, pid: process.pid };
    case 'timed': {
      const startedAt = Date.now();
      await sleep(Number(args.ms ?? 200), ctx.signal);
      return { startedAt, endedAt: Date.now(), tag: args.tag ?? null };
    }
    case 'progress':
      ctx.progress(25, 'quarter');
      ctx.progress(100, 'done');
      return { ok: true };
    case 'env':
      return { env: Object.keys(process.env).sort() };
    case 'lines':
      process.stdout.write('hello from stdout\nsecond line\n');
      process.stderr.write('warn from stderr\n');
      process.stdout.write('no newline at end');
      return { printed: true };
    case 'throw':
      throw new Error('handler exploded');
    case 'crash':
      process.exit(3);
      return {};
    case 'garbage':
      process.send?.({ type: 'bogus', v: 1 });
      await sleep(30_000, ctx.signal);
      return {};
    case 'grandchild': {
      // 같은 프로세스 그룹의 손자를 띄우고 두 pid를 progress로 알린 뒤 오래 잔다.
      const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      ctx.progress(null, `pids:${process.pid}:${g.pid}`);
      await sleep(60_000, ctx.signal);
      return {};
    }
    case 'announce':
      ctx.progress(null, `pid:${process.pid}`);
      await sleep(60_000, ctx.signal);
      return {};
    case 'slow-cancel':
      ctx.progress(null, 'ready');
      await sleep(60_000, ctx.signal);
      return { aborted: ctx.signal.aborted };
    default:
      return { unknownMode: mode };
  }
};

const code = await serveJob(
  [defineJob('integrity', handler), defineJob('snapshot', handler), defineJob('merge', handler)],
  processJobChannel(),
);
process.exit(code);
