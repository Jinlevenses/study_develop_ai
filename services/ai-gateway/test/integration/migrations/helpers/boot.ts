import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TempHome } from '@fathom/testkit/temp-home';
import { createTempHome } from '@fathom/testkit/temp-home';

// 서비스 골격 통합 테스트 보조(서비스 간 테스트 코드 공유 금지 → 서비스마다 1벌). 자식 프로세스 = 실제 `src/main.ts`(tsx).
export const SVC = 'ai-gateway';
export const SERVICE_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
export const MAIN = fileURLToPath(new URL('../../../../src/main.ts', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));

export const SELF_TOKEN = 'a'.repeat(64);
export const CALLER_TOKENS = {
  gateway: '1'.repeat(64),
  content: '2'.repeat(64),
  learning: '3'.repeat(64),
  'ai-gateway': '4'.repeat(64),
  'ops-api': '5'.repeat(64),
} as const;
const SERVICE_NAMES = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const;

export type RunResult = {
  readonly code: number | null;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly messages: unknown[];
};
export type RunOptions = {
  readonly ipc?: boolean;
  readonly noWarningFlag?: boolean;
  readonly extraImports?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
};

function splitLines(text: string): string[] {
  return text.split('\n').filter((l) => l !== '');
}

function childEnv(home: string, extra: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = { FATHOM_HOME: home, ...extra };
  const path = process.env.PATH;
  if (path !== undefined) {
    env.PATH = path;
  }
  const systemRoot = process.env.SystemRoot;
  if (process.platform === 'win32' && systemRoot !== undefined) {
    env.SystemRoot = systemRoot;
  }
  return env;
}

export function execArgvFor(opts: RunOptions = {}): string[] {
  return [
    ...(opts.noWarningFlag === true ? [] : ['--disable-warning=ExperimentalWarning']),
    ...(opts.extraImports ?? []).flatMap((u) => ['--import', u]),
    '--import',
    'tsx',
    '--conditions=source',
  ];
}

type Spawned = {
  readonly child: ChildProcess;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly messages: unknown[];
  readonly closed: Promise<number | null>;
  /** 새 메시지·종료가 있을 때마다 깨어나 `pred`가 참이 될 때까지(상한 30s) 기다린다. */
  until(pred: () => boolean): Promise<void>;
};

function spawnMain(home: string, args: readonly string[], opts: RunOptions): Spawned {
  const child = spawn(process.execPath, [...execArgvFor(opts), MAIN, ...args], {
    cwd: SERVICE_DIR,
    env: childEnv(home, opts.env ?? {}),
    stdio: ['ignore', 'pipe', 'pipe', ...(opts.ipc === true ? (['ipc'] as const) : [])],
    serialization: 'json',
  });
  let out = '';
  let err = '';
  const messages: unknown[] = [];
  const waiters: (() => void)[] = [];
  const wake = (): void => {
    for (const w of waiters.splice(0)) {
      w();
    }
  };
  child.stdout?.on('data', (c: Buffer) => {
    out += c.toString('utf8');
    wake();
  });
  child.stderr?.on('data', (c: Buffer) => {
    err += c.toString('utf8');
  });
  child.on('message', (m: unknown) => {
    messages.push(m);
    wake();
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      resolve(code);
      wake();
    });
  });
  let isClosed = false;
  void closed.then(() => {
    isClosed = true;
  });
  const spawned: Spawned = {
    child,
    get stdout() {
      return splitLines(out);
    },
    get stderr() {
      return splitLines(err);
    },
    messages,
    closed,
    async until(pred: () => boolean): Promise<void> {
      const deadline = AbortSignal.timeout(30_000);
      while (!pred() && !isClosed) {
        await new Promise<void>((resolve, reject) => {
          waiters.push(resolve);
          deadline.addEventListener('abort', () => reject(new Error('child wait timed out')), { once: true });
        });
      }
    },
  };
  return spawned;
}

/** `--mode=...`로 한 번 돌리고 끝날 때까지 기다린다. */
export async function runMode(home: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  const run = spawnMain(home, args, opts);
  const code = await run.closed;
  return { code, stdout: run.stdout, stderr: run.stderr, messages: run.messages };
}

function bootstrapEnvelope(home: string): Record<string, unknown> {
  const names = Object.fromEntries(SERVICE_NAMES.map((n) => [n, { url: 'http://127.0.0.1:9' }]));
  return {
    type: 'bootstrap',
    v: 1,
    svc: SVC,
    boot_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    app_version: '0.0.0',
    contracts_hash: 'a'.repeat(64),
    profile: 'test',
    home,
    web_root: null,
    listen: { host: '127.0.0.1', port: 0 },
    self_token: SELF_TOKEN,
    callers: { ...CALLER_TOKENS },
    peers: names,
    flags: { safe_mode: false, batch_enabled: true, after_crash: false },
    log_level: 'info',
  };
}

