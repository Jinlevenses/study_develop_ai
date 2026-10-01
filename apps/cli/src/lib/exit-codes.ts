// IF-01 §2.6.3 CLI 종료 코드·`CLI-*` 코드 (STD-ERR-01).
export const EXIT = {
  OK: 0,
  FAILED: 1,
  USAGE: 2,
  NOT_RUNNING: 3,
  AUTH: 4,
  CONFLICT: 5,
  VALIDATION: 6,
  PARTIAL: 7,
} as const;

export const CLI_CODES = {
  'CLI-DEP-001': { exit: 3, title: '앱이 실행 중이 아닙니다' },
  'CLI-AUTH-001': { exit: 4, title: 'CLI 토큰을 읽을 수 없습니다' },
  'CLI-VAL-001': { exit: 2, title: '사용법 오류' },
} as const;
export type CliCode = keyof typeof CLI_CODES;

/** 서버가 준 Problem 코드 → 종료 코드. `CLI-*`는 표, 그 밖은 범주(AUTH·CONFLICT·VAL)로, 나머지는 1. */
export function exitForProblemCode(code: string): number {
  if (code.startsWith('CLI-')) {
    const entry = (CLI_CODES as Record<string, { exit: number } | undefined>)[code];
    return entry?.exit ?? EXIT.FAILED;
  }
  if (/-AUTH-/.test(code)) {
    return EXIT.AUTH;
  }
  if (/-CONFLICT-/.test(code)) {
    return EXIT.CONFLICT;
  }
  if (/-VAL-/.test(code)) {
    return EXIT.VALIDATION;
  }
  return EXIT.FAILED;
}
