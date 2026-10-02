import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SupervisedService } from '@fathom/contracts/admin/ipc';
import { RuntimeProfile, ServiceState } from '@fathom/contracts/common/domain';
import { SemVer, Ulid } from '@fathom/contracts/common/ids';
import { EpochMs } from '@fathom/contracts/common/time';
import { homePath, readAllowedEnv } from '@fathom/shared-kernel/config/config';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { safeSpawn } from '@fathom/shared-kernel/proc/proc';
import { z } from 'zod';
import { createUlidSequence } from './ids.js';
import { createTempHome } from './temp-home.js';

// TST-01 §3.2·§8.2 — 임시 FATHOM_HOME에 실제 CLI·supervisor로 6개 상주 프로세스를 띄우는 테스트 스택(PGM-TK-005).

export type StackRuntime = 'dist' | 'src';
export type StackService = 'gateway' | 'content' | 'learning' | 'ai-gateway' | 'ops-api';
export const MIGRATE_ORDER: readonly StackService[] = ['ops-api', 'ai-gateway', 'content', 'learning'];
export type StackFailureCode =
  | 'build_missing'
  | 'recorder_missing'
  | 'migrate_failed'
  | 'up_failed'
  | 'registry_invalid'
  | 'wait_timeout'
  | 'not_running'
  | 'bootstrap_failed'
  | 'stop_failed';
export type StackFailure = {
  readonly code: StackFailureCode;
  readonly detail: string;
  readonly svc?: StackService;
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderrTail?: string;
  readonly registry?: unknown;
};
export type ProcResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderrTail: string;
  readonly timedOut: boolean;
  readonly spawnError: string | null;
};
type EnvName = 'PATH' | 'HOME' | 'LANG' | 'LC_ALL' | 'TMPDIR' | 'TZ' | 'SYSTEMROOT';
export type StackDeps = {
  readonly spawn: (
    bin: string,
    args: readonly string[],
    o: { env: Readonly<Record<string, string>>; cwd: string; timeoutMs: number },
  ) => Promise<ProcResult>;
  readonly readText: (absPath: string) => Promise<string | null>;
  readonly listFiles: (absDir: string) => Promise<readonly string[]>;
  readonly removeDir: (absDir: string) => Promise<void>;
  readonly exists: (absPath: string) => Promise<boolean>;
  readonly isAlive: (pid: number) => boolean;
  readonly signal: (pid: number, sig: NodeJS.Signals) => void;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly env: (name: EnvName) => string | undefined;
  readonly fetch: typeof globalThis.fetch;
};

export const APP_ROOT: string = fileURLToPath(new URL('../../../', import.meta.url));
export const RECORDER_URL: string = new URL('./preload/egress-recorder.mjs', import.meta.url).href;

// ───────── 실패 ─────────

function fail(failure: StackFailure): Error {
  return new Error(`spawn-stack: ${failure.code}: ${failure.detail}`, { cause: failure });
}

/** `spawn-stack`이 던진 오류에서 `StackFailure`를 꺼낸다(아니면 null). */
export function stackFailureOf(e: unknown): StackFailure | null {
  if (e instanceof Error && isStackFailure(e.cause)) {
    return e.cause;
  }
  return null;
}

const FAILURE_CODES: ReadonlySet<string> = new Set<StackFailureCode>([
  'build_missing',
  'recorder_missing',
  'migrate_failed',
  'up_failed',
  'registry_invalid',
  'wait_timeout',
  'not_running',
  'bootstrap_failed',
  'stop_failed',
]);
function isStackFailure(v: unknown): v is StackFailure {
  return (
    typeof v === 'object' &&
    v !== null &&
    'code' in v &&
    typeof v.code === 'string' &&
    FAILURE_CODES.has(v.code) &&
    'detail' in v &&
    typeof v.detail === 'string'
  );
}

function errnoOf(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}

// ───────── 기본 deps ─────────

