import type { ServiceName } from './ids.js';
import { ErrorCode } from './problem.js';

// STD-ERR-01·D-STD-04 — 공통 오류 코드 레지스트리(IF-01 §2.6.2). 서비스 레지스트리(T-00-09·10)가 satisfies로 사용한다.
export type ErrorRegistryEntry = { readonly status: number; readonly title: string; readonly retryable: boolean };
export type ErrorRegistry = Readonly<Record<string, ErrorRegistryEntry>>;
export type SvcCode = 'GW' | 'CT' | 'LR' | 'AI' | 'OP';
export const SVC_CODE_OF = {
  gateway: 'GW',
  content: 'CT',
  learning: 'LR',
  'ai-gateway': 'AI',
  'ops-api': 'OP',
} as const satisfies Record<ServiceName, SvcCode>;

// 키 = '<CAT>-<NNN>' 접미. 완성 코드 = `${SvcCode}-${키}`.
export const COMMON_ERRORS = {
  'VAL-900': { status: 400, retryable: false, title: '요청 스키마 위반' },
  'VAL-901': { status: 400, retryable: false, title: 'Idempotency-Key 없음 또는 형식 오류' },
  'VAL-903': { status: 400, retryable: false, title: '커서 무효 또는 만료' },
  'VAL-904': { status: 415, retryable: false, title: '지원하지 않는 Content-Type' },
  'AUTH-900': { status: 401, retryable: false, title: '내부 호출자 토큰 없음 또는 무효' },
  'ACL-900': { status: 403, retryable: false, title: '허용되지 않은 호출자' },
  'NOTFOUND-900': { status: 404, retryable: false, title: '정의되지 않은 라우트' },
  'CONFLICT-001': { status: 422, retryable: false, title: '같은 Idempotency-Key에 다른 본문' },
  'CONFLICT-002': { status: 409, retryable: true, title: '같은 키의 요청이 처리 중' },
  'LIMIT-900': { status: 413, retryable: false, title: '본문 크기 초과' },
  'LIMIT-901': { status: 429, retryable: true, title: '요청 한도 초과' },
  'DEP-900': { status: 503, retryable: true, title: '정지 중 또는 쓰기 게이트 닫힘' },
  'DEP-901': { status: 503, retryable: true, title: '준비되지 않음' },
  'DEP-902': { status: 504, retryable: true, title: '데드라인 소진' },
  'DEP-910': { status: 503, retryable: true, title: 'inbox 원장 경로 정지' },
  'INTERNAL-900': { status: 500, retryable: false, title: '처리되지 않은 서버 오류' },
  'INTERNAL-901': { status: 500, retryable: false, title: '응답이 계약을 위반함' },
} as const satisfies ErrorRegistry;
export type CommonErrorSuffix = keyof typeof COMMON_ERRORS;

export function commonErrorCode(svc: SvcCode, suffix: CommonErrorSuffix): ErrorCode {
  return ErrorCode.parse(`${svc}-${suffix}`);
}
