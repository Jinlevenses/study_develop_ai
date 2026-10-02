import { eventHash, GENESIS_HASH, type HashableEvent, type HashPort } from './hash.js';

// ADR-011 §2 · FR-PRG-003 — 기기별 체인 연속성 검증(중간 변조 = hash_mismatch·prev_mismatch, 번호 공백 = seq_gap).
export type ChainRow = HashableEvent & { readonly hash: string };
export type ChainBreakReason = 'prev_mismatch' | 'seq_gap' | 'hash_mismatch';
export type ChainBreak = { readonly device_id: string; readonly device_seq: number; readonly reason: ChainBreakReason };
export type DeviceHead = { readonly seq: number; readonly head_hash: string };
export type ChainReport = {
  readonly events: number;
  readonly devices: Readonly<Record<string, DeviceHead>>;
  readonly breaks: readonly ChainBreak[];
};

/**
 * `rows`는 `(device_id, device_seq)` 오름차순이어야 한다. 기기 첫 행은 `startHeads`에 있으면 그 헤드를, 없으면
 * `(seq 0, GENESIS_HASH)`를 직전으로 본다(증분 import 시작점). 행마다 위반은 최대 1건(seq_gap > prev_mismatch > hash_mismatch).
 * 위반 뒤에도 그 행의 저장된 `hash`를 다음 행의 기대 `prev_hash`로 삼아 이어서 검사한다(한 번의 변조 = 한 건의 위반).
 */
export function verifyChains(
  h: HashPort,
  rows: Iterable<ChainRow>,
  startHeads: Readonly<Record<string, DeviceHead>> = {},
): ChainReport {
  const heads = new Map<string, DeviceHead>(Object.entries(startHeads));
  const breaks: ChainBreak[] = [];
  let events = 0;
  for (const row of rows) {
    events += 1;
    const head = heads.get(row.device_id) ?? { seq: 0, head_hash: GENESIS_HASH };
    let reason: ChainBreakReason | null = null;
    if (row.device_seq !== head.seq + 1) {
      reason = 'seq_gap';
    } else if (row.prev_hash !== head.head_hash) {
      reason = 'prev_mismatch';
    } else if (eventHash(h, row) !== row.hash) {
      reason = 'hash_mismatch';
    }
    if (reason !== null) {
      breaks.push({ device_id: row.device_id, device_seq: row.device_seq, reason });
    }
    heads.set(row.device_id, { seq: row.device_seq, head_hash: row.hash });
  }
  const devices: Record<string, DeviceHead> = {};
  for (const id of [...heads.keys()].sort()) {
    const head = heads.get(id);
    if (head !== undefined) {
      devices[id] = head;
    }
  }
  return { events, devices, breaks };
}