export function realStackDeps(): StackDeps {
  return {
    async spawn(bin, args, o): Promise<ProcResult> {
      const r = await safeSpawn(bin, args, { env: o.env, cwd: o.cwd, timeoutMs: o.timeoutMs });
      return {
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderrTail: r.stderrTail,
        timedOut: r.timedOut,
        spawnError: r.spawnError,
      };
    },
    async readText(p): Promise<string | null> {
      try {
        return await readFile(p, 'utf8');
      } catch (e) {
        if (errnoOf(e) === 'ENOENT' || errnoOf(e) === 'ENOTDIR') {
          return null;
        }
        throw e;
      }
    },
    async listFiles(dir): Promise<readonly string[]> {
      try {
        return await readdir(dir);
      } catch (e) {
        if (errnoOf(e) === 'ENOENT' || errnoOf(e) === 'ENOTDIR') {
          return [];
        }
        throw e;
      }
    },
    async removeDir(dir): Promise<void> {
      await rm(dir, { recursive: true, force: true });
    },
    async exists(p): Promise<boolean> {
      try {
        await stat(p);
        return true;
      } catch (e) {
        if (errnoOf(e) === 'ENOENT' || errnoOf(e) === 'ENOTDIR') {
          return false;
        }
        throw e;
      }
    },
    isAlive(pid): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return errnoOf(e) === 'EPERM';
      }
    },
    signal(pid, sig): void {
      try {
        process.kill(pid, sig);
      } catch (e) {
        if (errnoOf(e) !== 'ESRCH') {
          throw e;
        }
      }
    },
    now: (): number => performance.now(),
    sleep: (ms): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    env: (name): string | undefined => readAllowedEnv(name),
    fetch: globalThis.fetch,
  };
}

// ───────── 경로 · 실행 형태 ─────────

const SERVICE_DIR: Readonly<Record<StackService, string>> = {
  gateway: 'gateway',
  content: 'content',
  learning: 'learning',
  'ai-gateway': 'ai-gateway',
  'ops-api': 'ops',
};
const ENTRY_TABLE: Readonly<Record<StackRuntime, Readonly<Record<StackService, string>>>> = {
  dist: {
    gateway: 'services/gateway/dist/main.js',
    content: 'services/content/dist/main.js',
    learning: 'services/learning/dist/main.js',
    'ai-gateway': 'services/ai-gateway/dist/main.js',
    'ops-api': 'services/ops/dist/main.js',
  },
  src: {
    gateway: 'services/gateway/src/main.ts',
    content: 'services/content/src/main.ts',
    learning: 'services/learning/src/main.ts',
    'ai-gateway': 'services/ai-gateway/src/main.ts',
    'ops-api': 'services/ops/src/main.ts',
  },
};
const EXEC_ARGV: Readonly<Record<StackRuntime, readonly string[]>> = {
  dist: ['--disable-warning=ExperimentalWarning'],
  src: ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source'],
};
const CLI_ENTRY: Readonly<Record<StackRuntime, string>> = {
  dist: 'apps/cli/bin/fathom.mjs',
  src: 'apps/cli/src/main.ts',
};
const ALL_SERVICES: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];

function rootUrl(appRoot: string): URL {
  return pathToFileURL(path.join(appRoot, path.sep));
}
function inRoot(appRoot: string, relative: string): string {
  return fileURLToPath(new URL(relative, rootUrl(appRoot)));
}

export function serviceEntry(
  appRoot: string,
  svc: StackService,
  runtime: StackRuntime,
): { readonly entry: string; readonly execArgv: readonly string[] } {
  return { entry: inRoot(appRoot, ENTRY_TABLE[runtime][svc]), execArgv: EXEC_ARGV[runtime] };
}

export function cliInvocation(
  appRoot: string,
  runtime: StackRuntime,
  args: readonly string[],
): { readonly bin: string; readonly args: readonly string[] } {
  return { bin: process.execPath, args: [...EXEC_ARGV[runtime], inRoot(appRoot, CLI_ENTRY[runtime]), ...args] };
}

