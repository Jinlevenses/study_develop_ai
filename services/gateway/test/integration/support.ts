import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import type { TempHome } from '@fathom/testkit/temp-home';
import { createTempHome } from '@fathom/testkit/temp-home';

// gateway 통합 테스트 공통 헬퍼 — 실 프로세스(`fixtures/gateway-entry.ts`)·가짜 supervisor(IPC)·가짜 ops-api(node:http)·실 소켓 요청.

export const ENTRY = fileURLToPath(new URL('./fixtures/gateway-entry.ts', import.meta.url));
export const EXEC_ARGV = ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning'];
export const SELF_TOKEN = 'b2'.repeat(32);
export const CLI_TOKEN = 'k'.repeat(43);
export const OPS_AUTH = { authorization: `Bearer ${TEST_CALLER_TOKENS['ops-api']}` };
export const CONTENT_AUTH = { authorization: `Bearer ${TEST_CALLER_TOKENS.content}` };

const alive: ChildProcess[] = [];
const servers: http.Server[] = [];

/** afterEach용: 살아 있는 자식을 SIGKILL하고, 닫히지 않은 가짜 서버를 닫는다. 정상 경로에서 남은 자식 수는 0이어야 한다. */
export async function cleanup(): Promise<number> {
  let leftover = 0;
  for (const child of alive.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      leftover += 1;
      child.kill('SIGKILL');
    }
  }
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  return leftover;
}

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'TMPDIR']) {
    const v = process.env[key];
    if (v !== undefined) {
      env[key] = v;
    }
  }
  return { ...env, ...extra };
}

export type IpcChild = {
  readonly child: ChildProcess;
  readonly messages: unknown[];
  waitFor(type: string): Promise<Record<string, unknown>>;
  readonly exit: Promise<number | null>;
  /** 'exit' 이벤트 기준(stdio가 닫히길 기다리지 않는다) — `child.disconnect()` 뒤에는 'close'가 오지 않는 경우가 있다. */
  readonly exited: Promise<number | null>;
  stdout(): string;
  stderr(): string;
};

export function forkGateway(home: string, fxArgs: string[] = []): IpcChild {
  const child = fork(ENTRY, fxArgs, {
    execArgv: EXEC_ARGV,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
    env: cleanEnv({ FATHOM_HOME: home }),
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
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
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
    exited,
    stdout: () => out,
    stderr: () => err,
  };
}

export function envelope(home: string, over: Partial<BootstrapEnvelope> = {}): BootstrapEnvelope {
  const peer = (port: number): { url: string } => ({ url: `http://127.0.0.1:${port}` });
  return {
    type: 'bootstrap',
    v: 1,
    svc: 'gateway',
    boot_id: fixedUlid(7),
    app_version: '0.1.0',
    contracts_hash: 'c'.repeat(64),
    profile: 'test',
    home,
    web_root: null,
    listen: { host: '127.0.0.1', port: 0 },
    self_token: SELF_TOKEN,
    callers: { ...TEST_CALLER_TOKENS },
    peers: { gateway: peer(1), content: peer(2), learning: peer(3), 'ai-gateway': peer(4), 'ops-api': peer(5) },
    flags: { safe_mode: false, batch_enabled: false, after_crash: false },
    log_level: 'info',
    ...over,
  };
}

/** 봉투를 보내고 `listening`·`ready`까지 기다린다. */
export async function bootGateway(
  home: string,
  over: Partial<BootstrapEnvelope> = {},
  fxArgs: string[] = [],
): Promise<{ svc: IpcChild; port: number; ready: Record<string, unknown> }> {
  const svc = forkGateway(home, fxArgs);
  svc.child.send(envelope(home, over));
  const listening = await svc.waitFor('listening');
  const ready = await svc.waitFor('ready');
  return { svc, port: Number(listening.port), ready };
}

export async function withHome<T>(fn: (home: TempHome) => Promise<T>): Promise<T> {
  const home = await createTempHome('fathom-gw-it-');
  try {
    return await fn(home);
  } finally {
    await home.cleanup();
  }
}

/** supervisor가 boot마다 쓰는 `run/cli.token`을 흉내 낸다. */
export function writeCliToken(home: string, token = CLI_TOKEN): void {
  mkdirSync(path.join(home, 'run'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, 'run', 'cli.token'), `${token}\n`, { mode: 0o600 });
}

export type HttpResult = { status: number; body: string; headers: http.IncomingHttpHeaders; json: () => unknown };

export function request(
  port: number,
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; host?: string } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${port}`, ...(opts.headers ?? {}) };
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => {
        body += c.toString('utf8');
      });
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body, headers: res.headers, json: () => JSON.parse(body) as unknown }),
      );
    });
    req.on('error', reject);
    req.end(payload);
  });
}

let keySeq = 70_000;
export const nextKey = (): string => {
  keySeq += 1;
  return fixedUlid(keySeq);
};

export type RealSession = { cookie: string; csrf: string; headers(extra?: Record<string, string>): Record<string, string> };

/** CLI 토큰으로 부트스트랩 토큰을 받아 교환까지 한 브라우저 세션(실 소켓). */
export async function login(port: number): Promise<RealSession> {
  const origin = `http://127.0.0.1:${port}`;
  const issued = await request(port, 'POST', '/api/v1/cli/bootstrap-token', {
    headers: { authorization: `Bearer ${CLI_TOKEN}`, 'idempotency-key': nextKey() },
    body: { purpose: 'open' },
  });
  if (issued.status !== 201) {
    throw new Error(`bootstrap-token failed: ${issued.status} ${issued.body}`);
  }
  const bt = new URL((issued.json() as { open_url: string }).open_url).hash.replace('#bt=', '');
  const exchanged = await request(port, 'POST', '/api/v1/session/exchange', { headers: { origin }, body: { bt } });
  if (exchanged.status !== 200) {
    throw new Error(`exchange failed: ${exchanged.status} ${exchanged.body}`);
  }
  const cookie = /fathom_sid=([^;]+)/.exec(String(exchanged.headers['set-cookie']))?.[1] ?? '';
  const base = { cookie: `fathom_sid=${cookie}` };
  const csrf = ((await request(port, 'GET', '/api/v1/session/csrf', { headers: base })).json() as { csrf: string }).csrf;
  return { cookie, csrf, headers: (extra = {}) => ({ ...base, ...extra }) };
}

export function startServer(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

/** 지금 비어 있는 포트(바로 닫는다). */
export async function freePort(): Promise<number> {
  const s = http.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

/** 점유된 포트(afterEach에서 닫는다). */
export async function occupyPort(): Promise<number> {
  return (await startServer((_req, res) => res.end())).port;
}
