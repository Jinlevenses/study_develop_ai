// 검증 결과 한 건(Brief T-01-03 §4.4) — V1·V2·V7·G0 모두 같은 모양. 정렬 = file → keypath → rule → message(코드 단위 사전순).
export type Severity = 'error' | 'warn' | 'info';

export type Finding = {
  readonly rule: string;
  readonly severity: Severity;
  readonly file: string;
  readonly keypath: string;
  readonly message: string;
};

export function finding(rule: string, severity: Severity, file: string, keypath: string, message: string): Finding {
  return { rule, severity, file, keypath, message };
}

/** 코드 단위 사전순(로캘 무관). */
export function byCode(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    byCode(a.file, b.file) || byCode(a.keypath, b.keypath) || byCode(a.rule, b.rule) || byCode(a.message, b.message)
  );
}

export function sortFindings(list: readonly Finding[]): Finding[] {
  return [...list].sort(compareFindings);
}

/** 사람용 한 줄: `<severity> <rule> <file>[#<keypath>] <message>`. */
export function formatFinding(f: Finding): string {
  const where = f.keypath === '' ? f.file : `${f.file}#${f.keypath}`;
  return `${f.severity} ${f.rule} ${where} ${f.message}`;
}

export function countBySeverity(list: readonly Finding[], severity: Severity): number {
  let n = 0;
  for (const f of list) {
    if (f.severity === severity) {
      n += 1;
    }
  }
  return n;
}