async function precheck(
  appRoot: string,
  runtime: StackRuntime,
  egress: 'record' | 'off',
  deps: StackDeps,
): Promise<void> {
  const required =
    runtime === 'dist'
      ? [
          'apps/cli/dist/main.js',
          'services/ops/dist/supervisor/main.js',
          ...ALL_SERVICES.map((s) => ENTRY_TABLE.dist[s]),
          'apps/web/dist/index.html',
        ]
      : ['apps/web/dist/index.html'];
  const missing: string[] = [];
  for (const rel of required) {
    if (!(await deps.exists(inRoot(appRoot, rel)))) {
      missing.push(rel);
    }
  }
  if (missing.length > 0) {
    throw fail({ code: 'build_missing', detail: `missing: ${missing.join(', ')} — pnpm build 먼저` });
  }
  if (egress === 'record' && !(await deps.exists(fileURLToPath(RECORDER_URL)))) {
    throw fail({ code: 'recorder_missing', detail: `egress recorder not found: ${RECORDER_URL}` });
  }
}

// ───────── env ─────────

const ENV_KEYS: readonly EnvName[] = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'];

export function stackEnv(o: {
  home: string;
  recorderUrl: string | null;
  env: StackDeps['env'];
}): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const keys: readonly EnvName[] = process.platform === 'win32' ? [...ENV_KEYS, 'SYSTEMROOT'] : ENV_KEYS;
  for (const key of keys) {
    const value = o.env(key);
    if (value !== undefined && value !== '') {
      out[key] = value;
    }
  }
  out.FATHOM_HOME = o.home;
  if (o.recorderUrl !== null) {
    if (/\s/.test(o.recorderUrl)) {
      throw fail({
        code: 'recorder_missing',
        detail: 'recorder url contains whitespace (NODE_OPTIONS is space-split)',
      });
    }
    out.NODE_OPTIONS = `--import=${o.recorderUrl}`;
  }
  return out;
}

// ───────── registry · lock (T-00-11 §4.1.2 형식의 독립 파서) ─────────

const RegistryServiceView = z
  .object({
    pid: z.number().int().min(1).nullable(),
    port: z.number().int().min(0).max(65535).nullable(),
    state: ServiceState,
    started_at: EpochMs.nullable(),
    restarts: z.number().int().min(0),
    last_exit_code: z.number().int().nullable(),
    reason: z.string().max(120).nullable(),
  })
  .strict();
export type RegistryServiceView = z.infer<typeof RegistryServiceView>;
const RegistryView = z
  .object({
    v: z.literal(1),
    boot_id: Ulid,
    profile: RuntimeProfile,
    app_version: SemVer,
    supervisor_pid: z.number().int().min(1),
    state: z.enum(['starting', 'ready', 'degraded', 'stopping', 'stopped']),
    updated_at: EpochMs,
    services: z.partialRecord(SupervisedService, RegistryServiceView),
    notices: z.array(z.string().max(120)).max(20),
  })
  .strict();
export type RegistryView = z.infer<typeof RegistryView>;
const LockView = z
  .object({
    pid: z.number().int().min(1),
    boot_id: Ulid,
    version: SemVer,
    started_at: EpochMs,
    profile: RuntimeProfile,
  })
  .strict();
export type LockView = z.infer<typeof LockView>;

function parseWith<T>(schema: z.ZodType<T>, text: string): Result<T, string> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err('invalid_json');
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(parsed.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(','));
}
export function parseRegistry(text: string): Result<RegistryView, string> {
  return parseWith(RegistryView, text);
}
export function parseLock(text: string): Result<LockView, string> {
  return parseWith(LockView, text);
}

export function allReady(r: RegistryView): boolean {
  if (r.state !== 'ready' || 'vite' in r.services) {
    return false;
  }
  return ALL_SERVICES.every((svc) => {
    const s = r.services[svc];
    return s !== undefined && s.state === 'ready' && s.pid !== null && s.port !== null;
  });
}

// ───────── 마이그레이션 ─────────

function lastLines(text: string, n: number): string {
  return text.split('\n').slice(-n).join('\n');
}

