import type { CtErrorCode } from '@fathom/contracts/http/content/v1/errors';
import { CT_ERRORS } from '@fathom/contracts/http/content/v1/errors';
import type { ProblemExtras } from '@fathom/shared-kernel/errors/errors';
import { AppError } from '@fathom/shared-kernel/errors/errors';

// grading BC 오류 생성기 — 코드·상태가 CT_ERRORS 레지스트리와 항상 일치한다(STD-ERR-03).
export function gradingError(code: CtErrorCode, detail?: string, extra?: ProblemExtras): AppError {
  return new AppError(code, CT_ERRORS[code].status, detail, extra === undefined ? undefined : { extra });
}
