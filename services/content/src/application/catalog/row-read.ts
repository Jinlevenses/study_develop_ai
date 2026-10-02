// SQLite 행(`Record<string, unknown>`) 좁히기 도우미 — 열 모양이 어긋나면 결함(invariant)이다(STD-TS-27: 비즈니스 오류가 아님).

export type Row = Readonly<Record<string, unknown>>;

export function str(row: Row, key: string): string {
  const v = row[key];
  if (typeof v !== 'string') {
    throw new Error(`invariant: column ${key} is not text`);
  }
  return v;
}

export function strOrNull(row: Row, key: string): string | null {
  const v = row[key];
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v !== 'string') {
    throw new Error(`invariant: column ${key} is not text`);
  }
  return v;
}

export function int(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === 'bigint') {
    return Number(v);
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new Error(`invariant: column ${key} is not an integer`);
  }
  return v;
}

export function intOrNull(row: Row, key: string): number | null {
  const v = row[key];
  if (v === null || v === undefined) {
    return null;
  }
  return int(row, key);
}
