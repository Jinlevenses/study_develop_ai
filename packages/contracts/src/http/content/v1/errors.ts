import type { ErrorRegistry } from '../../../common/errors.js';

// STD-ERR-01·D-STD-04 — content 서비스 고유 오류 코드 레지스트리(IF-01 §2.6.3 전사, 문서 순서). 공통 코드(§2.6.2)는 common/errors.ts.
export const CT_ERRORS = {
  'CT-LIMIT-001': { status: 429, title: '러너 대기 큐 > 20', retryable: true },
  'CT-LIMIT-002': { status: 413, title: '가져오기 원문 > 2 MiB', retryable: false },
  'CT-POLICY-001': { status: 403, title: '러너 출처 정책 위반', retryable: false },
  'CT-POLICY-002': { status: 403, title: '이 OS에서 러너 형식 비활성', retryable: false },
  'CT-POLICY-003': { status: 403, title: 'SSRF 가드 거부', retryable: false },
  'CT-POLICY-004': { status: 403, title: '출제 불가 상태', retryable: false },
  'CT-NOTFOUND-001': { status: 404, title: '개념 없음', retryable: false },
  'CT-NOTFOUND-002': { status: 404, title: '문항 없음', retryable: false },
  'CT-NOTFOUND-003': { status: 404, title: '팩·설치 작업 없음', retryable: false },
  'CT-NOTFOUND-004': { status: 404, title: '트랙 없음', retryable: false },
  'CT-NOTFOUND-005': { status: 404, title: '가져오기 작업 없음', retryable: false },
  'CT-NOTFOUND-006': { status: 404, title: 'Inbox 항목 없음', retryable: false },
  'CT-NOTFOUND-007': { status: 404, title: '신고 없음', retryable: false },
  'CT-NOTFOUND-008': { status: 404, title: '오버레이 패치·충돌 없음', retryable: false },
  'CT-NOTFOUND-009': { status: 404, title: 'Verdict 없음', retryable: false },
  'CT-NOTFOUND-010': { status: 404, title: '이의제기 없음', retryable: false },
  'CT-NOTFOUND-011': { status: 404, title: '스트림 ref 없음·만료', retryable: false },
  'CT-CONFLICT-010': { status: 409, title: '자기채점 대기 상태 아님·이미 채점됨', retryable: false },
  'CT-CONFLICT-011': { status: 409, title: '오버레이 base_version 낡음', retryable: false },
  'CT-CONFLICT-012': { status: 409, title: '가져오기 작업 상태가 동작과 맞지 않음', retryable: false },
  'CT-CONFLICT-013': { status: 409, title: '팩 설치 진행 중·하향 설치 거부', retryable: false },
  'CT-CONFLICT-014': { status: 409, title: 'Verdict가 이미 대체됨·같은 Verdict 이의 진행 중', retryable: false },
  'CT-CONFLICT-015': { status: 409, title: 'S2 3요건 미충족 상태에서 승인 시도 또는 이미 결정됨', retryable: false },
  'CT-VAL-010': { status: 422, title: '응답 kind가 문항 형식과 맞지 않음', retryable: false },
  'CT-VAL-011': { status: 422, title: '.fpack sha256·merkle·스키마 검증 실패', retryable: false },
  'CT-DEP-002': { status: 503, title: '서비스 job 슬롯 사용 중 — retry-after', retryable: true },
} as const satisfies ErrorRegistry;
export type CtErrorCode = keyof typeof CT_ERRORS;
