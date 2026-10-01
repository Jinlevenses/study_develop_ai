import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ALLOWED_ENV } from '../../../src/config/config.js';
import type { JobRunner } from '../../../src/jobs/jobs.js';
import { createJobRunner } from '../../../src/jobs/jobs.js';
import { isAlive } from './fixtures/liveness.js';

const ENTRY = fileURLToPath(new URL('./fixtures/job-entry.ts', import.meta.url));
const PARENT = fileURLToPath(new URL('./fixtures/parent.ts', import.meta.url));
const EXEC_ARGV = ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning'];

function runner(over: Partial<Parameters<typeof createJobRunner>[0]> = {}): JobRunner {
  return createJobRunner({ entry: ENTRY, execArgv: EXEC_ARGV, ...over });
}

describe('JobRunner (실제 자식 프로세스)', () => {
  it('UT-SK-015 동시 1개 실행·기한 초과 시 자식과 손자 종료·부모 SIGKILL 시 자식 ≤ 3s 종료 [NFR-AVL-002]', async () => {
    // (a) 동시 1: 두 번째는 첫 번째가 끝난 뒤 실행된다.
    const r = runner();
    const first = r.run('integrity', { mode: 'timed', ms: 400, tag: 'first' }, { timeoutMs: 30_000 });
    const second = r.run('integrity', { mode: 'timed', ms: 50, tag: 'second' }, { timeoutMs: 30_000 });
    expect(r.isBusy()).toBe(true);
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.tag).toBe('first');
      expect(b.value.tag).toBe('second');
      expect(Number(b.value.startedAt)).toBeGreaterThanOrEqual(Number(a.value.endedAt));
    }
    expect(r.isBusy()).toBe(false);

    // (b) 기한 초과: 자식과 손자 프로세스 모두 종료
    let pids: number[] = [];
    const timedOut = await runner().run(
      'integrity',
      { mode: 'grandchild' },
      {
        timeoutMs: 2500,
        onProgress: (p) => {
          const m = /^pids:(\d+):(\d+)$/.exec(p.step);
          if (m !== null) {
            pids = [Number(m[1]), Number(m[2])];
          }
        },
      },
    );
    expect(timedOut).toMatchObject({ ok: false, error: { kind: 'timeout', code: 'timeout' } });
    expect(pids).toHaveLength(2);
    await vi.waitFor(
      async () => {
        for (const pid of pids) {
          expect(await isAlive(pid), `pid ${pid}`).toBe(false);
        }
      },
      { timeout: 4000, interval: 50 },
    );

    // (c) 부모 SIGKILL → 자식은 IPC 끊김을 보고 3초 안에 종료
    const parent = spawn(process.execPath, [...EXEC_ARGV, PARENT, ENTRY], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const childPid = await new Promise<number>((resolve, reject) => {
        let buf = '';
        parent.stdout.on('data', (c: Buffer) => {
          buf += c.toString('utf8');
          const m = /pid:(\d+)/.exec(buf);
          if (m !== null) {
            resolve(Number(m[1]));
          }
        });
        parent.once('exit', (code) => reject(new Error(`parent exited early: ${String(code)}`)));
      });
      expect(await isAlive(childPid)).toBe(true);
      parent.kill('SIGKILL');
      await once(parent, 'exit');
      await vi.waitFor(
        async () => {
          expect(await isAlive(childPid)).toBe(false);
        },
        { timeout: 3000, interval: 50 },
      );
    } finally {
      parent.kill('SIGKILL');
    }
  }, 60_000);

  it('UT-SK-122 queue_full·crashed·protocol·job_error·cancelled·onProgress [NFR-AVL-004][IF-IPC-018~022]', async () => {
    // queue_full: 실행 1 + 대기열 1(queueMax 1) 뒤 세 번째는 즉시 거부
    const r = runner({ queueMax: 1 });
    const running = r.run('integrity', { mode: 'timed', ms: 500 }, { timeoutMs: 30_000 });
    const queued = r.run('integrity', { mode: 'echo' }, { timeoutMs: 30_000 });
    const rejected = await r.run('integrity', { mode: 'echo' }, { timeoutMs: 30_000 });
    expect(rejected).toEqual({
      ok: false,
      error: { kind: 'queue_full', code: null, message: 'job queue is full (1)', exitCode: null },
    });
    expect((await running).ok).toBe(true);
    const queuedResult = await queued;
    expect(queuedResult.ok).toBe(true);

    // crashed: 결과 없이 종료(exit 3)
    const crashed = await runner().run('integrity', { mode: 'crash' }, { timeoutMs: 30_000 });
    expect(crashed).toMatchObject({ ok: false, error: { kind: 'crashed', exitCode: 3 } });

    // protocol: IpcJob이 아닌 메시지 → protocol + 자식 종료
    const bogus = await runner().run('integrity', { mode: 'garbage' }, { timeoutMs: 30_000 });
    expect(bogus).toMatchObject({ ok: false, error: { kind: 'protocol', code: 'protocol' } });

    // job_error: 핸들러 예외(자식 종료 코드 70)
    const thrown = await runner().run('integrity', { mode: 'throw' }, { timeoutMs: 30_000 });
    expect(thrown).toMatchObject({
      ok: false,
      error: { kind: 'job_error', code: 'handler_failed', message: 'handler exploded', exitCode: 70 },
    });

    // onProgress + result
    const progress: { pct: number | null; step: string }[] = [];
    const done = await runner().run(
      'integrity',
      { mode: 'progress' },
      { timeoutMs: 30_000, onProgress: (p) => progress.push(p) },
    );
    expect(done).toEqual({ ok: true, value: { ok: true } });
    expect(progress).toEqual([
      { pct: 25, step: 'quarter' },
      { pct: 100, step: 'done' },
    ]);

    // cancelled: cancel() → 자식이 job.error cancelled 후 0으로 종료
    const c = runner();
    let ready = false;
    const pending = c.run(
      'integrity',
      { mode: 'slow-cancel' },
      { timeoutMs: 30_000, onProgress: () => (ready = true) },
    );
    await vi.waitFor(() => expect(ready).toBe(true), { timeout: 15_000 });
    c.cancel();
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'cancelled', code: 'cancelled', exitCode: 0 } });
    expect(c.isBusy()).toBe(false);
  }, 60_000);

  it('UT-SK-123 stdout·stderr 줄 중계와 자식 env = allowlist 키만, shutdown은 실행 중 job을 취소하고 대기열을 비운다 [NFR-AVL-004][IF-IPC-018~022]', async () => {
    // 줄 중계
    const out: string[] = [];
    const errLines: string[] = [];
    const lines = await runner({ onStdoutLine: (l) => out.push(l), onStderrLine: (l) => errLines.push(l) }).run(
      'integrity',
      { mode: 'lines' },
      { timeoutMs: 30_000 },
    );
    expect(lines.ok).toBe(true);
    expect(out).toEqual(['hello from stdout', 'second line', 'no newline at end']);
    expect(errLines).toEqual(['warn from stderr']);

    // env allowlist: 부모에 비밀을 심어도 자식에게는 허용 목록 이름만 간다.
    vi.stubEnv('FATHOM_TEST_PARENT_SECRET', 'leak-me');
    vi.stubEnv('SOME_OTHER_VAR', 'x');
    try {
      const env = await runner().run('integrity', { mode: 'env' }, { timeoutMs: 30_000 });
      expect(env.ok).toBe(true);
      if (env.ok) {
        const keys = env.value.env as string[];
        const allowed = new Set<string>(ALLOWED_ENV);
        // node가 스스로 덧붙이는 키(NODE_CHANNEL_FD 등 IPC 배선)는 허용한다.
        const unexpected = keys.filter((k) => !allowed.has(k) && !k.startsWith('NODE_CHANNEL') && !k.startsWith('LC_'));
        expect(unexpected).toEqual([]);
        expect(keys).not.toContain('FATHOM_TEST_PARENT_SECRET');
        expect(keys).not.toContain('SOME_OTHER_VAR');
      }
    } finally {
      vi.unstubAllEnvs();
    }

    // shutdown: 실행 중 job 취소 + 대기열 cancelled, 이후 run은 거부
    const r = runner();
    let ready = false;
    const running = r.run(
      'integrity',
      { mode: 'slow-cancel' },
      { timeoutMs: 30_000, onProgress: () => (ready = true) },
    );
    const queued = r.run('integrity', { mode: 'echo' }, { timeoutMs: 30_000 });
    await vi.waitFor(() => expect(ready).toBe(true), { timeout: 15_000 });
    await r.shutdown();
    expect(await running).toMatchObject({ ok: false, error: { kind: 'cancelled' } });
    expect(await queued).toMatchObject({ ok: false, error: { kind: 'cancelled', message: 'job runner is shut down' } });
    expect(await r.run('integrity', { mode: 'echo' }, { timeoutMs: 1000 })).toMatchObject({
      ok: false,
      error: { kind: 'cancelled' },
    });
    expect(r.isBusy()).toBe(false);
  }, 60_000);
});
