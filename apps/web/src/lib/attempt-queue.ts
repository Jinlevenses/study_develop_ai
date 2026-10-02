import type { SubmitAttemptBody } from '@fathom/contracts/http/learning/v1/attempts';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { z } from 'zod';
import type { ApiResult } from './api-client.js';

/** ADR-006 §6 상세 동결 스키마 — 필드 추가 금지. */
export interface AttemptRecord {
  idempotency_key: string;
  session_id: string;
  block_id: string;
  item_id: string;
  payload: z.input<typeof SubmitAttemptBody>;
  answered_at: number;
  created_at: number;
  tries: number;
  state: 'pending' | 'sending' | 'failed_permanent';
  last_error_code: string | null;
}

interface AttemptsDb extends DBSchema {
  attempts: { key: string; value: AttemptRecord };
}

export type SendOutcome =
  | { readonly kind: 'sent'; readonly response: unknown }
  | { readonly kind: 'retrying'; readonly delayMs: number; readonly code: string | null }
  | { readonly kind: 'failed_permanent'; readonly code: string };

export interface QueueCounts {
  readonly pending: number;
  readonly sending: number;
  readonly failed_permanent: number;
  readonly retryInMs: number | null;
}

export interface AttemptQueueDeps {
  readonly send: (rec: AttemptRecord) => Promise<ApiResult<unknown>>;
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (h: unknown) => void;
  readonly onSent?: (key: string, response: unknown) => void;
  readonly onChange?: (counts: QueueCounts) => void;
  /** 테스트 전용(기본 `fathom-attempts`). */
  readonly dbName?: string;
}

export type NewAttempt = Omit<AttemptRecord, 'tries' | 'state' | 'last_error_code' | 'created_at'>;

export interface AttemptQueue {
  submit(rec: NewAttempt): Promise<SendOutcome>;
  flush(): Promise<void>;
  list(): Promise<readonly AttemptRecord[]>;
  retryNow(key: string): Promise<SendOutcome>;
  discard(key: string): Promise<void>;
  counts(): QueueCounts;
  close(): void;
}

export const ATTEMPT_DB_NAME = 'fathom-attempts';
export const ATTEMPT_STORE = 'attempts';
export const RETENTION_MS = 604_800_000; // 서버 멱등 보관 7일
const MAX_SERVER_ERROR_TRIES = 4; // 최초 1 + 재시도 3 (D-05)

export function backoffMs(tries: number): number {
  return Math.min(30_000, 1000 * 2 ** (tries - 1));
}

/** 판정표(Brief §4.3) — 전송 결과 → 레코드 갱신 + 호출 측 결과. `tries`는 이미 증가한 값. */
function judge(tries: number, result: ApiResult<unknown>): SendOutcome {
  if (result.ok) {
    return { kind: 'sent', response: result.data };
  }
  if (result.kind === 'network') {
    return { kind: 'retrying', delayMs: backoffMs(tries), code: null };
  }
  if (result.kind === 'contract') {
    return { kind: 'failed_permanent', code: 'WEB-CONTRACT' };
  }
  const { status, problem } = result;
  if (status === 429) {
    return { kind: 'retrying', delayMs: problem.retry_after_ms ?? 1000, code: problem.code };
  }
  if (status === 503) {
    return { kind: 'retrying', delayMs: backoffMs(tries), code: problem.code };
  }
  if (status >= 500) {
    return tries < MAX_SERVER_ERROR_TRIES
      ? { kind: 'retrying', delayMs: backoffMs(tries), code: problem.code }
      : { kind: 'failed_permanent', code: problem.code };
  }
  if (problem.retryable) {
    return { kind: 'retrying', delayMs: backoffMs(tries), code: problem.code };
  }
  return { kind: 'failed_permanent', code: problem.code };
}

function byCreatedAt(a: AttemptRecord, b: AttemptRecord): number {
  if (a.created_at !== b.created_at) {
    return a.created_at - b.created_at;
  }
  return a.idempotency_key < b.idempotency_key ? -1 : a.idempotency_key > b.idempotency_key ? 1 : 0;
}

