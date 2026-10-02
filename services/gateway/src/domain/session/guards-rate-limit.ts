// 고정 창 rate limit(키별) — 300 req/min/세션·CLI 토큰(NFR-SEC-017). `publicAuth` 안에서 검증된 키로 쓴다(IF §2.11 순서 ⑥).

export interface RateLimiter {
  hit(key: string, nowMs: number): { readonly allowed: boolean; readonly retryAfterMs: number };
}

type Window = { windowStart: number; count: number };

export function createRateLimiter(o: {
  readonly max: number;
  readonly windowMs: number;
  readonly maxKeys: number;
}): RateLimiter {
  const windows = new Map<string, Window>();

  /** 메모리 상한: 창이 끝난 키부터, 그래도 넘으면 가장 오래된 창의 키부터 지운다. */
  function evict(nowMs: number): void {
    if (windows.size <= o.maxKeys) {
      return;
    }
    for (const [key, w] of windows) {
      if (nowMs - w.windowStart >= o.windowMs) {
        windows.delete(key);
      }
    }
    while (windows.size > o.maxKeys) {
      let oldestKey: string | null = null;
      let oldestStart = Number.POSITIVE_INFINITY;
      for (const [key, w] of windows) {
        if (w.windowStart < oldestStart) {
          oldestStart = w.windowStart;
          oldestKey = key;
        }
      }
      if (oldestKey === null) {
        return;
      }
      windows.delete(oldestKey);
    }
  }

  return {
    hit(key: string, nowMs: number): { readonly allowed: boolean; readonly retryAfterMs: number } {
      let w = windows.get(key);
      if (w === undefined || nowMs - w.windowStart >= o.windowMs) {
        w = { windowStart: nowMs, count: 0 };
        windows.set(key, w);
        evict(nowMs);
      }
      if (w.count >= o.max) {
        return { allowed: false, retryAfterMs: Math.max(0, w.windowStart + o.windowMs - nowMs) };
      }
      w.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