export async function migrateHome(
  o: { appRoot: string; home: string; runtime: StackRuntime; egress: 'record' | 'off' },
  deps: StackDeps = realStackDeps(),
): Promise<readonly { svc: StackService; result: ProcResult }[]> {
  const env = stackEnv({
    home: o.home,
    recorderUrl: o.egress === 'record' ? RECORDER_URL : null,
    env: deps.env,
  });
  const results: { svc: StackService; result: ProcResult }[] = [];
  for (const svc of MIGRATE_ORDER) {
    const { entry, execArgv } = serviceEntry(o.appRoot, svc, o.runtime);
    const result = await deps.spawn(process.execPath, [...execArgv, entry, '--mode=migrate'], {
      env,
      cwd: o.appRoot,
      timeoutMs: 60_000,
    });
    results.push({ svc, result });
    if (result.exitCode !== 0) {
      throw fail({
        code: 'migrate_failed',
        detail: `${svc} migrate exit ${String(result.exitCode)}`,
        svc,
        exitCode: result.exitCode,
        stderrTail: result.stderrTail,
        stdout: lastLines(result.stdout, 20),
      });
    }
  }
  return results;
}

// ───────── 관측 ─────────

export type EgressRecord = { readonly kind: string; readonly target: string; readonly [key: string]: unknown };
export type EgressScan = { files: number; records: EgressRecord[]; invalidLines: number };
export type LogScan = {
  files: number;
  bySvc: Record<string, number>;
  rawRecords: { svc: string; raw: string }[];
  invalidJson: number;
  warningLines: string[];
};
export const WARNING_RE = /(ExperimentalWarning|DeprecationWarning|\(node:\d+\)|Warning:)/;

function jsonLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim() !== '');
}
function parseObject(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...v } : null;
  } catch {
    return null;
  }
}

export async function scanEgress(home: string, deps: StackDeps): Promise<EgressScan> {
  const dir = homePath(home, 'tmp', 'egress');
  const scan: EgressScan = { files: 0, records: [], invalidLines: 0 };
  for (const name of (await deps.listFiles(dir)).filter((n) => n.endsWith('.jsonl'))) {
    scan.files += 1;
    for (const line of jsonLines((await deps.readText(homePath(home, 'tmp', 'egress', name))) ?? '')) {
      const obj = parseObject(line);
      if (obj !== null && typeof obj.kind === 'string' && typeof obj.target === 'string') {
        scan.records.push({ ...obj, kind: obj.kind, target: obj.target });
      } else {
        scan.invalidLines += 1;
      }
    }
  }
  return scan;
}

/** 로그 한 서비스분 텍스트를 `scan`에 더한다(E2E-104 대조군도 이 함수를 쓴다). */
export function scanLogText(scan: LogScan, svc: string, text: string): void {
  for (const line of jsonLines(text)) {
    const obj = parseObject(line);
    if (obj === null) {
      scan.invalidJson += 1;
    } else {
      scan.bySvc[svc] = (scan.bySvc[svc] ?? 0) + 1;
      if ('raw' in obj) {
        scan.rawRecords.push({ svc, raw: String(obj.raw) });
      }
    }
    if (WARNING_RE.test(line)) {
      scan.warningLines.push(line.slice(0, 200));
    }
  }
}

export async function scanLogs(home: string, deps: StackDeps): Promise<LogScan> {
  const scan: LogScan = { files: 0, bySvc: {}, rawRecords: [], invalidJson: 0, warningLines: [] };
  for (const svc of await deps.listFiles(homePath(home, 'logs'))) {
    const dir = homePath(home, 'logs', svc);
    for (const name of (await deps.listFiles(dir)).filter((n) => n.endsWith('.jsonl'))) {
      scan.files += 1;
      scanLogText(scan, svc, (await deps.readText(homePath(home, 'logs', svc, name))) ?? '');
    }
  }
  return scan;
}

// ───────── Stack ─────────

export type StopReport = {
  downExitCode: number | null;
  forced: boolean;
  egress: EgressScan;
  logs: LogScan;
  finalRegistry: RegistryView | null;
};
export interface Stack {
  readonly appRoot: string;
  readonly home: string;
  readonly runtime: StackRuntime;
  readonly gatewayUrl: string;
  readonly supervisorPid: number;
  readonly bootMs: number;
  readonly migrations: readonly { svc: StackService; result: ProcResult }[];
  readonly upResult: ProcResult;
  registry(): Promise<RegistryView>;
  pidOf(svc: StackService): Promise<number>;
  portOf(svc: StackService): Promise<number>;
  cliToken(): Promise<string>;
  waitForState(
    svc: StackService,
    state: 'ready' | 'degraded' | 'stopped',
    o?: { notPid?: number; timeoutMs?: number },
  ): Promise<RegistryServiceView>;
  restart(svc: StackService): Promise<{ readonly oldPid: number; readonly newPid: number }>;
  bootstrapOpenUrl(): Promise<string>;
  egressRecords(): Promise<EgressScan>;
  serviceLogs(): Promise<LogScan>;
  stop(): Promise<StopReport>;
}
export type StackOptions = {
  readonly runtime?: StackRuntime;
  readonly home?: string;
  readonly egress?: 'record' | 'off';
  readonly safe?: boolean;
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error';
  readonly migrate?: boolean;
  readonly upTimeoutMs?: number;
};

