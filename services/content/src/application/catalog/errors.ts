import type { CtErrorCode } from '@fathom/contracts/http/content/v1/errors';
import { CT_ERRORS } from '@fathom/contracts/http/content/v1/errors';
import type { ProblemExtras } from '@fathom/shared-kernel/errors/errors';
import { AppError } from '@fathom/shared-kernel/errors/errors';

// catalog BC 오류 생성기 — 코드·상태가 CT_ERRORS 레지스트리와 항상 일치한다(STD-ERR-03).
export function catalogError(code: CtErrorCode, detail?: string, extra?: ProblemExtras): AppError {
  return new AppError(code, CT_ERRORS[code].status, detail, extra === undefined ? undefined : { extra });
}

// PGM-CT-001·003 — 설치·조회 실패 분류 → CT 오류 코드(Brief T-01-07 §4.9). 검증 실패는 전부 CT-VAL-011(detail = 사유 코드).
export type CatalogFaultKind =
  | 'validation'
  | 'in_progress'
  | 'downgrade'
  | 'version_conflict'
  | 'jobs_busy'
  | 'install_not_found'
  | 'track_not_found';

export const CATALOG_ERROR_MAP = {
  validation: 'CT-VAL-011',
  in_progress: 'CT-CONFLICT-013',
  downgrade: 'CT-CONFLICT-013',
  version_conflict: 'CT-CONFLICT-013',
  jobs_busy: 'CT-DEP-002',
  install_not_found: 'CT-NOTFOUND-003',
  track_not_found: 'CT-NOTFOUND-004',
} as const satisfies Record<CatalogFaultKind, CtErrorCode>;

export function catalogFault(kind: CatalogFaultKind, detail?: string): AppError {
  return catalogError(CATALOG_ERROR_MAP[kind], detail);
}
