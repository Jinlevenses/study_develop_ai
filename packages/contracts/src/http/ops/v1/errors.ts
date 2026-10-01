import type { ErrorRegistry } from '../../../common/errors.js';

// STD-ERR-01·D-STD-04 — ops-api 서비스 고유 오류 코드 레지스트리(IF-01 §2.6.3 전사, 문서 순서). 공통 코드(§2.6.2)는 common/errors.ts.
export const OP_ERRORS = {
  'OP-CONFLICT-010': { status: 409, title: '상호 배타 작업 실행 중', retryable: false },
  'OP-CONFLICT-011': { status: 422, title: 'epoch 매니페스트 무효·조합 불일치·앵커 불일치', retryable: false },
  'OP-VAL-010': { status: 422, title: '경로 무효', retryable: false },
  'OP-VAL-011': { status: 422, title: '번들 sha256·Node 호환 불일치', retryable: false },
  'OP-NOTFOUND-001': { status: 404, title: 'epoch 없음', retryable: false },
  'OP-NOTFOUND-002': { status: 404, title: 'operation 없음', retryable: false },
  'OP-NOTFOUND-003': { status: 404, title: '배너 없음', retryable: false },
  'OP-NOTFOUND-004': { status: 404, title: '알 수 없는 서비스 이름', retryable: false },
  'OP-DEP-001': { status: 503, title: 'supervisor IPC 불가', retryable: true },
} as const satisfies ErrorRegistry;
export type OpErrorCode = keyof typeof OP_ERRORS;