type Ctx = {
  readonly appRoot: string;
  readonly home: string;
  readonly runtime: StackRuntime;
  readonly deps: StackDeps;
};

function ctxEnv(c: Ctx, egress: 'record' | 'off'): Readonly<Record<string, string>> {
  return stackEnv({ home: c.home, recorderUrl: egress === 'record' ? RECORDER_URL : null, env: c.deps.env });
}

async function readRegistryFile(c: Ctx): Promise<Result<RegistryView, string> | null> {
  const text = await c.deps.readText(homePath(c.home, 'run', 'registry.json'));
  return text === null ? null : parseRegistry(text);
}
async function readLockFile(c: Ctx): Promise<Result<LockView, string> | null> {
  const text = await c.deps.readText(homePath(c.home, 'run', 'supervisor.lock'));
  return text === null ? null : parseLock(text);
}

async function poll<T>(c: Ctx, timeoutMs: number, probe: () => Promise<T | null>): Promise<T | null> {
  const t0 = c.deps.now();
  for (;;) {
    const value = await probe();
    if (value !== null) {
      return value;
    }
    if (c.deps.now() - t0 >= timeoutMs) {
      return null;
    }
    await c.deps.sleep(25);
  }
}

async function servicePids(c: Ctx): Promise<number[]> {
  const reg = await readRegistryFile(c);
  if (reg === null || !reg.ok) {
    return [];
  }
  return Object.values(reg.value.services).flatMap((s) => (s?.pid === null || s === undefined ? [] : [s.pid]));
}

/** 정지 요청이 먹지 않은 supervisor·서비스를 SIGTERM → 5s → SIGKILL로 정리한다(`up_failed` 정리·`stop` 강제). */
async function killLeftovers(c: Ctx, graceful: boolean): Promise<boolean> {
  const lock = await readLockFile(c);
  const pids = await servicePids(c);
  let forced = false;
  if (lock !== null && lock.ok && c.deps.isAlive(lock.value.pid)) {
    const sup = lock.value.pid;
    if (graceful) {
      c.deps.signal(sup, 'SIGTERM');
      const dead = await poll(c, 5_000, () => Promise.resolve(c.deps.isAlive(sup) ? null : true));
      forced = dead === null;
    } else {
      forced = true;
    }
    if (c.deps.isAlive(sup)) {
      c.deps.signal(sup, 'SIGKILL');
    }
  }
  for (const pid of pids) {
    if (c.deps.isAlive(pid)) {
      c.deps.signal(pid, 'SIGKILL');
      forced = true;
    }
  }
  return forced;
}

async function rootVersion(c: Ctx): Promise<string> {
  const text = await c.deps.readText(inRoot(c.appRoot, 'package.json'));
  if (text !== null) {
    const v: unknown = JSON.parse(text);
    if (typeof v === 'object' && v !== null && 'version' in v && typeof v.version === 'string') {
      return v.version;
    }
  }
  return '0.0.0';
}

const OPEN_URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/#bt=[A-Za-z0-9_-]{43}$/;

