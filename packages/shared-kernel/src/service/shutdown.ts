import type { JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Relay } from '../eventing/relay.js';
import { OPTIMIZE } from './maintenance.sql.js';
import type { ServiceState } from './service-state.js';

// §4.8 종료 절차(STD-ASY-12, ADR-012 §8). 두 번째 호출은 첫 호출의 Promise를 돌려준다. 기한 초과는 `warn` 후 다음 단계 — 종료 코드는 0을 유지한다.

export type ShutdownParts = {
  readonly state: ServiceState;
  readonly relay: (() => Pick<Relay, 'drainOnce' | 'stop'> | null) | null;
  readonly stopTimers: () => void;
  readonly hooks: readonly (() => void | Promise<void>)[];
  readonly jobs: JobRunner;
  readonly writeDbs: readonly SqlitePort[];
  readonly closeApp: () => Promise<void>;
  readonly exit: (code: number) => void;
  readonly log: Logger;
};

/** `p`가 `ms` 안에 끝나면 true. 기한을 넘겨도 `p`는 취소하지 않는다(다음 단계로 넘어갈 뿐). */
function finishesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(
      () => {
        resolve(false);
      },
      Math.max(0, ms),
    );
    timer.unref();
    void p.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

export function createShutdown(parts: ShutdownParts): (graceMs: number) => Promise<void> {
  let running: Promise<void> | null = null;

  async function run(graceMs: number): Promise<void> {
    const { log, state } = parts;
    const deadline = performance.now() + graceMs;
    const remaining = (): number => Math.max(0, deadline - performance.now());
    state.shuttingDown = true; // 1. 이후 새 요청은 503 DEP-900
    if (!(await state.waitIdle(graceMs))) {
      log.warn(
        { event: 'shutdown.requests.timeout', in_flight: state.inFlight },
        'in-flight requests did not finish within grace',
      );
    }
    const relay = parts.relay?.() ?? null; // 3. relay drain 1회 → stop
    if (relay !== null) {
      if (!(await finishesWithin(relay.drainOnce(), remaining()))) {
        log.warn({ event: 'shutdown.relay.drain_timeout' }, 'relay drain exceeded grace');
      }
      if (!(await finishesWithin(relay.stop(), remaining()))) {
        log.warn({ event: 'shutdown.relay.stop_timeout' }, 'relay stop exceeded grace');
      }
    }
    parts.stopTimers();
    for (const hook of [...parts.hooks].reverse()) {
      // 4. onShutdown 훅: 등록 역순, 예외는 로그 후 계속
      try {
        await hook();
      } catch (e) {
        log.error({ event: 'shutdown.hook.failed', err: e }, 'shutdown hook failed');
      }
    }
    try {
      await parts.jobs.shutdown(); // 5.
    } catch (e) {
      log.error({ event: 'shutdown.jobs.failed', err: e }, 'job runner shutdown failed');
    }
    for (const db of parts.writeDbs) {
      // 6. 쓰기 DB마다 optimize → close
      try {
        db.exec(OPTIMIZE);
      } catch (e) {
        log.warn({ event: 'shutdown.optimize.failed', err: e }, 'optimize failed');
      }
      try {
        db.close();
      } catch (e) {
        log.error({ event: 'shutdown.db_close.failed', err: e }, 'database close failed');
      }
    }
    try {
      await parts.closeApp(); // 7.
    } catch (e) {
      log.error({ event: 'shutdown.app_close.failed', err: e }, 'app close failed');
    }
    parts.exit(0); // 8.
  }

  return (graceMs: number): Promise<void> => {
    running ??= run(graceMs);
    return running;
  };
}
