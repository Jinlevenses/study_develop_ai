import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Stack, StackDeps, StackService } from './spawn-stack.js';

// TST-01 §3.2 chaos 행·§12.3 lock-gate — 서비스 kill·정지(SIGSTOP)·DB 관측·쓰기 잠금 보유(PGM-TK-006).

type Params = readonly (string | number | null)[];
type Row = Record<string, unknown>;

function errnoOf(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}
function defaultSignal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch (e) {
    if (errnoOf(e) !== 'ESRCH') {
      throw e;
    }
  }
}

/** registry의 서비스 pid에 신호를 보낸다(기본 SIGKILL). 재시작 대기는 호출자가 `stack.waitForState(svc, 'ready', { notPid })`. */
export async function killService(
  stack: Pick<Stack, 'pidOf'>,
  svc: StackService,
  o?: { signal?: NodeJS.Signals },
  deps?: Pick<StackDeps, 'signal'>,
): Promise<{ readonly pid: number }> {
  const pid = await stack.pidOf(svc);
  (deps?.signal ?? defaultSignal)(pid, o?.signal ?? 'SIGKILL');
  return { pid };
}

/** SIGSTOP으로 서비스를 멈춰 지연(행)을 주입한다. `resume()`(SIGCONT)은 멱등. */
export async function pauseService(
  stack: Pick<Stack, 'pidOf'>,
  svc: StackService,
  deps?: Pick<StackDeps, 'signal'> & { platform?: NodeJS.Platform },
): Promise<{ resume(): void }> {
  if ((deps?.platform ?? process.platform) === 'win32') {
    throw new Error('chaos: unsupported_platform');
  }
  const signal = deps?.signal ?? defaultSignal;
  const pid = await stack.pidOf(svc);
  signal(pid, 'SIGSTOP');
  let resumed = false;
  return {
    resume(): void {
      if (resumed) {
        return;
      }
      resumed = true;
      signal(pid, 'SIGCONT');
    },
  };
}

function assertSelectOnly(sql: string): void {
  if (!/^(SELECT|WITH)\s/.test(sql.trim().toUpperCase())) {
    throw new Error('invariant: chaos read is SELECT only');
  }
}

async function openReadOnly(dbPath: string): Promise<SqlitePort> {
  const sk = await import('@fathom/shared-kernel/sqlite/sqlite');
  return sk.openDb(dbPath, { readOnly: true, synchronous: 'NORMAL' });
}

/** 읽기 전용 연결로 SELECT/WITH만 실행한다(매 호출 open → all → close). */
export async function readRows(dbPath: string, sql: string, params: Params = []): Promise<Row[]> {
  assertSelectOnly(sql);
  const db = await openReadOnly(dbPath);
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 조건(기본 rows.length > 0)이 될 때까지 폴링한다. 시간 초과 = `chaos: wait_timeout`(cause = 마지막 rows). */
export async function waitForRow(
  dbPath: string,
  sql: string,
  params: Params,
  o?: { timeoutMs?: number; intervalMs?: number; predicate?: (rows: readonly Row[]) => boolean },
): Promise<Row[]> {
  const timeoutMs = o?.timeoutMs ?? 10_000;
  const intervalMs = Math.min(o?.intervalMs ?? 25, 50);
  const predicate = o?.predicate ?? ((rows: readonly Row[]): boolean => rows.length > 0);
  const t0 = performance.now();
  let rows: Row[] = [];
  for (;;) {
    rows = await readRows(dbPath, sql, params);
    if (predicate(rows)) {
      return rows;
    }
    if (performance.now() - t0 >= timeoutMs) {
      throw new Error(`chaos: wait_timeout: no matching rows within ${String(timeoutMs)}ms`, { cause: rows });
    }
    await delay(intervalMs);
  }
}

const LOCK_GATE_BEGIN = 'BEGIN IMMEDIATE';
const LOCK_GATE_ROLLBACK = 'ROLLBACK';

/** 쓰기 잠금(`BEGIN IMMEDIATE`)을 쥔다. 데이터는 바꾸지 않는다(D-TST-11). 서비스 DB 쓰기 연결은 이 함수뿐인 테스트 장치. */
export async function lockGate(dbPath: string): Promise<{ readonly held: boolean; release(): void }> {
  const sk = await import('@fathom/shared-kernel/sqlite/sqlite');
  const db = sk.openDb(dbPath, { synchronous: 'NORMAL' });
  try {
    db.exec(LOCK_GATE_BEGIN);
  } catch (e) {
    db.close();
    throw e;
  }
  let released = false;
  return {
    held: true,
    release(): void {
      if (released) {
        return;
      }
      released = true;
      try {
        db.exec(LOCK_GATE_ROLLBACK);
      } finally {
        db.close();
      }
    },
  };
}
