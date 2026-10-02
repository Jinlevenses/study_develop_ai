// Brief T-01-06 §4.7 — 정책 세트 해석 실패. 서비스 오류 코드 매핑은 application/learner-model/errors.ts.

export type ProjectionParamsErrorKind = 'params_unresolvable' | 'params_hash_mismatch';

export class ProjectionParamsError extends Error {
  override readonly name = 'ProjectionParamsError';
  readonly kind: ProjectionParamsErrorKind;
  readonly policyVersion: string;

  constructor(kind: ProjectionParamsErrorKind, policyVersion: string, detail: string) {
    super(`${kind}: ${policyVersion}: ${detail}`);
    this.kind = kind;
    this.policyVersion = policyVersion;
  }
}
