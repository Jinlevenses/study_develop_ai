import type { SupervisedService } from '@fathom/contracts/admin/ipc';
import { buildEnvelope } from './bootstrap.js';
import type { ChildEntry } from './bundle.js';
import { resolveEntries } from './bundle.js';
import type { ChildHandle, ChildSpec } from './child.js';
import { childEnv } from './child-env.js';
import type { Ctx } from './context.js';
import { VITE_PORT } from './ports.js';
import type { Row } from './process-table.js';
import { decideOnExit } from './restart-policy.js';
import { realProbeTcp, startViteProbe } from './vite.js';

// ADR-012 §6~§8 · Brief §4.1.4·§4.1.5·§4.1.10 — 자식 fork · 종료 처리(재시작 정책 적용) · 정지.
export const READY_TIMEOUT_MS = 30_000; // ADR-012 §6 콜드 ≤ 10s의 3배 여유(Brief 결정)
export const DEFAULT_GRACE_MS = 3000;
export const STOP_SLACK_MS = 2000;

export interface Lifecycle {
  specFor(svc: SupervisedService): ChildSpec;
  forkChild(svc: SupervisedService): void;
  stopService(svc: SupervisedService, graceMs: number): Promise<void>;
  restartFresh(svc: SupervisedService): Promise<void>;
  serialize<T>(svc: SupervisedService, fn: () => Promise<T>): Promise<T>;
  failChild(row: Row, handle: ChildHandle, why: string): void;
  markReady(row: Row): void;
  readonly env: Readonly<Record<string, string>>;
}