/**
 * 읽기 전용 개수 — 전송 없이 IndexedDB의 미전송 레코드만 센다(BootGate 이전·AppOffShell용).
 * 큐를 열면 즉시 flush하므로 세션 부트스트랩(교환·status·csrf) 전에는 이 함수만 쓴다(Brief §4.6-5).
 * 7일 초과 레코드는 세지 않는다(큐를 열 때 삭제되는 것과 같은 기준).
 */
export async function readAttemptCounts(opts: {
  readonly now: () => number;
  readonly dbName?: string;
}): Promise<QueueCounts> {
  const db = await openDB<AttemptsDb>(opts.dbName ?? ATTEMPT_DB_NAME, 1, {
    upgrade(upgradeDb) {
      upgradeDb.createObjectStore(ATTEMPT_STORE, { keyPath: 'idempotency_key' });
    },
  });
  try {
    const cutoff = opts.now() - RETENTION_MS;
    let pending = 0;
    let failed = 0;
    for (const rec of await db.getAll(ATTEMPT_STORE)) {
      if (rec.created_at < cutoff) {
        continue;
      }
      if (rec.state === 'failed_permanent') {
        failed += 1;
      } else {
        pending += 1; // 잔존 sending도 열면 pending으로 되돌아간다
      }
    }
    return { pending, sending: 0, failed_permanent: failed, retryInMs: null };
  } finally {
    db.close();
  }
}

