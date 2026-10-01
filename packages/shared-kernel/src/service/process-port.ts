import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { AllowedEnvName } from '@fathom/shared-kernel/config/config';
import { readAllowedEnv } from '@fathom/shared-kernel/config/config';

// STD-ERR-20 · STD-TS-15 — `process.*`·`process.exit`는 이 파일 한 곳에서만 만진다.

export interface ProcessPort {
  readonly argv: readonly string[];
  readonly hasIpc: boolean;
  send(msg: unknown): void;
  onMessage(cb: (m: unknown) => void): void;
  onDisconnect(cb: () => void): void;
  onFatal(cb: (kind: 'unhandledRejection' | 'uncaughtException', e: unknown) => void): void;
  env(name: AllowedEnvName): string | undefined;
  exit(code: number): void;
}

/** 경고 억제 필터를 걸 대상(`process`의 `emitWarning`만 본다). */
export type WarningTarget = { emitWarning: (...args: never[]) => void };

export function realProcessPort(): ProcessPort {
  return {
    argv: process.argv.slice(2),
    hasIpc: typeof process.send === 'function',
    send(msg: unknown): void {
      if (process.send === undefined) {
        throw new Error('invariant: process port has no IPC channel');
      }
      process.send(msg);
    },
    onMessage(cb: (m: unknown) => void): void {
      process.on('message', cb);
    },
    onDisconnect(cb: () => void): void {
      process.on('disconnect', cb);
    },
    onFatal(cb: (kind: 'unhandledRejection' | 'uncaughtException', e: unknown) => void): void {
      process.on('unhandledRejection', (reason: unknown) => {
        cb('unhandledRejection', reason);
      });
      process.on('uncaughtException', (e: unknown) => {
        cb('uncaughtException', e);
      });
    },
    env(name: AllowedEnvName): string | undefined {
      return readAllowedEnv(name);
    },
    exit(code: number): void {
      process.exit(code);
    },
  };
}

/** `process`를 경고 필터 대상으로 돌려준다(sqlite-loader가 `node:sqlite` 로드 전에 필터를 건다). */
export function processWarningTarget(): WarningTarget {
  return process;
}

/** `process_resident_memory_bytes` 게이지 값. */
export function readRssBytes(): number {
  return process.memoryUsage.rss();
}

export type EventLoopProbe = { p99Ms(): number; stop(): void };

/** `eventloop_delay_p99_ms` 게이지 값 — 읽은 뒤 히스토그램을 리셋한다. */
export function startEventLoopProbe(): EventLoopProbe {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  return {
    p99Ms(): number {
      const ns = histogram.percentile(99);
      histogram.reset();
      return Number.isFinite(ns) ? ns / 1e6 : 0;
    },
    stop(): void {
      histogram.disable();
    },
  };
}
