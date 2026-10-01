/** IF-EXT-16 시계 포트 — 서비스·패키지 코드는 `Date.now()` 대신 이것을 주입받는다(STD-TS-20). */
export interface Clock {
  /** epoch ms 정수. */
  now(): number;
}

/** 실 시계. 저장소에서 `Date.now()`를 부르는 유일한 곳이다. */
export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
};

/** FR-PRG-027: 클라이언트 단조 타임스탬프. 시계가 역행해도 직전 값보다 항상 커진다. */
export function monotonicClientTs(now: number, last: number | null): number {
  return last === null ? now : Math.max(now, last + 1);
}
