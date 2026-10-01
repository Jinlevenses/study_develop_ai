import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

// STD-SEC-04 · AI-01 §4.4·§4.5 — 외부 프로세스는 `safeSpawn`(shell:false)로만 띄운다. `node:child_process`는 `proc`·`jobs`에서만(STD-TS-40).

export type SafeSpawnOptions = {
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly stdin?: string | Uint8Array;
  readonly maxStdoutBytes?: number /* 기본 8 MiB */;
  readonly maxStderrBytes?: number /* 기본 64 KiB 링 */;
  readonly platform?: NodeJS.Platform;
};
export type SafeSpawnResult = {
  readonly pid: number | null;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderrTail: string;
  readonly timedOut: boolean;
  readonly outputOverflow: boolean;
  readonly spawnError: string | null;
};

const DEFAULT_MAX_STDOUT = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR = 64 * 1024;
const CLOSE_GRACE_MS = 1000;

function errnoCode(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') {
    return e.code;
  }
  return null;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ───────── treeKill ─────────

export type TreeKillDeps = {
  platform?: NodeJS.Platform;
  kill?: (pid: number, sig: NodeJS.Signals) => void;
  execFile?: (file: string, args: readonly string[]) => void;
};

function defaultExecFile(file: string, args: readonly string[]): void {
  execFile(file, [...args], { windowsHide: true }, (error) => {
    // 이미 종료된 프로세스에 대한 taskkill 실패(128)는 정상이다 — 무시한다.
    void error;
  });
}

/**
 * 프로세스 트리를 죽인다(타임아웃·출력 초과·부모 종료). POSIX는 자식이 `detached`(새 프로세스 그룹)이므로 `-pid` 그룹에 SIGKILL,
 * win32는 `taskkill /T /F`. `ESRCH`(이미 없음)는 무시하고 그 밖 오류는 호출자에게 던진다.
 */
export function treeKill(pid: number, deps?: TreeKillDeps): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('invariant: treeKill pid must be a positive integer');
  }
  const platform = deps?.platform ?? process.platform;
  if (platform === 'win32') {
    (deps?.execFile ?? defaultExecFile)('taskkill', ['/T', '/F', '/PID', String(pid)]);
    return;
  }
  const kill = deps?.kill ?? ((p: number, sig: NodeJS.Signals): void => void process.kill(p, sig));
  try {
    kill(-pid, 'SIGKILL');
  } catch (e) {
    if (errnoCode(e) === 'ESRCH') {
      return; // 이미 종료된 그룹
    }
    throw e;
  }
}

// ───────── safeSpawn ─────────