export async function openAttemptQueue(deps: AttemptQueueDeps): Promise<AttemptQueue> {
  const db: IDBPDatabase<AttemptsDb> = await openDB<AttemptsDb>(deps.dbName ?? ATTEMPT_DB_NAME, 1, {
    upgrade(upgradeDb) {
      upgradeDb.createObjectStore(ATTEMPT_STORE, { keyPath: 'idempotency_key' });
    },
  });
  const cache = new Map<string, AttemptRecord>();
  const inflight = new Map<string, Promise<SendOutcome>>();
  let flushing: Promise<void> | null = null;
  let timer: unknown = null;
  let retryAt: number | null = null;
  let closed = false;

  function counts(): QueueCounts {
    let pending = 0;
    let sending = 0;
    let failed = 0;
    for (const r of cache.values()) {
      if (r.state === 'pending') {
        pending += 1;
      } else if (r.state === 'sending') {
        sending += 1;
      } else {
        failed += 1;
      }
    }
    return {
      pending,
      sending,
      failed_permanent: failed,
      retryInMs: retryAt === null ? null : Math.max(0, retryAt - deps.now()),
    };
  }

  function changed(): void {
    deps.onChange?.(counts());
  }

  async function putRecord(rec: AttemptRecord): Promise<void> {
    await db.put(ATTEMPT_STORE, rec);
    cache.set(rec.idempotency_key, rec);
    changed();
  }

  async function removeRecord(key: string): Promise<void> {
    await db.delete(ATTEMPT_STORE, key);
    cache.delete(key);
    changed();
  }

  function scheduleFlush(delayMs: number): void {
    if (closed) {
      return;
    }
    if (timer !== null) {
      deps.clearTimer(timer);
    }
    retryAt = deps.now() + delayMs;
    timer = deps.setTimer(() => {
      timer = null;
      retryAt = null;
      void flush().catch(() => undefined); // 실패는 다음 트리거(online·SSE·수동)가 다시 시도한다.
    }, delayMs);
    changed();
  }

  async function sendRecord(base: AttemptRecord): Promise<SendOutcome> {
    const sending: AttemptRecord = { ...base, tries: base.tries + 1, state: 'sending' };
    await putRecord(sending);
    let result: ApiResult<unknown>;
    try {
      result = await deps.send(sending);
    } catch (e) {
      // send가 reject해도 레코드가 sending에 멈추지 않게 network 결과로 취급한다(백오프 후 재시도).
      result = { ok: false, kind: 'network', message: e instanceof Error ? e.message : String(e) };
    }
    const outcome = judge(sending.tries, result);
    if (outcome.kind === 'sent') {
      await removeRecord(sending.idempotency_key);
      deps.onSent?.(sending.idempotency_key, outcome.response);
    } else if (outcome.kind === 'retrying') {
      await putRecord({ ...sending, state: 'pending', last_error_code: outcome.code });
    } else {
      await putRecord({ ...sending, state: 'failed_permanent', last_error_code: outcome.code });
    }
    return outcome;
  }

  function sendOnce(base: AttemptRecord): Promise<SendOutcome> {
    const existing = inflight.get(base.idempotency_key);
    if (existing !== undefined) {
      return existing;
    }
    const p = sendRecord(base).finally(() => {
      inflight.delete(base.idempotency_key);
    });
    inflight.set(base.idempotency_key, p);
    return p;
  }

  async function runFlush(): Promise<void> {
    const all = await db.getAll(ATTEMPT_STORE);
    const todo = all.filter((r) => r.state !== 'failed_permanent').sort(byCreatedAt);
    for (const rec of todo) {
      const current = cache.get(rec.idempotency_key);
      if (current === undefined) {
        continue; // 같은 사이클 안에서 이미 삭제됨
      }
      if (current.state === 'failed_permanent') {
        continue; // 스냅샷 이후 동시 submit·retryNow가 영구 실패로 돌린 레코드는 다시 보내지 않는다
      }
      const outcome = await sendOnce(current.state === 'sending' ? { ...current, state: 'pending' } : current);
      if (outcome.kind === 'retrying') {
        scheduleFlush(outcome.delayMs);
        return;
      }
    }
  }

  function flush(): Promise<void> {
    if (flushing !== null) {
      return flushing;
    }
    const p = runFlush().finally(() => {
      flushing = null;
    });
    flushing = p;
    return p;
  }

  // 열 때 정리: 7일 초과 삭제 · 잔존 sending → pending
  const cutoff = deps.now() - RETENTION_MS;
  for (const rec of await db.getAll(ATTEMPT_STORE)) {
    if (rec.created_at < cutoff) {
      await db.delete(ATTEMPT_STORE, rec.idempotency_key);
    } else if (rec.state === 'sending') {
      const fixed: AttemptRecord = { ...rec, state: 'pending' };
      await db.put(ATTEMPT_STORE, fixed);
      cache.set(fixed.idempotency_key, fixed);
    } else {
      cache.set(rec.idempotency_key, rec);
    }
  }

  const onOnline = (): void => {
    void flush().catch(() => undefined); // 실패는 다음 트리거가 다시 시도한다.
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
  }
  changed();
  void flush().catch(() => undefined); // 열자마자 1회 — 실패는 다음 트리거가 다시 시도한다.

  function afterOutcome(outcome: SendOutcome): SendOutcome {
    if (outcome.kind === 'retrying') {
      scheduleFlush(outcome.delayMs);
    }
    return outcome;
  }

  return {
    async submit(rec: NewAttempt): Promise<SendOutcome> {
      if (rec.payload.attempt_id !== rec.idempotency_key) {
        throw new TypeError('본문 attempt_id는 idempotency_key와 같아야 합니다(IF-01 §2.7-3)');
      }
      const record: AttemptRecord = {
        ...rec,
        created_at: deps.now(),
        tries: 0,
        state: 'pending',
        last_error_code: null,
      };
      await putRecord(record); // 저장이 끝난 뒤에만 전송한다(UT-WEB-001)
      return afterOutcome(await sendOnce(record));
    },
    flush,
    async list(): Promise<readonly AttemptRecord[]> {
      return (await db.getAll(ATTEMPT_STORE)).sort(byCreatedAt);
    },
    async retryNow(key: string): Promise<SendOutcome> {
      const rec = cache.get(key);
      if (rec === undefined) {
        return { kind: 'failed_permanent', code: 'WEB-NOT-FOUND' };
      }
      return afterOutcome(await sendOnce({ ...rec, state: 'pending' }));
    },
    discard: removeRecord,
    counts,
    close(): void {
      closed = true;
      if (timer !== null) {
        deps.clearTimer(timer);
        timer = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
      }
      db.close();
    },
  };
}
