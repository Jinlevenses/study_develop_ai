import type { HashPort } from './hash.js';
import type { DeviceHead } from './verify.js';

// ADR-011 §2 — 체인 헤드 외부 앵커(체크포인트·export 헤더·epoch ledger_head). 꼬리 변조·절단은 앵커 seq 시점의 해시 비교로 잡는다.
export type AnchorMap = Readonly<Record<string, DeviceHead>>;
export type AnchorViolation = {
  readonly device_id: string;
  readonly reason: 'truncated' | 'head_mismatch' | 'device_missing';
};

/** `sha256(canonical(devices))` — `lr_checkpoint.root_hash`·export 헤더 `root_hash`. */
export function rootHash(h: HashPort, devices: AnchorMap): string {
  return h.sha256(h.canonical(devices));
}

/**
 * `hashAt(device, seq)` = 현재 원장에서 그 기기의 그 번호 행의 hash(없으면 null). 비교는 현재 헤드가 아니라 **앵커 seq 시점**이다 —
 * 앵커 이후에 정상 append된 행은 위반이 아니다.
 *  - 기기 행이 하나도 없음 = device_missing · 앵커 seq 행이 없음 = truncated · hash 다름 = head_mismatch.
 */
export function verifyAnchor(
  anchor: AnchorMap,
  hashAt: (deviceId: string, seq: number) => string | null,
): AnchorViolation[] {
  const out: AnchorViolation[] = [];
  for (const deviceId of Object.keys(anchor).sort()) {
    const head = anchor[deviceId];
    if (head === undefined) {
      continue;
    }
    const current = hashAt(deviceId, head.seq);
    if (current === null) {
      out.push({ device_id: deviceId, reason: hashAt(deviceId, 1) === null ? 'device_missing' : 'truncated' });
    } else if (current !== head.head_hash) {
      out.push({ device_id: deviceId, reason: 'head_mismatch' });
    }
  }
  return out;
}
