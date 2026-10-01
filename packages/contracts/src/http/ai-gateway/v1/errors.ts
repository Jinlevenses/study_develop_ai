import type { ErrorRegistry } from '../../../common/errors.js';

// STD-ERR-01·D-STD-04 — ai-gateway 서비스 고유 오류 코드 레지스트리(IF-01 §2.6.3 전사, 문서 순서). 공통 코드(§2.6.2)는 common/errors.ts.
export const AI_ERRORS = {
  'AI-POLICY-001': { status: 403, title: '제출 전 생성 금지', retryable: false },
  'AI-POLICY-002': { status: 403, title: 'background 호출에 승인된 work_order_id 없음', retryable: false },
  'AI-VAL-010': {
    status: 422,
    title: 'JudgeState에 배열·잘못된 키, 템플릿 변수가 없는 경로를 가리킴',
    retryable: false,
  },
  'AI-VAL-011': { status: 422, title: '질문 > 15 또는 0', retryable: false },
  'AI-VAL-012': { status: 422, title: '생성 입력이 과업 입력 스키마 위반', retryable: false },
  'AI-VAL-013': { status: 422, title: '키가 제공자 probe에서 거부됨', retryable: false },
  'AI-NOTFOUND-001': { status: 404, title: '과업 ID 없음', retryable: false },
  'AI-NOTFOUND-002': { status: 404, title: '제공자 없음', retryable: false },
  'AI-NOTFOUND-003': { status: 404, title: 'job 없음', retryable: false },
  'AI-NOTFOUND-004': { status: 404, title: '작업 주문 없음', retryable: false },
  'AI-NOTFOUND-005': { status: 404, title: '스트림 ref 없음·만료', retryable: false },
  'AI-NOTFOUND-006': { status: 404, title: '골드 항목 없음', retryable: false },
  'AI-NOTFOUND-007': { status: 404, title: '해당 제공자 비밀 없음', retryable: false },
  'AI-CONFLICT-010': { status: 409, title: '작업 주문 이미 결정됨', retryable: false },
  'AI-CONFLICT-011': { status: 409, title: 'job 취소 불가 상태', retryable: false },
  'AI-CONFLICT-012': { status: 409, title: '비밀 저장소 잠김', retryable: false },
  'AI-DEP-001': { status: 502, title: '제공자 오류', retryable: true },
  'AI-DEP-002': { status: 504, title: '제공자 데드라인 초과', retryable: true },
  'AI-DEP-003': { status: 503, title: '서킷 open', retryable: true },
} as const satisfies ErrorRegistry;
export type AiErrorCode = keyof typeof AI_ERRORS;
