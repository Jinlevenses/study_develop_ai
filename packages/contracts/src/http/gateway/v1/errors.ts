import type { ErrorRegistry } from '../../../common/errors.js';

// STD-ERR-01·D-STD-04 — gateway 서비스 고유 오류 코드 레지스트리(IF-01 §2.6.3 전사, 문서 순서). 공통 코드(§2.6.2)는 common/errors.ts.
export const GW_ERRORS = {
  'GW-AUTH-001': { status: 401, title: '쿠키의 <port> ≠ gateway listen 포트', retryable: false },
  'GW-AUTH-002': { status: 403, title: 'X-Fathom-CSRF 없음·불일치', retryable: false },
  'GW-AUTH-003': { status: 401, title: '세션 쿠키 없음·MAC 불일치·버전 불명', retryable: false },
  'GW-AUTH-004': { status: 401, title: '부트스트랩 토큰 무효·만료·재사용', retryable: false },
  'GW-AUTH-005': { status: 421, title: 'Host ∉ {127.0.0.1:<port>, localhost:<port>}', retryable: false },
  'GW-AUTH-006': { status: 403, title: 'Origin 불일치 또는 Sec-Fetch-Site ∉ {same-origin, none}', retryable: false },
  'GW-AUTH-007': { status: 401, title: 'CLI 토큰 무효', retryable: false },
  'GW-ACL-001': {
    status: 403,
    title: '쿠키로 /api/v1/cli/* 호출 또는 CLI 토큰으로 브라우저 라우트 호출',
    retryable: false,
  },
  'GW-LIMIT-001': { status: 429, title: '세션·CLI 토큰 300 req/min 초과', retryable: true },
  'GW-LIMIT-002': { status: 429, title: '세션당 SSE 연결 > 8', retryable: true },
  'GW-DEP-001': { status: 503, title: '하위 서비스 연결 실패', retryable: true },
  'GW-DEP-002': { status: 503, title: '유지보수 모드', retryable: true },
  'GW-DEP-003': { status: 503, title: 'quiesce로 interactive 쓰기 대기 > 3s', retryable: true },
  'GW-CONFLICT-010': { status: 409, title: 'x-fathom-client 버전 ≠ 서버 app_version', retryable: false },
} as const satisfies ErrorRegistry;
export type GwErrorCode = keyof typeof GW_ERRORS;
