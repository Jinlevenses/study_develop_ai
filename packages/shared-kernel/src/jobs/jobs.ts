import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import type { JobName } from '@fathom/contracts/admin/jobs';
import { IpcJob } from '@fathom/contracts/admin/jobs';
import { ALLOWED_ENV, readAllowedEnv } from '@fathom/shared-kernel/config/config';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import { treeKill } from '@fathom/shared-kernel/proc/proc';

// ARC-01 §17.3 · IF-IPC-018~022 · ADR-012 §4 — 단명 job 자식 프로세스. job은 supervisor 밖에서 돌고, IPC가 끊기면 자식은 종료하며,
// 자식의 stdout·stderr는 줄 단위로 부모가 중계한다. `node:child_process`는 `jobs`·`proc`에서만(STD-TS-40).

// ───────── 자식 쪽 ─────────

export type JobContext = { progress(pct: number | null, step: string): void; readonly signal: AbortSignal };
export type JobHandler = (args: Readonly<Record<string, unknown>>, ctx: JobContext) => Promise<Record<string, unknown>>;
export type JobDefinition = { readonly name: JobName; readonly handler: JobHandler };

export function defineJob(name: JobName, handler: JobHandler): JobDefinition {
  return { name, handler };
}

export interface JobChannel {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onDisconnect(cb: () => void): void;
}

/** `process.send`·`'message'`·`'disconnect'` 래핑 — 진입점(`--mode=job`)에서만 호출한다. */
export function processJobChannel(): JobChannel {
  return {
    send(msg: unknown): void {
      if (process.send === undefined) {
        throw new Error('invariant: processJobChannel requires an IPC channel (fork with stdio ipc)');
      }
      process.send(msg);
    },
    onMessage(cb: (msg: unknown) => void): void {
      process.on('message', cb);
    },
    onDisconnect(cb: () => void): void {
      process.on('disconnect', cb);
    },
  };
}

const EXIT_OK = 0;
const EXIT_USAGE = 64; // 잘못된 호출(프로토콜 위반·알 수 없는 job)
const EXIT_SOFTWARE = 70; // 핸들러 실패·부모 사망

