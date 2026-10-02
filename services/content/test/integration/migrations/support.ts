import type { ChildProcess } from 'node:child_process';
import { fork, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import type { TempHome } from '@fathom/testkit/temp-home';
import { createTempHome } from '@fathom/testkit/temp-home';

// content 통합 테스트 공용 도우미 — 자식 프로세스(`src/main.ts`)를 `--import tsx --conditions=source`로 띄운다(워커 execArgv는 상속되지 않는다).

export const CONTENT_MAIN = fileURLToPath(new URL('../../../src/main.ts', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const MIGRATIONS_ROOT = fileURLToPath(new URL('../../../migrations/', import.meta.url));
export const EXEC_ARGV = ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning'];
export const SELF_TOKEN = 'a1'.repeat(32);
export const OPS_TOKEN = TEST_CALLER_TOKENS['ops-api'];
export const LEARNING_TOKEN = TEST_CALLER_TOKENS.learning;

export type ChildResult = { readonly code: number | null; readonly stdout: string[]; readonly stderr: string[] };

/** `NODE_OPTIONS`(러너가 넣을 수 있는 `--disable-warning` 등)를 뺀 깨끗한 환경. */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'NODE_OPTIONS') {
      env[k] = v;
    }
  }
  return { ...env, ...extra };
}

const alive: ChildProcess[] = [];

/** afterEach용: 아직 살아 있는 자식을 SIGKILL하고 그 수를 돌려준다(정상 경로에서는 0이어야 한다). */
export function killAlive(): number {
  let leftover = 0;
  for (const child of alive.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      leftover += 1;
      child.kill('SIGKILL');
    }
  }
  return leftover;
}

const lines = (text: string): string[] => text.split('\n').filter((l) => l !== '');

/** 진입점을 `--mode=...`로 한 번 돌리고 끝날 때까지 기다린다(IPC 없음). */
export async function runMode(
  argv: string[],
  env: Record<string, string>,
  opts: { execArgv?: string[] } = {},
): Promise<ChildResult> {
  const child = spawn(process.execPath, [...(opts.execArgv ?? EXEC_ARGV), CONTENT_MAIN, ...argv], {
    env: cleanEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  alive.push(child);
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
  readonly exit: Promise<number | null>;
  stdout(): string;
  stderr(): string;
};

/** IPC가 있는 자식(serve 모드). 메시지는 `messages`에 쌓인다. */
export function forkContent(env: Record<string, string> = {}): IpcChild {
  const child = fork(CONTENT_MAIN, [], {
    execArgv: EXEC_ARGV,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
    env: cleanEnv(env),
  });
  alive.push(child);
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
  const typeOf = (m: unknown): string | null =>
    typeof m === 'object' && m !== null && 'type' in m && typeof m.type === 'string' ? m.type : null;
  child.on('message', (m: unknown) => {
    messages.push(m);
    for (const w of [...waiters]) {
      if (typeOf(m) === w.type) {
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
      const seen = messages.find((m) => typeOf(m) === type);
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

export function envelope(home: string, over: Partial<BootstrapEnvelope> = {}): BootstrapEnvelope {
  const peer = (port: number): { url: string } => ({ url: `http://127.0.0.1:${port}` });
  return {
    type: 'bootstrap',
    v: 1,
    svc: 'content',
    boot_id: fixedUlid(7),
    app_version: '0.1.0',
    contracts_hash: 'c'.repeat(64),
    profile: 'test',
    home,
    web_root: null,
    listen: { host: '127.0.0.1', port: 0 },
    self_token: SELF_TOKEN,
    callers: { ...TEST_CALLER_TOKENS },
    peers: {
      gateway: peer(1),
      content: peer(4762),
      learning: peer(2),
      'ai-gateway': peer(3), // 미기동 포트 — IT-00은 호출 0
      'ops-api': peer(4),
    },
    flags: { safe_mode: false, batch_enabled: false, after_crash: false },
    log_level: 'info',
    ...over,
  };
}

export async function withHome<T>(fn: (home: TempHome) => Promise<T>): Promise<T> {
  const home = await createTempHome('fathom-ct-');
  try {
    return await fn(home);
  } finally {
    await home.cleanup();
  }
}

export const sha256File = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
export const contentDbPath = (home: string): string => path.join(home, 'data', 'content.db');

/** 읽기 전용 연결로 SQL을 한 번 돌리고 닫는다(경고 억제 로더 경유 — `node:sqlite` 값 import 0). */
export async function queryRows(file: string, sql: string): Promise<Record<string, unknown>[]> {
  const runtime = await loadSqliteRuntime();
  const db: SqlitePort = runtime.openDb(file, { readOnly: true, synchronous: 'NORMAL' });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}

/** 쓰기 연결(변조·마이그레이션 사전 준비용). */
export async function openWritable(file: string): Promise<SqlitePort> {
  const runtime = await loadSqliteRuntime();
  return runtime.openDb(file, { synchronous: 'NORMAL' });
}

export type HttpResult = { readonly status: number; readonly body: string };

export function httpRequest(
  port: number,
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: url,
        method,
        headers: {
          ...(payload === undefined
            ? {}
            : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c: Buffer) => {
          text += c.toString('utf8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

export async function freePort(): Promise<number> {
  const s = http.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}
