import type { ChildProcess } from 'node:child_process';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import type { TempHome } from '@fathom/testkit/temp-home';
import { createTempHome } from '@fathom/testkit/temp-home';
import { EXEC_ARGV, MAIN } from './fixtures/def.js';

export type ChildResult = { readonly code: number | null; readonly stdout: string[]; readonly stderr: string[] };

/** `NODE_OPTIONS`(테스트 러너가 넣을 수 있는 `--disable-warning` 등)를 뺀 깨끗한 환경. */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'NODE_OPTIONS') {
      env[k] = v;
    }
  }
  return { ...env, ...extra };
}

function lines(text: string): string[] {
  return text.split('\n').filter((l) => l !== '');
}

/** 서비스 진입점을 `--mode=...`로 한 번 돌리고 끝날 때까지 기다린다(IPC 없음). */
export async function runMode(
  argv: string[],
  env: Record<string, string>,
  opts: { execArgv?: string[]; entry?: string } = {},
): Promise<ChildResult> {
  const child = spawn(process.execPath, [...(opts.execArgv ?? EXEC_ARGV), opts.entry ?? MAIN, ...argv], {
    env: cleanEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c: Buffer) => {
    out += c.toString('utf8');
  });
  child.stderr.on('data', (c: Buffer) => {
    err += c.toString('utf8');
  });
  const [code] = (await once(child, 'close')) as [number | null];
  return { code, stdout: lines(out), stderr: lines(err) };
}

export function jsonLines(result: ChildResult): Record<string, unknown>[] {
  return result.stdout.flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

export type IpcChild = {
  readonly child: ChildProcess;
  readonly messages: unknown[];
  waitFor(type: string): Promise<Record<string, unknown>>;
  exit: Promise<number | null>;
  stdout(): string;
  stderr(): string;
};

/** IPC가 있는 자식(serve 모드)을 띄운다. 메시지는 `messages`에 쌓인다. */
export function forkService(argv: string[], env: Record<string, string> = {}): IpcChild {
  const child = fork(MAIN, argv, {
    execArgv: EXEC_ARGV,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
    env: cleanEnv(env),
  });
  const messages: unknown[] = [];
  const waiters: { type: string; resolve: (m: Record<string, unknown>) => void }[] = [];
  let out = '';
  let err = '';
  child.stdout?.on('data', (c: Buffer) => {
    out += c.toString('utf8');
  });
  child.stderr?.on('data', (c: Buffer) => {
    err += c.toString('utf8');
  });
  child.on('message', (m: unknown) => {
    messages.push(m);
    for (const w of [...waiters]) {
      if (typeof m === 'object' && m !== null && 'type' in m && m.type === w.type) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(m as Record<string, unknown>);
      }
    }
  });
  const exit = new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code));
  });
  return {
    child,
    messages,
    waitFor(type: string): Promise<Record<string, unknown>> {
      const seen = messages.find((m) => typeof m === 'object' && m !== null && 'type' in m && m.type === type);
      if (seen !== undefined) {
        return Promise.resolve(seen as Record<string, unknown>);
      }
      return new Promise((resolve) => waiters.push({ type, resolve }));
    },
    exit,
    stdout: () => out,
    stderr: () => err,
  };
}

export async function withHome<T>(fn: (home: TempHome) => Promise<T>): Promise<T> {
  const home = await createTempHome('fathom-sk-svc-');
  try {
    return await fn(home);
  } finally {
    await home.cleanup();
  }
}
