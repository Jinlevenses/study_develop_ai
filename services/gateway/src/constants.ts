import type { RuntimeProfile } from '@fathom/contracts/common/domain';

// config.ts가 다시 내보내는 순수 상수·함수 — app.ts를 거치지 않는 말단 모듈이라 http/·infra/가 config.ts와 순환하지 않고 가져다 쓴다.

export const DEFAULT_VITE_ORIGIN = 'http://127.0.0.1:5173';

export const GATEWAY_LIMITS = {
  bootstrapTtlMs: 60_000,
  bootstrapMaxOutstanding: 16,
  cookieMaxAgeS: 34_560_000,
  cookieRollAfterS: 86_400,
  cookieFutureSkewS: 300,
  rateMax: 300,
  rateWindowMs: 60_000,
  rateMaxKeys: 10_000,
  sseRing: 1_000,
  sseHeartbeatMs: 15_000,
  sseRetryMs: 2_000,
  sseMaxPerSession: 8,
} as const;

/** prod 4748~4756 · dev 4848~4856 · test [] (T-00-11 §4.1.6과 같은 값). */
export function gatewayFallbacks(profile: RuntimeProfile): readonly number[] {
  const start = profile === 'prod' ? 4748 : profile === 'dev' ? 4848 : null;
  return start === null ? [] : Array.from({ length: 9 }, (_, i) => start + i);
}

const CSP_COMMON = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
] as const;

/** D-STD-24(CR-61) — dev는 Vite HMR 때문에 인라인 스크립트와 실제 포트의 ws 연결을 허용한다(Brief 결정: 4847 고정 대신 실제 포트). */
export function cspFor(profile: RuntimeProfile, port: number): string {
  if (profile !== 'dev') {
    return CSP_COMMON.join('; ');
  }
  return CSP_COMMON.map((d) => {
    if (d === "script-src 'self'") {
      return "script-src 'self' 'unsafe-inline'";
    }
    return d === "connect-src 'self'" ? `connect-src 'self' ws://127.0.0.1:${port}` : d;
  }).join('; ');
}
