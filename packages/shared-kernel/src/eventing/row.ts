// SQL 결과 행(`Record<string, unknown>`)에서 값을 좁히는 작은 도우미. 열이 기대한 타입이 아니면 결함으로 던진다(STD-TS-11).

export function rowInt(row: Readonly<Record<string, unknown>>, key: string): number {
  const v = row[key];
  if (typeof v === 'number' && Number.isSafeInteger(v)) {
    return v;
  }
  if (typeof v === 'bigint' && v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(v);
  }
  throw new Error(`invariant: sql column ${key} is not a safe integer`);
}

export function rowStr(row: Readonly<Record<string, unknown>>, key: string): string {
  const v = row[key];
  if (typeof v === 'string') {
    return v;
  }
  throw new Error(`invariant: sql column ${key} is not text`);
}

export function rowStrOrNull(row: Readonly<Record<string, unknown>>, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v === 'string') {
    return v;
  }
  throw new Error(`invariant: sql column ${key} is not text or null`);
}

export function rowIntOrNull(row: Readonly<Record<string, unknown>>, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined) {
    return null;
  }
  return rowInt(row, key);
}
