// STD-SQL-06 — 정적 SQL 조각. 이름·개수·정수만 SQL 텍스트에 들어갈 수 있고, 값은 항상 바인딩한다.

const IDENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 식별자(테이블·열 이름) 인용. 패턴 밖이면 결함으로 던진다. */
export function ident(name: string): string {
  if (typeof name !== 'string' || !IDENT_PATTERN.test(name)) {
    throw new Error('invariant: sql ident invalid');
  }
  return `"${name}"`;
}

/** `?, ?, …` n개(1~999 — SQLITE_MAX_VARIABLE_NUMBER 기본값 안). */
export function placeholders(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new Error('invariant: sql placeholders count out of range 1..999');
  }
  return new Array<string>(n).fill('?').join(', ');
}

/** 안전 정수 리터럴. PRAGMA 값처럼 바인딩할 수 없는 자리에만 쓴다. */
export function sqlInt(n: number): string {
  if (!Number.isSafeInteger(n)) {
    throw new Error('invariant: sql int not a safe integer');
  }
  return String(n);
}
