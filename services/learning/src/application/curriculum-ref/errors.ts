import type { LR_ERRORS } from '@fathom/contracts/http/learning/v1/errors';

// DomainError.kind → 서비스 오류 코드(STD-ERR-10). IT-00 골격 = 0행.
export const CURRICULUM_REF_ERROR_MAP = {} as const satisfies Readonly<Record<string, keyof typeof LR_ERRORS>>;
