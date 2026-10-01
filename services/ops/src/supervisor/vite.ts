import { connect } from 'node:net';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { Timers } from './dev-watch.js';

// ADR-012 §10 · Brief §4.1.12 — Vite는 관리 자식(봉투·IPC 없음). TCP 탐침으로 ready 판정한다.
export const VITE_PROBE_INTERVAL_MS = 200;
export const VITE_PROBE_TIMEOUT_MS = 15_000;

export function realProbeTcp(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export type ViteProbeOptions = {
  readonly port: number;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly probe: (port: number) => Promise<boolean>;
  readonly onReady: () => void;
  readonly onTimeout: () => void;
};

/** 200ms 간격·최대 15s. 취소 함수를 돌려준다. */
export function startViteProbe(o: ViteProbeOptions): () => void {
  const startedAt = o.clock.now();
  let cancelled = false;
  let cancelTimer: (() => void) | null = null;
  const tick = (): void => {
    if (cancelled) {
      return;
    }
    o.probe(o.port).then(
      (ok) => {
        if (cancelled) {
          return;
        }
        if (ok) {
          o.onReady();
        } else if (o.clock.now() - startedAt >= VITE_PROBE_TIMEOUT_MS) {
          o.onTimeout();
        } else {
          cancelTimer = o.timers.after(VITE_PROBE_INTERVAL_MS, tick);
        }
      },
      () => {
        if (!cancelled) {
          cancelTimer = o.timers.after(VITE_PROBE_INTERVAL_MS, tick);
        }
      },
    );
  };
  tick();
  return (): void => {
    cancelled = true;
    cancelTimer?.();
  };
}
