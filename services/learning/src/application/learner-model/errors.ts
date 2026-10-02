import type { LR_ERRORS } from '@fathom/contracts/http/learning/v1/errors';

// DomainError.kind → 서비스 오류 코드(STD-ERR-10). 정책 세트 해석 실패·투영 불변식 위반 = 원장 무결성 경보(LR-INTERNAL-001).
export const LEARNER_MODEL_ERROR_MAP = {
  params_unresolvable: 'LR-INTERNAL-001',
  params_hash_mismatch: 'LR-INTERNAL-001',
  projection_invariant: 'LR-INTERNAL-001',
} as const satisfies Readonly<Record<string, keyof typeof LR_ERRORS>>;
