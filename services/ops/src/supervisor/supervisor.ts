import type { SupervisedService } from '@fathom/contracts/admin/ipc';
import type { LogLevel } from '@fathom/shared-kernel/log/log';
import { createCtx } from './context.js';
import type { Ack, ControlApi } from './control-ipc.js';
import type { ChangeImpact, DevWatchHandle } from './dev-watch.js';
import { createDevWatcher } from './dev-watch.js';
import { createLifecycle, DEFAULT_GRACE_MS } from './lifecycle.js';
import { createMessageHandler } from './messages.js';
import type { StatusRow } from './process-table.js';
import { statusRowOf } from './process-table.js';
import { createRunModeRunner } from './run-mode.js';
import { createCliToken } from './tokens.js';
import type { Supervisor, SupervisorDeps, SupervisorOptions } from './types.js';

const ACK_OK: Ack = { ok: true, error: null };
const START_ORDER = ['ops-api', 'content', 'learning', 'ai-gateway'] as const;

/** ADR-012 §1 — DB·HTTP 서버 없이 6개 상주 프로세스(+ dev Vite)를 fork + IPC로 띄우고 감시·재시작·종료한다. */
export function createSupervisor(opts: SupervisorOptions, deps: SupervisorDeps): Supervisor {
  const ctx = createCtx(opts, deps);
  let controlApi: ControlApi | null = null;
  const api = (): ControlApi => {
    if (controlApi === null) {
      throw new Error('invariant: control api not ready');
    }
    return controlApi;
  };
  const life = createLifecycle(ctx, (row, handle, raw) => onMessage(row, handle, raw));
  const onMessage = createMessageHandler(ctx, life, api);
  const runner = createRunModeRunner({
    spawnChild: deps.spawnChild,
    timers: deps.timers,
    env: life.env,
    onLine: (svc, stream, line) => deps.sink.line(svc, stream, line),
    onError: (svc, what, e) =>
      deps.log.warn({ event: 'supervisor.run_mode.error', child: svc, what, err: e }, 'run_mode child error'),
  });
  // run_mode(migrate·restore·verify) 동안 같은 서비스를 다시 띄우지 않는다 — 라이브 DB는 닫혀 있어야 한다. 진입 즉시(정지 전에) 표시한다.
  const runModeActive = new Set<SupervisedService>();
  let watcher: DevWatchHandle | null = null;
  let started = false;
  let shutdownPromise: Promise<void> | null = null;
  let resolveDone: (code: number) => void = () => undefined;
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  function refusal(svc: SupervisedService): Ack | null {
    if (svc === 'vite' && !ctx.dev) {
      return { ok: false, error: 'not_managed' };
    }
    if (svc === 'ai-gateway' && opts.safeMode) {
      return { ok: false, error: 'safe_mode' };
    }
    if (runModeActive.has(svc)) {
      return { ok: false, error: 'run_mode_busy' };
    }
    return ctx.state.shuttingDown ? { ok: false, error: 'shutting_down' } : null;
  }

  function statusRows(): readonly StatusRow[] {
    const now = deps.clock.now();
    return [
      {
        svc: 'supervisor',
        state: ctx.state.shuttingDown ? 'stopped' : 'ready',
        pid: process.pid,
        port: null,
        restarts_60s: 0,
        started_at: ctx.state.startedAtMs,
        last_exit_code: null,
      },
      ...ctx.allRows().map((row) => statusRowOf(row, now)),
    ];
  }

  async function runShutdown(graceMs: number): Promise<void> {
    ctx.state.shuttingDown = true;
    watcher?.close();
    watcher = null;
    ctx.persist();
    const stopAll = async (list: readonly SupervisedService[]): Promise<void> => {
      await Promise.all(list.filter((s) => ctx.managed.includes(s)).map((s) => life.stopService(s, graceMs)));
    };
    await stopAll(['gateway', 'vite']);
    await stopAll(['content', 'learning', 'ai-gateway']);
    await stopAll(['ops-api']);
    ctx.persist(true);
    await deps.files.flush();
    await deps.files.removeRunFiles();
    await deps.sink.close();
    resolveDone(0);
  }

  function shutdownAll(graceMs: number = DEFAULT_GRACE_MS): Promise<void> {
    shutdownPromise ??= runShutdown(graceMs);
    return shutdownPromise;
  }

  controlApi = {
    stop: async (svc) => {
      if (svc === 'vite' && !ctx.dev) {
        return { ok: false, error: 'not_managed' };
      }
      await life.serialize(svc, () => life.stopService(svc, DEFAULT_GRACE_MS));
      return ACK_OK;
    },
    start: (svc) => {
      const refused = refusal(svc);
      if (refused !== null) {
        return Promise.resolve(refused);
      }
      return life.serialize(svc, () => {
        const row = ctx.rowOf(svc);
        if (row.handle === null && row.state !== 'restarting') {
          row.crashTimes = [];
          life.forkChild(svc);
        }
        return Promise.resolve(ACK_OK);
      });
    },
    restart: (svc) => {
      const refused = refusal(svc);
      if (refused !== null) {
        return Promise.resolve(refused);
      }
      return life.serialize(svc, async () => {
        await life.restartFresh(svc);
        return ACK_OK;
      });
    },
    runMode: async (svc, args) => {
      const owner = !runModeActive.has(svc);
      runModeActive.add(svc);
      try {
        if (owner) {
          await life.serialize(svc, () => life.stopService(svc, DEFAULT_GRACE_MS));
        }
        const spec = life.specFor(svc);
        return await runner.run(svc, args, { entry: spec.entry, execArgv: spec.execArgv, cwd: spec.cwd });
      } finally {
        if (owner) {
          runModeActive.delete(svc);
        }
      }
    },
    status: statusRows,
    tail: (svc, n) => deps.sink.tail(svc, n),
    shutdownAll,
    onDetachedError: (e) => deps.log.error({ event: 'supervisor.control.failed', err: e }, 'control request failed'),
  };

  function onDevImpact(impact: ChangeImpact): void {
    if (impact.supervisorChanged) {
      deps.log.warn({ event: 'supervisor.code.changed' }, 'supervisor code changed — restart pnpm dev');
    }
    for (const svc of impact.services) {
      const row = ctx.rowOf(svc);
      if (runModeActive.has(svc)) {
        continue; // run_mode 중에는 라이브 서비스를 띄우지 않는다.
      }
      if (row.handle !== null || row.state === 'degraded' || row.state === 'restarting') {
        // detached: 파일 변경 감시 콜백은 동기다 — 재시작 실패는 supervisor 로그(error)로 보고한다.
        life.serialize(svc, () => life.restartFresh(svc)).catch((e: unknown) => api().onDetachedError(e));
      }
    }
  }

  async function start(): Promise<void> {
    if (started) {
      throw new Error('invariant: supervisor already started');
    }
    started = true;
    ctx.state.startedAtMs = deps.clock.now();
    await deps.files.writeCliToken(createCliToken(deps.randomBytes));
    ctx.persist();
    for (const svc of START_ORDER) {
      if (svc === 'ai-gateway' && opts.safeMode) {
        const row = ctx.rowOf(svc);
        row.state = 'stopped';
        row.reason = 'safe_mode';
      } else {
        life.forkChild(svc);
      }
    }
    if (ctx.dev) {
      life.forkChild('vite');
      if (deps.watch !== undefined) {
        watcher = createDevWatcher({
          appRoot: opts.bundle.appRoot,
          factory: deps.watch,
          timers: deps.timers,
          onImpact: onDevImpact,
        });
      }
    }
    ctx.persist();
  }

  return {
    start,
    shutdownAll,
    statusRows,
    setLogLevel(level: LogLevel): void {
      ctx.state.logLevel = level;
      deps.log.level = level;
      ctx.broadcast({ type: 'log.level', level });
    },
    done,
  };
}
