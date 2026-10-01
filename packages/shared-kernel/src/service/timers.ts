import type { Logger } from '@fathom/shared-kernel/log/log';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { purgeInfraOnce } from '../eventing/retention.js';
import { WAL_CHECKPOINT_PASSIVE } from './maintenance.sql.js';

// §4.9 타이머(전부 `.unref()`, 종료 시 해제, quiesce 중 건너뜀) — `_infra` 정리와 WAL 체크포인트. relay 안전망 500ms는 relay 자신이 쥔다.

const PURGE_FIRST_MS = 5 * 60_000;
const PURGE_EVERY_MS = 10 * 60_000;
const CHECKPOINT_EVERY_MS = 5 * 60_000;

export type MaintenanceTimersOptions = {
  readonly clock: Clock;
  readonly log: Logger;
  /** `_infra` 정리 대상(없으면 정리 타이머를 걸지 않는다). */
  readonly fullDb: SqlitePort | null;
  /** WAL 체크포인트 대상(쓰기 DB 전부). */
  readonly writeDbs: readonly SqlitePort[];
  readonly isPaused: () => boolean;
  readonly purgeFirstMs?: number;
  readonly purgeEveryMs?: number;
  readonly checkpointEveryMs?: number;
};

export function startMaintenanceTimers(opts: MaintenanceTimersOptions): { stop(): void } {
  const timers: NodeJS.Timeout[] = [];
  const immediates: NodeJS.Immediate[] = [];
  let stopped = false;

  function purge(): void {
    const db = opts.fullDb;
    if (stopped || db === null || opts.isPaused()) {
      return;
    }
    try {
      const result = purgeInfraOnce(db, opts.clock);
      if (result.more) {
        // 회차를 나눈다 — 이벤트 루프에 양보한 뒤 이어서 정리한다.
        immediates.push(setImmediate(purge));
      }
    } catch (e) {
      opts.log.warn({ event: 'infra.purge.failed', err: e }, 'infra purge failed');
    }
  }

  function checkpoint(): void {
    if (stopped || opts.isPaused()) {
      return;
    }
    for (const db of opts.writeDbs) {
      try {
        db.prepare(WAL_CHECKPOINT_PASSIVE).get(); // PASSIVE = 대기 0 — 유휴 판정 없이 호출한다 [Brief 결정]
      } catch (e) {
        opts.log.warn({ event: 'wal.checkpoint.failed', err: e }, 'wal checkpoint failed');
      }
    }
  }

  if (opts.fullDb !== null) {
    const first = setTimeout(() => {
      purge();
      const every = setInterval(purge, opts.purgeEveryMs ?? PURGE_EVERY_MS);
      every.unref();
      timers.push(every);
    }, opts.purgeFirstMs ?? PURGE_FIRST_MS);
    first.unref();
    timers.push(first);
  }
  if (opts.writeDbs.length > 0) {
    const cp = setInterval(checkpoint, opts.checkpointEveryMs ?? CHECKPOINT_EVERY_MS);
    cp.unref();
    timers.push(cp);
  }

  return {
    stop(): void {
      stopped = true;
      for (const t of timers.splice(0)) {
        clearTimeout(t);
        clearInterval(t);
      }
      for (const i of immediates.splice(0)) {
        clearImmediate(i);
      }
    },
  };
}