export function createLifecycle(ctx: Ctx, onMessage: (row: Row, handle: ChildHandle, raw: unknown) => void): Lifecycle {
  const { deps, opts } = ctx;
  const defaults = resolveEntries(opts.bundle.appRoot, opts.bundle.runtime, opts.profile);
  const env = childEnv(opts.home, { env: deps.env, platform: deps.platform });
  const probe = deps.probeTcp ?? realProbeTcp;

  function specFor(svc: SupervisedService): ChildSpec {
    const base = defaults[svc];
    if (base === undefined) {
      throw new Error(`invariant: no entry for ${svc}`);
    }
    const override: ChildEntry | undefined = opts.entries[svc];
    const args = override?.args ?? base.args;
    return {
      svc,
      kind: svc === 'vite' ? 'spawn' : 'fork',
      entry: override?.entry ?? base.entry,
      args: svc === 'vite' ? args : ['--mode=serve', ...args],
      execArgv: override?.execArgv ?? base.execArgv,
      env,
      cwd: base.cwd,
    };
  }

  function maybeForkGateway(): void {
    const gw = ctx.rowOf('gateway');
    if (ctx.state.shuttingDown || gw.handle !== null || gw.state !== 'stopped' || gw.reason !== 'waiting_deps') {
      return;
    }
    if (ctx.rowOf('content').state === 'ready' && ctx.rowOf('learning').state === 'ready') {
      forkChild('gateway');
    }
  }

  function markReady(row: Row): void {
    if (row.handle === null) {
      return;
    }
    row.state = 'ready';
    ctx.persist();
    if (row.svc === 'content' || row.svc === 'learning') {
      maybeForkGateway();
    }
  }

  /** 응답 없는 자식 — 죽이고 크래시로 처리한다(이후 실제 exit 이벤트는 무시된다). */
  function failChild(row: Row, handle: ChildHandle, why: string): void {
    deps.log.warn({ event: 'supervisor.child.failed', child: row.svc, why }, 'child failed');
    handle.treeKill();
    row.exitOnce?.(null, 'SIGKILL');
  }

  function applyExit(row: Row, code: number | null, signal: string | null): void {
    for (const cancel of row.cancelTimers.splice(0)) {
      cancel();
    }
    row.pid = null;
    row.port = null;
    row.readyInfo = null;
    row.lastExitCode = code;
    let outcome: { kind: 'restart'; delayMs: number } | { kind: 'degraded' | 'stopped'; reason: string };
    if (row.handshakeRejected) {
      outcome = { kind: 'degraded', reason: 'contracts_hash_mismatch' };
    } else {
      const r = decideOnExit({
        code,
        signal,
        requested: row.requestedStop,
        fatalCode: row.fatalCode,
        crashTimes: row.crashTimes,
        now: deps.clock.now(),
      });
      row.crashTimes = r.crashTimes;
      outcome = r.decision;
    }
    row.fatalCode = null;
    if (outcome.kind === 'restart') {
      row.state = 'restarting';
      row.reason = null;
      row.restarts += 1;
      row.afterCrash = true;
      row.cancelTimers.push(
        deps.timers.after(outcome.delayMs, () => {
          if (row.state === 'restarting') {
            forkChild(row.svc);
          }
        }),
      );
    } else {
      row.state = outcome.kind;
      row.reason = outcome.reason;
    }
    deps.log.info(
      { event: 'supervisor.child.exit', child: row.svc, code, signal, outcome: outcome.kind },
      'child exited',
    );
    for (const waiter of row.exitWaiters.splice(0)) {
      waiter();
    }
    ctx.persist();
  }

  function onChildExit(row: Row, handle: ChildHandle, code: number | null, signal: string | null): void {
    if (row.handle !== handle) {
      return;
    }
    row.handle = null;
    row.exitOnce = null;
    applyExit(row, code, signal);
  }

  function resetForFork(row: Row): boolean {
    const afterCrash = row.afterCrash || (!row.everForked && opts.previousCrashed);
    row.everForked = true;
    row.afterCrash = false;
    row.requestedStop = false;
    row.handshakeRejected = false;
    row.fatalCode = null;
    row.readyInfo = null;
    row.port = null;
    row.reason = null;
    row.state = 'starting';
    return afterCrash;
  }

  function watchReadiness(row: Row, handle: ChildHandle, afterCrash: boolean): void {
    if (row.svc === 'vite') {
      row.cancelTimers.push(
        startViteProbe({
          port: VITE_PORT,
          clock: deps.clock,
          timers: deps.timers,
          probe,
          onReady: () => markReady(row),
          onTimeout: () => failChild(row, handle, 'vite_probe_timeout'),
        }),
      );
      return;
    }
    row.cancelTimers.push(
      deps.timers.after(READY_TIMEOUT_MS, () => {
        if (row.handle === handle && row.state === 'starting') {
          failChild(row, handle, 'ready_timeout');
        }
      }),
    );
    const sent = handle.send(
      buildEnvelope(row.svc, {
        profile: opts.profile,
        home: opts.home,
        appRoot: opts.bundle.appRoot,
        appVersion: opts.bundle.appVersion,
        contractsHash: opts.bundle.contractsHash,
        tokens: ctx.tokens,
        lastPort: row.lastPort,
        knownPorts: ctx.knownPorts(),
        safeMode: opts.safeMode,
        afterCrash,
        logLevel: ctx.state.logLevel,
      }),
    );
    if (!sent) {
      failChild(row, handle, 'bootstrap_send_failed');
    }
  }

  function forkChild(svc: SupervisedService): void {
    if (ctx.state.shuttingDown) {
      return;
    }
    const row = ctx.rowOf(svc);
    const afterCrash = resetForFork(row);
    let handle: ChildHandle;
    try {
      handle = deps.spawnChild(specFor(svc));
    } catch (e) {
      deps.log.error({ event: 'supervisor.child.spawn_failed', child: svc, err: e }, 'child spawn failed');
      row.handle = null;
      applyExit(row, null, 'spawn_error');
      return;
    }
    row.handle = handle;
    row.pid = handle.pid;
    row.startedAt = deps.clock.now();
    let exited = false;
    row.exitOnce = (code, signal): void => {
      if (!exited) {
        exited = true;
        onChildExit(row, handle, code, signal);
      }
    };
    handle.onMessage((m) => onMessage(row, handle, m));
    handle.onExit((code, signal) => row.exitOnce?.(code, signal));
    handle.onLine((stream, line) => deps.sink.line(svc, stream, line));
    handle.onError((what, e) =>
      deps.log.warn({ event: 'supervisor.child.error', child: svc, what, err: e }, 'child error'),
    );
    deps.log.info({ event: 'supervisor.child.forked', child: svc, child_pid: handle.pid }, 'child forked');
    watchReadiness(row, handle, afterCrash);
    ctx.persist();
  }

  function waitExit(row: Row, ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let cancel: () => void = () => undefined;
      const waiter = (): void => {
        cancel();
        resolve(true);
      };
      row.exitWaiters.push(waiter);
      cancel = deps.timers.after(ms, () => {
        row.exitWaiters = row.exitWaiters.filter((w) => w !== waiter);
        resolve(false);
      });
    });
  }

  async function stopService(svc: SupervisedService, graceMs: number): Promise<void> {
    const row = ctx.rowOf(svc);
    const handle = row.handle;
    if (handle === null) {
      for (const cancel of row.cancelTimers.splice(0)) {
        cancel();
      }
      if (row.state === 'restarting') {
        row.state = 'stopped';
        row.reason = 'requested';
        ctx.persist();
      }
      return;
    }
    row.requestedStop = true;
    const exited = waitExit(row, graceMs + STOP_SLACK_MS);
    if (svc === 'vite' || !ctx.sendTo(row, { type: 'shutdown', grace_ms: graceMs })) {
      handle.treeKill();
    }
    if (!(await exited)) {
      handle.treeKill();
      row.exitOnce?.(null, 'SIGKILL');
    }
  }

  return {
    specFor,
    forkChild,
    stopService,
    async restartFresh(svc): Promise<void> {
      await stopService(svc, DEFAULT_GRACE_MS);
      ctx.rowOf(svc).crashTimes = [];
      forkChild(svc);
    },
    serialize<T>(svc: SupervisedService, fn: () => Promise<T>): Promise<T> {
      const row = ctx.rowOf(svc);
      const run = row.chain.then(fn, fn);
      row.chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    failChild,
    markReady,
    env,
  };
}
