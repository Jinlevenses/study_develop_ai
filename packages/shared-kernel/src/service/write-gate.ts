import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Clock } from '@fathom/shared-kernel/time/time';

// ADR-013 §1-2·6 · §4.7 — quiesce 쓰기 게이트. 닫히면 쓰기 요청이 열릴 때까지(최대 `waitMs`) 대기한다.

export interface WriteGate {
  /** 열림 → 진행 중 카운터 +1, 해제 함수 반환 · 닫힘 → 열릴 때까지 최대 `waitMs` 대기, 넘으면 `timeout`. */
  enter(): Promise<Result<() => void, 'timeout'>>;
  /** 게이트를 닫고 진행 중 쓰기가 0이 될 때까지 `ackDeadlineMs` 기다린다. 성공 = `quiesced_at`(epoch ms). 실패 = 즉시 다시 연다. */
  quiesce(epochId: string, ackDeadlineMs: number): Promise<Result<number, 'drain_timeout'>>;
  resume(epochId: string): void;
  readonly state: 'open' | 'closed';
  readonly epochId: string | null;
}
export type WriteGateOptions = {
  readonly clock: Clock;
  readonly waitMs?: number;
  readonly autoReopenMs?: number;
  readonly onChange: (s: 'open' | 'closed') => void;
  /** [Brief 결정] 가산: 자동 재개가 일어났을 때(ops-api 사망 대비) 호출자가 `warn`을 남긴다. */
  readonly onAutoReopen?: () => void;
};

const DEFAULT_WAIT_MS = 3000;
const DEFAULT_AUTO_REOPEN_MS = 60_000;

export function createWriteGate(opts: WriteGateOptions): WriteGate {
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
  const autoReopenMs = opts.autoReopenMs ?? DEFAULT_AUTO_REOPEN_MS;
  let state: 'open' | 'closed' = 'open';
  let epochId: string | null = null;
  let inFlight = 0;
  let autoTimer: NodeJS.Timeout | null = null;
  const openWaiters = new Set<() => void>();
  const drainWaiters = new Set<() => void>();

  function wake(waiters: Set<() => void>): void {
    for (const w of [...waiters]) {
      waiters.delete(w);
      w();
    }
  }

  function clearAuto(): void {
    if (autoTimer !== null) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }

  function open(): void {
    clearAuto();
    epochId = null;
    if (state === 'closed') {
      state = 'open';
      opts.onChange('open');
    }
    wake(openWaiters);
  }

  function armAuto(): void {
    clearAuto();
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (state === 'closed') {
        open();
        opts.onAutoReopen?.();
      }
    }, autoReopenMs);
    autoTimer.unref();
  }

  function release(): () => void {
    let released = false;
    return (): void => {
      if (released) {
        return;
      }
      released = true;
      inFlight -= 1;
      if (inFlight === 0) {
        wake(drainWaiters);
      }
    };
  }

  /** `ms` 안에 `waiters`가 깨어나면 true. */
  function waitFor(waiters: Set<() => void>, ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        waiters.delete(onWake);
        resolve(false);
      }, ms);
      timer.unref();
      const onWake = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      waiters.add(onWake);
    });
  }

  return {
    get state(): 'open' | 'closed' {
      return state;
    },
    get epochId(): string | null {
      return epochId;
    },
    async enter(): Promise<Result<() => void, 'timeout'>> {
      if (state === 'closed') {
        const reopened = await waitFor(openWaiters, waitMs);
        if (!reopened && state === 'closed') {
          return err('timeout');
        }
      }
      inFlight += 1;
      return ok(release());
    },
    async quiesce(newEpochId: string, ackDeadlineMs: number): Promise<Result<number, 'drain_timeout'>> {
      epochId = newEpochId;
      if (state === 'open') {
        state = 'closed';
        opts.onChange('closed');
      }
      armAuto();
      while (inFlight > 0) {
        if (!(await waitFor(drainWaiters, ackDeadlineMs))) {
          open();
          return err('drain_timeout');
        }
      }
      return ok(opts.clock.now());
    },
    resume(_epochId: string): void {
      open();
    },
  };
}
