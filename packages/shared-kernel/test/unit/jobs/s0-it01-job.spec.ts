import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobChannel } from '../../../src/jobs/jobs.js';
import { allowlistedEnv, defineJob, serveJob } from '../../../src/jobs/jobs.js';

// T-01-01 §4.2-5·6 — serveJob invariant(잘못된 메시지 생성 → 70·uncaught 0) · job 자식 env에서 *_API_KEY 제외(CR-75).

const ID = '01J0000000000000000000000A';

function fakeChannel(): { channel: JobChannel; sent: unknown[]; deliver(msg: unknown): void } {
  let onMessage: (msg: unknown) => void = () => undefined;
  const sent: unknown[] = [];
  return {
    channel: {
      send: (msg) => void sent.push(msg),
      onMessage: (cb) => {
        onMessage = cb;
      },
      onDisconnect: () => undefined,
    },
    sent,
    deliver: (msg) => onMessage(msg),
  };
}

const start = (job: string): unknown => ({ type: 'job.start', v: 1, id: ID, job, args: {} });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('serveJob invariant', () => {
  it('UT-SK-220 핸들러 결과가 IpcJob에 맞지 않으면(배열·null) 던지지 않고 종료 코드 70으로 끝나며 uncaught·미처리 거부가 0이다 [IF-IPC-018]', async () => {
    const uncaught: unknown[] = [];
    const onRejection = (e: unknown): void => void uncaught.push(e);
    const onException = (e: unknown): void => void uncaught.push(e);
    process.on('unhandledRejection', onRejection);
    process.on('uncaughtException', onException);
    try {
      for (const bad of [[1, 2], null, 'text']) {
        const f = fakeChannel();
        const done = serveJob(
          [defineJob('integrity', () => Promise.resolve(bad as unknown as Record<string, unknown>))],
          f.channel,
        );
        f.deliver(start('integrity'));
        expect(await done).toBe(70);
        expect(f.sent, JSON.stringify(bad)).toEqual([]); // 잘못된 메시지는 송신하지 않는다
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(uncaught).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
      process.off('uncaughtException', onException);
    }
  });

  it('UT-SK-221 잘못된 메시지로 끝나면 핸들러의 AbortSignal이 켜지고 이후 progress는 무시된다 [IF-IPC-018]', async () => {
    const f = fakeChannel();
    let signal: AbortSignal | null = null;
    let progress: ((pct: number | null, step: string) => void) | null = null;
    const done = serveJob(
      [
        defineJob('integrity', (_args, ctx) => {
          signal = ctx.signal;
          progress = ctx.progress;
          return Promise.resolve([] as unknown as Record<string, unknown>);
        }),
      ],
      f.channel,
    );
    f.deliver(start('integrity'));
    expect(await done).toBe(70);
    expect(signal).not.toBeNull();
    expect((signal as unknown as AbortSignal).aborted).toBe(true);
    (progress as unknown as (pct: number | null, step: string) => void)(50, 'late');
    expect(f.sent).toEqual([]);
  });
});

describe('job 자식 env', () => {
  it('UT-SK-222 allowlistedEnv는 *_API_KEY 4종을 제외하고 PATH·FATHOM_HOME 등 나머지 허용 이름은 유지한다 [STD-CFG-21][NFR-SEC-005]', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-secret');
    vi.stubEnv('GEMINI_API_KEY', 'gem-secret');
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-secret');
    vi.stubEnv('TYPESAFE_BASE_URL', 'http://127.0.0.1:1');
    vi.stubEnv('FATHOM_HOME', '/tmp/fathom-home');
    vi.stubEnv('PATH', '/usr/bin');
    vi.stubEnv('SOME_OTHER_VAR', 'x');
    const env = allowlistedEnv();
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'TYPESAFE_API_KEY']) {
      expect(Object.keys(env), k).not.toContain(k);
    }
    expect(Object.values(env).join('|')).not.toMatch(/secret/);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.FATHOM_HOME).toBe('/tmp/fathom-home');
    expect(env.TYPESAFE_BASE_URL).toBe('http://127.0.0.1:1');
    expect(Object.keys(env)).not.toContain('SOME_OTHER_VAR');
    expect(Object.keys(env).filter((k) => /_API_KEY$/.test(k))).toEqual([]);
  });
});