export type Served = {
  readonly port: number | null;
  readonly ready: Record<string, unknown> | null;
  readonly fatal: Record<string, unknown> | null;
  readonly messages: unknown[];
  readonly stdout: () => string[];
  stop(graceMs?: number): Promise<number | null>;
  readonly exited: Promise<number | null>;
};

function findMessage(messages: readonly unknown[], type: string): Record<string, unknown> | null {
  for (const m of messages) {
    if (typeof m === 'object' && m !== null && 'type' in m && m.type === type) {
      return m as Record<string, unknown>;
    }
  }
  return null;
}

/** serve 모드를 IPC로 기동 → 봉투 전송 → `ready`·`fatal`·종료 중 먼저 오는 것까지 기다린다. */
export async function bootServe(home: string, opts: Omit<RunOptions, 'ipc'> = {}): Promise<Served> {
  const run = spawnMain(home, ['--mode=serve'], { ...opts, ipc: true });
  run.child.send(bootstrapEnvelope(home));
  await run.until(() => findMessage(run.messages, 'ready') !== null || findMessage(run.messages, 'fatal') !== null);
  const listening = findMessage(run.messages, 'listening');
  return {
    port: typeof listening?.port === 'number' ? listening.port : null,
    ready: findMessage(run.messages, 'ready'),
    fatal: findMessage(run.messages, 'fatal'),
    messages: run.messages,
    stdout: () => run.stdout,
    stop(graceMs = 1000): Promise<number | null> {
      if (run.child.connected) {
        run.child.send({ type: 'shutdown', v: 1, grace_ms: graceMs });
      }
      return run.closed;
    },
    exited: run.closed,
  };
}

export async function getJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

export async function postInbox(
  port: number,
  token: string,
  body: unknown,
  attempt = 1,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/internal/v1/inbox`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
      'x-fathom-delivery-attempt': String(attempt),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** DB-01의 코드 블록 중 2번째 줄이 `-- <repoPath>`인 ```sql 블록(+ LF 1개). */
export function ddlBlock(repoPath: string): string {
  const lines = readFileSync(`${REPO_ROOT}docs/02-design/03-database-design.md`, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === '```sql' && lines[i + 2] === `-- ${repoPath}`) {
      let end = i + 1;
      while (lines[end] !== '```') {
        end += 1;
      }
      return `${lines.slice(i + 1, end).join('\n')}\n`;
    }
  }
  throw new Error(`ddl block not found in DB-01: ${repoPath}`);
}

/** 두 `##`/`###` 제목 사이의 `#### \`<name>\`` 테이블 이름 목록(문서 순서). */
export function specTables(heading: string, nextHeading: string): string[] {
  const lines = readFileSync(`${REPO_ROOT}docs/02-design/03-database-design.md`, 'utf8').split('\n');
  const from = lines.findIndex((l) => l.startsWith(heading));
  const to = lines.findIndex((l, i) => i > from && l.startsWith(nextHeading));
  if (from < 0 || to < 0) {
    throw new Error(`spec headings not found: ${heading} / ${nextHeading}`);
  }
  const names: string[] = [];
  for (const line of lines.slice(from, to)) {
    const m = /^#### `([a-z_]+)`/.exec(line);
    if (m?.[1] !== undefined) {
      names.push(m[1]);
    }
  }
  return names;
}

export const INFRA_TABLES = [
  'schema_migrations',
  'outbox',
  'outbox_delivery',
  'inbox_dedupe',
  'inbox_watermark',
  'inbox_dead',
  'idem_request',
] as const;

export async function withTempHome<T>(fn: (home: TempHome) => Promise<T>): Promise<T> {
  const home = await createTempHome('fathom-svc-');
  try {
    return await fn(home);
  } finally {
    await home.cleanup();
  }
}

/** DB-01의 `-- <NAME> …` 주석 다음 문장(빈 줄·펜스 전까지). */
export function docSql(name: string): string {
  const lines = readFileSync(`${REPO_ROOT}docs/02-design/03-database-design.md`, 'utf8').split('\n');
  const at = lines.findIndex((l) => l === `-- ${name}` || l.startsWith(`-- ${name} `));
  if (at < 0) {
    throw new Error(`doc statement not found: ${name}`);
  }
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line === '' || line.startsWith('```') || line.startsWith('-- ')) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}
