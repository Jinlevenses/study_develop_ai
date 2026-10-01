import type { ErrorRegistry } from '../../../common/errors.js';

// STD-ERR-01·D-STD-04 — learning 서비스 고유 오류 코드 레지스트리(IF-01 §2.6.3 전사, 문서 순서). 공통 코드(§2.6.2)는 common/errors.ts.
export const LR_ERRORS = {
  'LR-DEP-001': { status: 503, title: 'content 연결 실패 — retry-after: 1', retryable: true },
  'LR-NOTFOUND-001': { status: 404, title: '세션 없음', retryable: false },
  'LR-NOTFOUND-002': { status: 404, title: '블록 없음', retryable: false },
  'LR-NOTFOUND-003': { status: 404, title: '대화 없음', retryable: false },
  'LR-NOTFOUND-004': { status: 404, title: '개념이 curriculum_ref에 없음', retryable: false },
  'LR-NOTFOUND-005': { status: 404, title: '원장 이벤트 없음', retryable: false },
  'LR-NOTFOUND-006': { status: 404, title: '카드 없음', retryable: false },
  'LR-NOTFOUND-007': { status: 404, title: '장기 과제 없음', retryable: false },
  'LR-NOTFOUND-008': { status: 404, title: '체크포인트 없음', retryable: false },
  'LR-NOTFOUND-009': { status: 404, title: '원장 import·verify 작업 없음', retryable: false },
  'LR-NOTFOUND-010': { status: 404, title: '주간 리뷰·시즌·미리보기 없음', retryable: false },
  'LR-CONFLICT-010': { status: 409, title: '세션이 active가 아님', retryable: false },
  'LR-CONFLICT-011': { status: 409, title: '이미 active 세션 있음', retryable: false },
  'LR-CONFLICT-012': { status: 409, title: 'curriculum_ref 미초기화', retryable: false },
  'LR-CONFLICT-013': { status: 409, title: '블록 상태가 동작과 맞지 않음', retryable: false },
  'LR-CONFLICT-014': { status: 409, title: '응답의 item_id가 블록에 없음', retryable: false },
  'LR-CONFLICT-015': { status: 409, title: 'grade 확인 대기 상태 아님', retryable: false },
  'LR-CONFLICT-016': { status: 409, title: '대화 종료됨', retryable: false },
  'LR-CONFLICT-017': { status: 409, title: '승급 평가 자격 없음·재도전 대기', retryable: false },
  'LR-CONFLICT-018': { status: 409, title: '원장 병합·리플레이 job 실행 중', retryable: false },
  'LR-CONFLICT-019': { status: 409, title: '정책 미리보기 만료·불일치', retryable: false },
  'LR-CONFLICT-020': { status: 422, title: '원장 import 거부: 체인·앵커·스키마 버전 위반', retryable: false },
  'LR-VAL-010': { status: 422, title: '응답 kind가 블록 문항 형식과 맞지 않음', retryable: false },
  'LR-INTERNAL-001': { status: 500, title: '원장 무결성 경보', retryable: false },
} as const satisfies ErrorRegistry;
export type LrErrorCode = keyof typeof LR_ERRORS;
