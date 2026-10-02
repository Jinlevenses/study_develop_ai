// 부트스트랩 토큰 저장소 — 1회용·60s TTL·동시 16개(ADR-009 §1). 저장 키 = hash(token), 원문은 보관하지 않는다.

export interface BootstrapTokenStore {
  /** 토큰을 등록하고 `expires_at`(epoch ms)을 돌려준다. */
  issue(token: string, nowMs: number): number;
  /** 있음 ∧ `nowMs < expires_at` → 삭제 후 true. 그 외 false(만료 항목도 삭제). */
  consume(token: string, nowMs: number): boolean;
}

export function createBootstrapTokenStore(o: {
  readonly ttlMs: number;
  readonly maxOutstanding: number;
  readonly hash: (t: string) => string;
}): BootstrapTokenStore {
  const entries = new Map<string, number>(); // hash(token) → expires_at

  function purgeExpired(nowMs: number): void {
    for (const [key, expiresAt] of entries) {
      if (nowMs >= expiresAt) {
        entries.delete(key);
      }
    }
  }

  function dropEarliest(): void {
    let earliestKey: string | null = null;
    let earliest = Number.POSITIVE_INFINITY;
    for (const [key, expiresAt] of entries) {
      if (expiresAt < earliest) {
        earliest = expiresAt;
        earliestKey = key;
      }
    }
    if (earliestKey !== null) {
      entries.delete(earliestKey);
    }
  }

  return {
    issue(token: string, nowMs: number): number {
      purgeExpired(nowMs);
      const expiresAt = nowMs + o.ttlMs;
      entries.set(o.hash(token), expiresAt);
      while (entries.size > o.maxOutstanding) {
        dropEarliest();
      }
      return expiresAt;
    },
    consume(token: string, nowMs: number): boolean {
      const key = o.hash(token);
      const expiresAt = entries.get(key);
      if (expiresAt === undefined) {
        return false;
      }
      entries.delete(key);
      return nowMs < expiresAt;
    },
  };
}