function clampPct(pct: number | null): number | null {
  if (pct === null || !Number.isFinite(pct)) {
    return null;
  }
  return Math.min(100, Math.max(0, pct));
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 자식 쪽 루프. 반환값 = 진입점이 `process.exit`에 쓸 종료 코드:
 * result 0 · 핸들러 예외 70 · 알 수 없는 job·프로토콜 위반 64 · cancel 0 · 채널 끊김(부모 사망) 70.
 * 보내는 메시지는 전부 `IpcJob`으로 parse한 뒤 송신하며 `re` = `job.start`의 `id`다.
 */
export function serveJob(defs: readonly JobDefinition[], channel: JobChannel): Promise<number> {
  return new Promise<number>((resolve) => {
    const controller = new AbortController();
    let jobId: string | undefined;
    let started = false;
    let concluded = false;

    const conclude = (code: number): void => {
      if (concluded) {
        return;
      }
      concluded = true;
      resolve(code);
    };

    /** 송신. 채널이 닫혔으면(부모 사망) 70으로 끝낸다. */
    const emit = (message: Record<string, unknown>): boolean => {
      const parsed = IpcJob.safeParse({ v: 1, ...(jobId === undefined ? {} : { re: jobId }), ...message });
      if (!parsed.success) {
        // 핸들러 결과가 IpcJob에 맞지 않는 경우 — throw하면 promise 콜백에서 미처리 거부로 남아 job이 멈춘다(T-00-04 리뷰 minor).
        controller.abort();
        conclude(EXIT_SOFTWARE);
        return false;
      }
      try {
        channel.send(parsed.data);
        return true;
      } catch {
        controller.abort();
        conclude(EXIT_SOFTWARE);
        return false;
      }
    };

    const protocolError = (detail: string): void => {
      controller.abort();
      emit({ type: 'job.error', code: 'protocol', message: detail.slice(0, 500) });
      conclude(EXIT_USAGE);
    };

    channel.onDisconnect(() => {
      controller.abort();
      conclude(EXIT_SOFTWARE);
    });

    const run = (def: JobDefinition, args: Record<string, unknown>): void => {
      const ctx: JobContext = {
        progress(pct: number | null, step: string): void {
          if (concluded) {
            return;
          }
          emit({ type: 'job.progress', pct: clampPct(pct), step: step.slice(0, 60) });
        },
        signal: controller.signal,
      };
      // 핸들러는 동기적으로 시작한다(바로 뒤에 도착하는 cancel이 이미 달린 abort 리스너를 만나도록).
      let running: Promise<Record<string, unknown>>;
      try {
        running = def.handler(args, ctx);
      } catch (e) {
        running = Promise.reject(e);
      }
      running.then(
        (result) => {
          if (concluded) {
            return;
          }
          if (emit({ type: 'job.result', result })) {
            conclude(EXIT_OK);
          }
        },
        (e: unknown) => {
          if (concluded) {
            return;
          }
          if (emit({ type: 'job.error', code: 'handler_failed', message: messageOf(e).slice(0, 500) })) {
            conclude(EXIT_SOFTWARE);
          }
        },
      );
    };

    channel.onMessage((raw) => {
      if (concluded) {
        return;
      }
      const parsed = IpcJob.safeParse(raw);
      if (!started) {
        if (!parsed.success || parsed.data.type !== 'job.start') {
          protocolError('first message must be a valid job.start');
          return;
        }
        const startMsg = parsed.data;
        jobId = startMsg.id;
        const def = defs.find((d) => d.name === startMsg.job);
        if (def === undefined) {
          protocolError(`unknown job: ${startMsg.job}`);
          return;
        }
        started = true;
        run(def, startMsg.args);
        return;
      }
      if (parsed.success && parsed.data.type === 'job.cancel') {
        controller.abort();
        if (emit({ type: 'job.error', code: 'cancelled', message: 'cancelled' })) {
          conclude(EXIT_OK);
        }
        return;
      }
      protocolError('unexpected message after job.start');
    });
  });
}

// ───────── 부모 쪽 ─────────

export type JobRunOptions = {
  readonly timeoutMs: number;
  readonly extraExecArgv?: readonly string[];
  readonly onProgress?: (p: { pct: number | null; step: string }) => void;
};
export type JobFailure = {
  readonly kind: 'queue_full' | 'timeout' | 'job_error' | 'cancelled' | 'crashed' | 'protocol';
  readonly code: string | null;
  readonly message: string;
  readonly exitCode: number | null;
};
export interface JobRunner {
  run(
    name: JobName,
    args: Record<string, unknown>,
    opts: JobRunOptions,
  ): Promise<Result<Record<string, unknown>, JobFailure>>;
  cancel(): void;
  isBusy(): boolean;
  shutdown(): Promise<void>;
}
export type JobRunnerOptions = {
  readonly entry: string;
  readonly execArgv?: readonly string[];
  readonly queueMax?: number;
  readonly onStdoutLine?: (line: string) => void;
  readonly onStderrLine?: (line: string) => void;
};

type RunResult = Result<Record<string, unknown>, JobFailure>;
type QueueItem = {
  readonly name: JobName;
  readonly args: Record<string, unknown>;
  readonly opts: JobRunOptions;
  readonly resolve: (r: RunResult) => void;
};
type ActiveJob = { readonly done: Promise<void>; requestCancel(): void; kill(): void };
type Outcome =
  | { readonly type: 'ok'; readonly result: Record<string, unknown> }
  | {
      readonly type: 'fail';
      readonly kind: JobFailure['kind'];
      readonly code: string | null;
      readonly message: string;
    };

const DEFAULT_QUEUE_MAX = 8;
const SHUTDOWN_GRACE_MS = 2000;
const CLOSE_GRACE_MS = 1000;

/** 자식 env = `ALLOWED_ENV` 이름 중 값이 있는 것만(STD-CFG-21). 부모 env 전체를 상속하지 않는다. */
function allowlistedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ALLOWED_ENV) {
    const value = readAllowedEnv(name);
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}

