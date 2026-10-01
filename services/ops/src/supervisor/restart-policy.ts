// ADR-012 §7 · ARC-01 §14.2 표 — 순수 결정 함수(시계·IO 없음).
export type ExitInput = {
  readonly code: number | null;
  readonly signal: string | null;
  readonly requested: boolean;
  readonly fatalCode: string | null;
  readonly crashTimes: readonly number[];
  readonly now: number;
};
export type ExitDecision =
  | { readonly kind: 'restart'; readonly delayMs: number }
  | { readonly kind: 'degraded'; readonly reason: string }
  | { readonly kind: 'stopped'; readonly reason: string };

export const RESTART_DELAYS_MS = [250, 1000, 2000] as const; // ADR-012 §7
export const CRASH_WINDOW_MS = 60_000; // NFR-AVL-003
export const MAX_CRASHES_IN_WINDOW = 3;

const EXIT_OK = 0;
const EXIT_TRANSIENT = 75;
const EXIT_CONFIG = 78;

export function decideOnExit(i: ExitInput): {
  readonly decision: ExitDecision;
  readonly crashTimes: readonly number[];
} {
  if (i.requested) {
    return { decision: { kind: 'stopped', reason: 'requested' }, crashTimes: i.crashTimes };
  }
  if (i.code === EXIT_OK) {
    return { decision: { kind: 'stopped', reason: 'exit_0' }, crashTimes: i.crashTimes };
  }
  if (i.code === EXIT_CONFIG) {
    return {
      decision: { kind: 'degraded', reason: `exit_78:${i.fatalCode ?? 'unknown'}` },
      crashTimes: i.crashTimes,
    };
  }
  const window = [...i.crashTimes.filter((t) => i.now - t < CRASH_WINDOW_MS), i.now];
  if (window.length > MAX_CRASHES_IN_WINDOW) {
    return { decision: { kind: 'degraded', reason: 'crash_loop' }, crashTimes: window };
  }
  const delayMs = i.code === EXIT_TRANSIENT ? 0 : (RESTART_DELAYS_MS[window.length - 1] ?? 2000);
  return { decision: { kind: 'restart', delayMs }, crashTimes: window };
}