async function bootstrapOpen(c: Ctx, gatewayUrl: string, token: string, key: string): Promise<string> {
  const version = await rootVersion(c);
  const res = await c.deps.fetch(new URL('/api/v1/cli/bootstrap-token', gatewayUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
      accept: 'application/json',
      'idempotency-key': key,
      'x-fathom-client': `cli/${version}`,
    },
    body: '{"purpose":"open"}',
    signal: AbortSignal.timeout(10_000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const bodyObj = typeof body === 'object' && body !== null ? body : {};
  if (res.status !== 201) {
    const code = 'code' in bodyObj && typeof bodyObj.code === 'string' ? bodyObj.code : 'n/a';
    throw fail({ code: 'bootstrap_failed', detail: `status ${String(res.status)} code ${code}` });
  }
  const openUrl = 'open_url' in bodyObj ? bodyObj.open_url : undefined;
  if (typeof openUrl !== 'string' || !OPEN_URL_RE.test(openUrl)) {
    throw fail({ code: 'bootstrap_failed', detail: 'open_url missing or malformed' });
  }
  return openUrl;
}

async function runStop(c: Ctx, egress: 'record' | 'off'): Promise<StopReport> {
  const { deps } = c;
  const preEgress = await scanEgress(c.home, deps); // 정지 전 관측(정지 실패 진단용)
  const preLogs = await scanLogs(c.home, deps);
  const lock = await readLockFile(c);
  const supPid = lock !== null && lock.ok ? lock.value.pid : null;
  const pids = await servicePids(c);
  const cli = cliInvocation(c.appRoot, c.runtime, ['down', '--profile=test']);
  const down = await deps.spawn(cli.bin, cli.args, { env: ctxEnv(c, egress), cwd: c.appRoot, timeoutMs: 30_000 });
  const lockPath = homePath(c.home, 'run', 'supervisor.lock');
  const t0 = deps.now();
  let forced = false;
  for (;;) {
    const gone = (supPid === null || !deps.isAlive(supPid)) && !(await deps.exists(lockPath));
    if (gone) {
      break;
    }
    if (deps.now() - t0 >= 15_000) {
      forced = true;
      break;
    }
    await deps.sleep(100);
  }
  if (forced) {
    await killLeftovers(c, false);
  }
  const alive = await poll(c, forced ? 2_000 : 0, () =>
    Promise.resolve(pids.some((p) => deps.isAlive(p)) ? null : true),
  );
  if (alive === null) {
    const left = pids.filter((p) => deps.isAlive(p)).join(',');
    throw fail({
      code: 'stop_failed',
      detail: `service pids still alive: ${left} (pre-stop egress ${String(preEgress.records.length)}, log files ${String(preLogs.files)})`,
    });
  }
  const egressScan = await scanEgress(c.home, deps);
  const logs = await scanLogs(c.home, deps);
  const final = await readRegistryFile(c);
  await deps.removeDir(homePath(c.home, 'tmp', 'egress'));
  return {
    downExitCode: down.exitCode,
    forced,
    egress: egressScan,
    logs,
    finalRegistry: final !== null && final.ok ? final.value : null,
  };
}

function buildStack(
  c: Ctx,
  egress: 'record' | 'off',
  base: Pick<Stack, 'gatewayUrl' | 'supervisorPid' | 'bootMs' | 'migrations' | 'upResult'>,
): Stack {
  const nextKey = createUlidSequence(1_000);
  let stopping: Promise<StopReport> | null = null;
  const registry = async (): Promise<RegistryView> => {
    const reg = await readRegistryFile(c);
    if (reg === null) {
      throw fail({ code: 'not_running', detail: 'run/registry.json missing' });
    }
    if (!reg.ok) {
      throw fail({ code: 'registry_invalid', detail: reg.error });
    }
    return reg.value;
  };
  const view = async (svc: StackService): Promise<RegistryServiceView & { pid: number; port: number }> => {
    const s = (await registry()).services[svc];
    if (s === undefined || s.pid === null || s.port === null) {
      throw fail({ code: 'not_running', detail: `${svc} has no pid/port`, svc });
    }
    return { ...s, pid: s.pid, port: s.port };
  };
  const cliToken = async (): Promise<string> => {
    const token = ((await c.deps.readText(homePath(c.home, 'run', 'cli.token'))) ?? '').trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw fail({ code: 'not_running', detail: 'run/cli.token missing or malformed' });
    }
    return token;
  };
  const waitForState: Stack['waitForState'] = async (svc, state, o) => {
    const timeoutMs = o?.timeoutMs ?? 15_000;
    let last: RegistryView | null = null;
    const hit = await poll(c, timeoutMs, async () => {
      const reg = await readRegistryFile(c);
      last = reg !== null && reg.ok ? reg.value : last;
      const s = last?.services[svc];
      const pidOk = o?.notPid === undefined || s?.pid !== o.notPid;
      return s !== undefined && s.state === state && pidOk ? s : null;
    });
    if (hit === null) {
      throw fail({
        code: 'wait_timeout',
        detail: `${svc} did not reach ${state} in ${String(timeoutMs)}ms`,
        svc,
        registry: last,
      });
    }
    return hit;
  };
  return {
    appRoot: c.appRoot,
    home: c.home,
    runtime: c.runtime,
    ...base,
    registry,
    pidOf: async (svc) => (await view(svc)).pid,
    portOf: async (svc) => (await view(svc)).port,
    cliToken,
    waitForState,
    async restart(svc): Promise<{ readonly oldPid: number; readonly newPid: number }> {
      const oldPid = (await view(svc)).pid;
      c.deps.signal(oldPid, 'SIGKILL');
      const next = await waitForState(svc, 'ready', { notPid: oldPid });
      return { oldPid, newPid: next.pid ?? oldPid };
    },
    async bootstrapOpenUrl(): Promise<string> {
      return await bootstrapOpen(c, base.gatewayUrl, await cliToken(), nextKey());
    },
    egressRecords: () => scanEgress(c.home, c.deps),
    serviceLogs: () => scanLogs(c.home, c.deps),
    stop(): Promise<StopReport> {
      stopping ??= runStop(c, egress);
      return stopping;
    },
  };
}

/** 사전 검사 → (migrate) → `fathom up --profile=test` → registry·lock 검증. 실패하면 남은 프로세스를 정리하고 던진다. */
export async function launchStack(opts: StackOptions = {}, deps: StackDeps = realStackDeps()): Promise<Stack> {
  const runtime = opts.runtime ?? 'dist';
  const egress = opts.egress ?? 'record';
  const appRoot = APP_ROOT;
  await precheck(appRoot, runtime, egress, deps);
  const home = opts.home ?? (await createTempHome('fathom-stack-')).path;
  const c: Ctx = { appRoot, home, runtime, deps };
  const migrations = opts.migrate === false ? [] : await migrateHome({ appRoot, home, runtime, egress }, deps);
  const cli = cliInvocation(appRoot, runtime, [
    'up',
    '--profile=test',
    '--no-open',
    `--log-level=${opts.logLevel ?? 'info'}`,
    ...(opts.safe === true ? ['--safe'] : []),
  ]);
  const t0 = deps.now();
  const upResult = await deps.spawn(cli.bin, cli.args, {
    env: ctxEnv(c, egress),
    cwd: appRoot,
    timeoutMs: opts.upTimeoutMs ?? 45_000,
  });
  const bootMs = deps.now() - t0;
  const reg = await readRegistryFile(c);
  const regValue = reg !== null && reg.ok ? reg.value : null;
  const upFailed = (detail: string): Promise<never> =>
    killLeftovers(c, true).then(() => {
      throw fail({
        code: 'up_failed',
        detail,
        exitCode: upResult.exitCode,
        stdout: upResult.stdout,
        stderrTail: upResult.stderrTail,
        registry: regValue,
      });
    });
  if (upResult.exitCode !== 0 || upResult.timedOut) {
    return await upFailed(`fathom up exit ${String(upResult.exitCode)} timedOut=${String(upResult.timedOut)}`);
  }
  const lock = await readLockFile(c);
  if (lock === null || !lock.ok || reg === null || !reg.ok) {
    const why = lock === null || !lock.ok ? 'supervisor.lock' : 'registry.json';
    await killLeftovers(c, true);
    throw fail({
      code: 'registry_invalid',
      detail: `${why} missing or invalid`,
      stdout: upResult.stdout,
      stderrTail: upResult.stderrTail,
    });
  }
  const gateway = reg.value.services.gateway;
  if (!allReady(reg.value) || gateway === undefined || gateway.port === null) {
    return await upFailed('fathom up exited 0 but registry is not all ready');
  }
  return buildStack(c, egress, {
    gatewayUrl: `http://127.0.0.1:${String(gateway.port)}`,
    supervisorPid: lock.value.pid,
    bootMs,
    migrations,
    upResult,
  });
}