/** 스트림을 줄 단위로 `sink`에 중계한다(마지막 개행 없는 조각은 종료 시 flush). */
function relayLines(stream: NodeJS.ReadableStream, sink: (line: string) => void): void {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      sink(pending.slice(0, newline).replace(/\r$/, ''));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (pending !== '') {
      sink(pending);
      pending = '';
    }
  });
  stream.on('error', () => {
    // 자식이 죽으면서 파이프가 깨질 수 있다 — 결과는 종료 코드로 판정하므로 여기서는 무시한다.
  });
}

export function createJobRunner(opts: JobRunnerOptions): JobRunner {
  const queueMax = opts.queueMax ?? DEFAULT_QUEUE_MAX;
  const onStdout = opts.onStdoutLine ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const onStderr = opts.onStderrLine ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  const queue: QueueItem[] = [];
  let active: ActiveJob | null = null;
  let closed = false;

  const failure = (
    kind: JobFailure['kind'],
    message: string,
    code: string | null = null,
    exitCode: number | null = null,
  ): RunResult => err({ kind, code, message, exitCode });

  function execute(item: QueueItem): { readonly handle: ActiveJob; readonly result: Promise<RunResult> } {
    let resolveResult: (r: RunResult) => void = () => undefined;
    const result = new Promise<RunResult>((resolve) => {
      resolveResult = resolve;
    });
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const jobId = ulid();
    const start = IpcJob.safeParse({ type: 'job.start', v: 1, id: jobId, job: item.name, args: item.args });
    if (!start.success) {
      throw new Error('invariant: createJobRunner built an invalid job.start message');
    }
    let child: ChildProcess;
    try {
      child = fork(opts.entry, ['--mode=job', `--job=${item.name}`], {
        execArgv: [...(opts.execArgv ?? process.execArgv), ...(item.opts.extraExecArgv ?? [])],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'json',
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: allowlistedEnv(),
      });
    } catch (e) {
      resolveResult(failure('crashed', `fork failed: ${messageOf(e)}`));
      resolveDone();
      return { handle: { done, requestCancel: () => undefined, kill: () => undefined }, result };
    }

    let outcome: Outcome | null = null;
    let finalized = false;
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let timer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const kill = (): void => {
      const pid = child.pid;
      if (pid === undefined) {
        return;
      }
      try {
        treeKill(pid);
      } catch (e) {
        outcome ??= { type: 'fail', kind: 'crashed', code: null, message: `kill failed: ${messageOf(e)}` };
      }
    };

    const finalize = (): void => {
      if (finalized) {
        return;
      }
      finalized = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      const exitCode = exitInfo?.code ?? null;
      if (outcome === null) {
        const signal = exitInfo?.signal ?? null;
        resolveResult(
          failure(
            'crashed',
            `job process ended without a result (exit code ${String(exitCode)}, signal ${String(signal)})`,
            signal,
            exitCode,
          ),
        );
      } else if (outcome.type === 'ok') {
        resolveResult(ok(outcome.result));
      } else {
        resolveResult(failure(outcome.kind, outcome.message, outcome.code, exitCode));
      }
      resolveDone();
    };

    const protocolViolation = (detail: string): void => {
      outcome ??= { type: 'fail', kind: 'protocol', code: 'protocol', message: detail };
      kill();
    };

    if (child.stdout === null || child.stderr === null) {
      throw new Error('invariant: job child was forked without piped stdout/stderr');
    }
    relayLines(child.stdout, onStdout);
    relayLines(child.stderr, onStderr);

    child.on('message', (raw: unknown) => {
      if (outcome !== null) {
        return;
      }
      const parsed = IpcJob.safeParse(raw);
      if (!parsed.success) {
        protocolViolation('child sent a message that is not a valid IpcJob');
        return;
      }
      const msg = parsed.data;
      if (msg.re !== undefined && msg.re !== jobId) {
        protocolViolation('child message re does not match the job id');
        return;
      }
      switch (msg.type) {
        case 'job.progress':
          item.opts.onProgress?.({ pct: msg.pct, step: msg.step });
          return;
        case 'job.result':
          outcome = { type: 'ok', result: msg.result };
          return;
        case 'job.error':
          outcome =
            msg.code === 'cancelled'
              ? { type: 'fail', kind: 'cancelled', code: msg.code, message: msg.message }
              : { type: 'fail', kind: 'job_error', code: msg.code, message: msg.message };
          return;
        case 'job.start':
        case 'job.cancel':
          protocolViolation(`child sent ${msg.type}, which only the parent may send`);
          return;
      }
    });
    child.on('error', (e: Error) => {
      outcome ??= { type: 'fail', kind: 'crashed', code: null, message: `child error: ${e.message}` };
      if (child.pid === undefined) {
        finalize();
      }
    });
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal };
      // 파이프를 쥔 손자가 남으면 'close'가 오지 않는다 — 유예 뒤 확정한다.
      graceTimer = setTimeout(finalize, CLOSE_GRACE_MS);
      graceTimer.unref();
    });
    child.once('close', (code, signal) => {
      exitInfo ??= { code, signal };
      finalize();
    });

    timer = setTimeout(() => {
      outcome ??= { type: 'fail', kind: 'timeout', code: 'timeout', message: `job exceeded ${item.opts.timeoutMs}ms` };
      kill();
    }, item.opts.timeoutMs);
    timer.unref();

    child.send(start.data, (e: Error | null) => {
      if (e !== null) {
        outcome ??= { type: 'fail', kind: 'crashed', code: null, message: `could not send job.start: ${e.message}` };
        kill();
      }
    });

    const handle: ActiveJob = {
      done,
      requestCancel(): void {
        if (!child.connected) {
          return;
        }
        const cancel = IpcJob.safeParse({ type: 'job.cancel', v: 1, re: jobId });
        if (!cancel.success) {
          return;
        }
        child.send(cancel.data, (e: Error | null) => {
          if (e !== null) {
            kill();
          }
        });
      },
      kill,
    };
    return { handle, result };
  }

  function startNext(): void {
    const next = queue.shift();
    if (next === undefined) {
      active = null;
      return;
    }
    start(next);
  }

  function start(item: QueueItem): void {
    const { handle, result } = execute(item);
    active = handle;
    void result.then((r) => {
      item.resolve(r);
    });
    void handle.done.then(() => {
      startNext();
    });
  }

  return {
    run(name, args, runOpts): Promise<RunResult> {
      return new Promise<RunResult>((resolve) => {
        if (closed) {
          resolve(failure('cancelled', 'job runner is shut down'));
          return;
        }
        const item: QueueItem = { name, args, opts: runOpts, resolve };
        if (active === null) {
          start(item);
        } else if (queue.length >= queueMax) {
          resolve(failure('queue_full', `job queue is full (${queueMax})`));
        } else {
          queue.push(item);
        }
      });
    },
    cancel(): void {
      active?.requestCancel();
    },
    isBusy(): boolean {
      return active !== null;
    },
    async shutdown(): Promise<void> {
      closed = true;
      for (const item of queue.splice(0)) {
        item.resolve(failure('cancelled', 'job runner is shut down'));
      }
      const running = active;
      if (running === null) {
        return;
      }
      running.requestCancel();
      const killTimer = setTimeout(() => {
        running.kill();
      }, SHUTDOWN_GRACE_MS);
      killTimer.unref();
      await running.done;
      clearTimeout(killTimer);
    },
  };
}
