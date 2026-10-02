import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { rootHash } from '../../domain/ledger/chain/anchor.js';
import type { HashPort } from '../../domain/ledger/chain/hash.js';
import type { DeviceHead } from '../../domain/ledger/chain/verify.js';
import { LEDGER_HEADS, LR_CHECKPOINT_INSERT } from '../../infra/ledger/ledger.sql.js';

// 해시 포트 = shared-kernel 정준 JSON + SHA-256 (application은 구체 infra를 import하지 않는다 — STD-01 §2).
const HASH_PORT: HashPort = { canonical: canonicalJson, sha256: (v) => sha256Hex(v) };

export type CheckpointKind = 'export' | 'merge' | 'epoch' | 'local';
export type CheckpointResult = {
  readonly checkpoint_id: string;
  readonly root_hash: string;
  readonly devices: Record<string, DeviceHead>;
};

/** 현재 원장 헤드 읽기 = 앵커 후보(`{device_id: {seq, head_hash}}`). */
export function readLedgerHeads(db: SqlitePort): Record<string, DeviceHead> {
  const devices: Record<string, DeviceHead> = {};
  for (const row of db.prepare(LEDGER_HEADS).all()) {
    devices[String(row.device_id)] = { seq: Number(row.seq), head_hash: String(row.head_hash) };
  }
  return devices;
}

/**
 * 체인 헤드 외부 앵커 ①(ADR-011 §2, CR-27): 기기별 헤드 맵을 `lr_checkpoint`(append-only)에 한 행으로 남긴다.
 * 원장 쓰기와 원자성이 필요하면 호출자가 `db.tx()` 안에서 부른다(이 함수는 tx를 열지 않는다 — merge job의 최종 tx 안에서도 쓰인다).
 */
export function createCheckpoint(
  db: SqlitePort,
  deps: { readonly clock: Clock; readonly newId: () => string },
  kind: CheckpointKind,
  extras: { readonly source_file_sha256?: string; readonly projection_hash?: string } = {},
): CheckpointResult {
  const devices = readLedgerHeads(db);
  const root = rootHash(HASH_PORT, devices);
  const checkpointId = deps.newId();
  db.prepare(LR_CHECKPOINT_INSERT).run({
    checkpoint_id: checkpointId,
    kind,
    devices_json: canonicalJson(devices),
    root_hash: root,
    source_file_sha256: extras.source_file_sha256 ?? null,
    projection_hash: extras.projection_hash ?? null,
    created_at: deps.clock.now(),
  });
  return { checkpoint_id: checkpointId, root_hash: root, devices };
}
