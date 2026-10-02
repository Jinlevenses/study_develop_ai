import type { Problem } from '@fathom/contracts/common/problem';

export const ULID_A = '01J0000000000000000000000A';
export const ULID_B = '01J0000000000000000000000B';
export const ULID_C = '01J0000000000000000000000C';
export const TOKEN_43 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'; // 43자 base64url
export const CSRF_43 = 'ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkj'; // 43자 base64url
export const SHA = 'a'.repeat(64);

export function problemBody(status: number, code: string, extra: Partial<Problem> = {}): Problem {
  return {
    type: `urn:fathom:problem:${code.toLowerCase()}`,
    title: '문제가 발생했습니다',
    status,
    code,
    error_id: ULID_A,
    request_id: ULID_B,
    retryable: false,
    ...extra,
  } as Problem;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function problemResponse(status: number, code: string, extra: Partial<Problem> = {}): Response {
  return new Response(JSON.stringify(problemBody(status, code, extra)), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
  readonly headers: Record<string, string>;
}

/** 실네트워크 0 — 응답 큐(함수 또는 Response)를 차례로 돌려주는 가짜 fetch. */
export function fakeFetch(...responses: (Response | (() => Response) | Error)[]): {
  readonly fetch: typeof fetch;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(input), init: init ?? {}, headers });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next === undefined) {
      return Promise.reject(new Error('no fake response'));
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(typeof next === 'function' ? next() : next);
  };
  return { fetch: fn as typeof fetch, calls };
}

export interface ManualTimers {
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (h: unknown) => void;
  readonly pending: () => readonly { readonly ms: number }[];
  /** 가장 먼저 등록된 타이머 1개를 실행하고 그 지연(ms)을 돌려준다. */
  readonly fire: () => number | null;
}

export function manualTimers(): ManualTimers {
  let seq = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn, ms) => {
      seq += 1;
      timers.set(seq, { fn, ms });
      return seq;
    },
    clearTimer: (h) => {
      if (typeof h === 'number') {
        timers.delete(h);
      }
    },
    pending: () => [...timers.values()].map((t) => ({ ms: t.ms })),
    fire: () => {
      const first = [...timers.entries()][0];
      if (first === undefined) {
        return null;
      }
      timers.delete(first[0]);
      first[1].fn();
      return first[1].ms;
    },
  };
}

export function attemptPayload(attemptId: string) {
  return {
    attempt_id: attemptId,
    block_id: ULID_B,
    item_id: 'docker.dockerfile.i05',
    item_content_hash: SHA,
    response: { kind: 'ox' as const, value: true },
    confidence: null,
    presented_at: 1_790_000_000_000,
    answered_at: 1_790_000_001_000,
    hints_used: 0,
    timer_extended: false,
  };
}

export function newAttempt(attemptId: string, sessionId: string = ULID_A) {
  return {
    idempotency_key: attemptId,
    session_id: sessionId,
    block_id: ULID_B,
    item_id: 'docker.dockerfile.i05',
    payload: attemptPayload(attemptId),
    answered_at: 1_790_000_001_000,
  };
}

/** HomeView 최소 유효 값(ai_chip만 바꿔 쓴다). */
export function homeView(aiChip: { mode: 'FULL' | 'JUDGE_ONLY' | 'LLM_ONLY' | 'OFFLINE'; degraded: boolean }) {
  const labels = {
    FULL: 'AI: 전체',
    JUDGE_ONLY: 'AI: 판단만',
    LLM_ONLY: 'AI: 생성만',
    OFFLINE: 'AI: 오프라인',
  } as const;
  return {
    primary_action: {
      kind: 'start_session',
      label_ko: '세션 시작',
      suggested: { minutes: 15, energy: 'normal' },
      session_id: null,
    },
    alerts: [],
    energy_default: 'normal',
    minutes_default: 15,
    today: { due_cards: 0, new_budget: 0, est_minutes: 0 },
    weekly_goal: { target_sessions: 3, done_sessions: 0, streak_weeks: 0, rest_tokens: 0 },
    ai_chip: { mode: aiChip.mode, label_ko: labels[aiChip.mode], degraded_badge: aiChip.degraded },
    banners: [],
    degraded: [],
  };
}
