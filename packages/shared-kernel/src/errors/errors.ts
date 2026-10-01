// STD-01 §4.3 — 타입드 에러·Result. 순수 모듈(STD-DIR-32): import 0.

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** 판별 유니온 `switch`의 `default: return assertNever(x)` 종결(STD-TS-17). */
export function assertNever(x: never): never {
  throw new Error(`unreachable: ${JSON.stringify(x)}`);
}

/** `noUncheckedIndexedAccess`로 생긴 `T | undefined`를 결함으로 처리한다(STD-TS-11). `0`·`''`·`false`는 통과. */
export function assertDefined<T>(x: T | undefined | null, reason: string): T {
  if (x === undefined || x === null) {
    throw new Error(`invariant: ${reason}`);
  }
  return x;
}

export type ErrorCodeString =
  `${'GW' | 'CT' | 'LR' | 'AI' | 'OP' | 'CLI'}-${'VAL' | 'AUTH' | 'ACL' | 'NOTFOUND' | 'CONFLICT' | 'DEP' | 'LIMIT' | 'POLICY' | 'INTERNAL'}-${string}`;

export type ProblemExtras = {
  readonly errors?: readonly { path: string; message: string; rule: string }[];
  readonly dependency?: string;
  readonly retry_after_ms?: number;
  readonly acked_through_seq?: number;
  readonly active_session_id?: string;
  readonly violations?: readonly Record<string, unknown>[];
};

// contracts `ErrorCode`와 같은 정규식(순수 규칙이라 import하지 않는다 — Brief 결정).
const ERROR_CODE_PATTERN = /^(GW|CT|LR|AI|OP|CLI)-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/;

/** ARC-01 §17.3 `AppError(code, status, detail)` — 예상된 업무 실패를 Problem으로 옮기는 유일한 예외 클래스(STD-TS-27). */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: ErrorCodeString;
  readonly status: number;
  /** 사용자 표시 가능 문구. 스택·경로·SQL 0(NFR-SEC-012). */
  readonly detail: string | undefined;
  readonly extra: ProblemExtras | undefined;

  constructor(
    code: ErrorCodeString,
    status: number,
    detail?: string,
    opts?: { readonly cause?: unknown; readonly extra?: ProblemExtras },
  ) {
    if (!ERROR_CODE_PATTERN.test(code)) {
      throw new Error(`invariant: AppError code malformed: ${code}`);
    }
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error(`invariant: AppError status out of range: ${String(status)}`);
    }
    super(code, { cause: opts?.cause });
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.extra = opts?.extra;
  }
}
