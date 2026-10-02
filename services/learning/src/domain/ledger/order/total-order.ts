// ADR-011 §2 — 리플레이 총순서 `(client_ts, device_id, device_seq)`. rowid·도착 순서·ULID 시간 순서 금지.
export type TotalOrderKey = { readonly client_ts: number; readonly device_id: string; readonly device_seq: number };

/** `device_id`는 ASCII ULID(DDL CHECK)라 JS `<`가 SQLite BINARY 정렬과 같다. */
export function compareTotalOrder(a: TotalOrderKey, b: TotalOrderKey): number {
  if (a.client_ts !== b.client_ts) {
    return a.client_ts < b.client_ts ? -1 : 1;
  }
  if (a.device_id !== b.device_id) {
    return a.device_id < b.device_id ? -1 : 1;
  }
  if (a.device_seq !== b.device_seq) {
    return a.device_seq < b.device_seq ? -1 : 1;
  }
  return 0;
}