/** 마지막 `max` 바이트만 유지하는 링(AI-01 §4.4: stderr 64 KiB). */
function createTailRing(max: number): { push(chunk: Buffer): void; tail(): string } {
  let chunks: Buffer[] = [];
  let size = 0;
  function compact(): void {
    const all = Buffer.concat(chunks);
    const tail = all.subarray(Math.max(0, all.length - max));
    chunks = [tail];
    size = tail.length;
  }
  return {
    push(chunk: Buffer): void {
      chunks.push(chunk);
      size += chunk.length;
      if (size > max * 2) {
        compact();
      }
    },
    tail(): string {
      compact();
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

/**
 * `shell:false`·부모 env 병합 0·`detached`(POSIX)·모든 스트림에 `error` 리스너. 비밀은 `stdin`으로만 넘긴다(STD-SEC-04).
 * 결함(상대 경로·win32 `.cmd`)은 던지고, spawn 실패(`ENOENT` 등)는 `spawnError`로 resolve한다.
 */
export async function safeSpawn(
  bin: string,
  args: readonly string[],
  opts: SafeSpawnOptions,
): Promise<SafeSpawnResult> {
  const platform = opts.platform ?? process.platform;
  const isAbsolute = platform === 'win32' ? path.win32.isAbsolute(bin) : path.posix.isAbsolute(bin);
  if (!isAbsolute) {
    throw new Error('invariant: safeSpawn bin must be an absolute path');
  }
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    throw new Error(
      'invariant: safeSpawn cannot run .cmd/.bat on win32 — resolve the shim with resolveWindowsShim first',
    );
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error('invariant: safeSpawn timeoutMs must be positive');
  }
  const maxStdout = opts.maxStdoutBytes ?? DEFAULT_MAX_STDOUT;
  const maxStderr = opts.maxStderrBytes ?? DEFAULT_MAX_STDERR;

  return await new Promise<SafeSpawnResult>((resolve) => {
    let stdout = '';
    let stdoutBytes = 0;
    let timedOut = false;
    let outputOverflow = false;
    let spawnError: string | null = null;
    let settled = false;
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    const stderr = createTailRing(maxStderr);
    let timer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const child = spawn(bin, [...args], {
      shell: false,
      env: { ...opts.env },
      cwd: opts.cwd,
      stdio: 'pipe',
      detached: platform !== 'win32',
      windowsHide: true,
    });
    const pid = child.pid ?? null;

    function settle(): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve({
        pid,
        exitCode: exitInfo?.code ?? null,
        signal: exitInfo?.signal ?? null,
        stdout,
        stderrTail: stderr.tail(),
        timedOut,
        outputOverflow,
        spawnError,
      });
    }

    function kill(): void {
      if (pid === null) {
        return;
      }
      try {
        treeKill(pid, { platform });
      } catch (e) {
        spawnError = `kill_failed:${errnoCode(e) ?? messageOf(e)}`;
      }
    }

    child.once('error', (e: Error) => {
      spawnError = errnoCode(e) ?? e.message;
      if (pid === null) {
        settle();
      }
    });
    child.stdout.on('error', (e: Error) => {
      spawnError ??= `stdout:${errnoCode(e) ?? e.message}`;
    });
    child.stderr.on('error', (e: Error) => {
      spawnError ??= `stderr:${errnoCode(e) ?? e.message}`;
    });
    child.stdin.on('error', (e: Error) => {
      // 자식이 stdin을 다 읽기 전에 끝나면 EPIPE — 정상 경로다. 그 밖만 기록한다.
      if (errnoCode(e) !== 'EPIPE') {
        spawnError ??= `stdin:${errnoCode(e) ?? e.message}`;
      }
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (outputOverflow) {
        return;
      }
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      if (stdoutBytes >= maxStdout) {
        outputOverflow = true;
        kill();
        return;
      }
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.once('exit', (code, signal) => {
      exitInfo = { code, signal };
      // 손자가 파이프를 쥔 채 남으면 'close'가 오지 않는다 — 유예 뒤 결과를 확정한다.
      graceTimer = setTimeout(settle, CLOSE_GRACE_MS);
      graceTimer.unref();
    });
    child.once('close', (code, signal) => {
      exitInfo ??= { code, signal };
      settle();
    });

    timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    timer.unref();

    if (opts.stdin === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(opts.stdin);
    }
  });
}

// ───────── Windows shim ─────────

export type ShimResolution =
  | { readonly kind: 'node_script'; readonly script: string }
  | { readonly kind: 'exe'; readonly exe: string };

const SHIM_JS_PATTERN = /"(?:%dp0%|%~dp0)\\([^"\r\n]*?\.(?:js|cjs|mjs))"/gi;
const SHIM_EXE_PATTERN = /"(?:%dp0%|%~dp0)\\([^"\r\n]*?\.exe)"/gi;

function lastCapture(pattern: RegExp, text: string): string | null {
  let last: string | null = null;
  for (const match of text.matchAll(pattern)) {
    last = match[1] ?? last;
  }
  return last;
}

/**
 * npm cmd-shim `.cmd` 텍스트에서 실제 실행 대상을 찾는다(AI-01 §4.5-2). `"%dp0%\<상대>"`·`"%~dp0\<상대>"`로 쓰인
 * **마지막** JS 경로 → `node_script`, JS가 없고 `.exe`가 있으면 `exe`, 둘 다 없으면 `unrecognized`. 순수 함수.
 */
export function parseWindowsShim(cmdPath: string, cmdText: string): Result<ShimResolution, { reason: 'unrecognized' }> {
  const base = path.win32.dirname(cmdPath);
  const script = lastCapture(SHIM_JS_PATTERN, cmdText);
  if (script !== null) {
    return ok({ kind: 'node_script', script: path.win32.resolve(base, script) });
  }
  const exe = lastCapture(SHIM_EXE_PATTERN, cmdText);
  if (exe !== null) {
    return ok({ kind: 'exe', exe: path.win32.resolve(base, exe) });
  }
  return err({ reason: 'unrecognized' });
}

export async function resolveWindowsShim(
  cmdPath: string,
): Promise<Result<ShimResolution, { reason: 'unrecognized' | 'unreadable' }>> {
  let text: string;
  try {
    text = await readFile(cmdPath, 'utf8');
  } catch {
    return err({ reason: 'unreadable' });
  }
  return parseWindowsShim(cmdPath, text);
}
