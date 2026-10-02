import { canonicalJson, parseJsonStrict, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { AnchorViolation } from '../../domain/ledger/chain/anchor.js';
import { verifyAnchor } from '../../domain/ledger/chain/anchor.js';
import type { HashPort } from '../../domain/ledger/chain/hash.js';
import type { ChainBreak, ChainReport, ChainRow, DeviceHead } from '../../domain/ledger/chain/verify.js';
import { verifyChains } from '../../domain/ledger/chain/verify.js';
import { LEDGER_CHAIN_ROWS, LEDGER_HASH_AT, LR_CHECKPOINT_LATEST } from '../../infra/ledger/ledger.sql.js';
import type { LedgerFault } from './ports.js';

// 해시 포트 = shared-kernel 정준 JSON + SHA-256 (application은 구체 infra를 import하지 않는다 — STD-01 §2).
const HASH_PORT: HashPort = { canonical: canonicalJson, sha256: (value) => sha256Hex(value) };

// FR-PRG-003 · ADR-011 §2 — 체인 전체 검증 + 외부 앵커 대조(꼬리 변조·절단). doctor·야간 무결성·restore 검사의 공통 엔진.
export type LedgerInspection = {
  readonly report: ChainReport;
  readonly anchor: 'given' | 'checkpoint' | 'none';
  readonly anchor_violations: readonly AnchorViolation[];
};

function* chainRows(db: SqlitePort): IterableIterator<ChainRow> {
  for (const r of db.prepare(LEDGER_CHAIN_ROWS).iterate()) {
    const payload = parseJsonStrict(String(r.payload));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error(`invariant: ledger payload is not an object (event_id=${String(r.event_id)})`);
    }
    yield {
      event_id: String(r.event_id),
      device_id: String(r.device_id),
      device_seq: Number(r.device_seq),
      client_ts: Number(r.client_ts),
      type: String(r.type),
      schema_version: Number(r.schema_version),
      idempotency_key: String(r.idempotency_key),
      payload: Object.fromEntries(Object.entries(payload)),
      prev_hash: String(r.prev_hash),
      hash: String(r.hash),
    };
  }
}

function checkpointAnchor(db: SqlitePort): Record<string, DeviceHead> | null {
  const row = db.prepare(LR_CHECKPOINT_LATEST).get();
  if (row === undefined) {
    return null;
  }
  const parsed = parseJsonStrict(String(row.devices_json));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invariant: lr_checkpoint.devices_json is not an object');
  }
  const out: Record<string, DeviceHead> = {};
  for (const [deviceId, head] of Object.entries(parsed)) {
    if (typeof head !== 'object' || head === null || !('seq' in head) || !('head_hash' in head)) {
      throw new Error('invariant: lr_checkpoint.devices_json entry malformed');
    }
    out[deviceId] = { seq: Number(head.seq), head_hash: String(head.head_hash) };
  }
  return out;
}

/** 체인 + 앵커를 모두 검사해 위반 전체를 낸다(첫 위반에서 멈추지 않는다). `opts.anchor`가 없으면 최신 `lr_checkpoint`를 쓴다. */
export function inspectLedger(
  db: SqlitePort,
  opts: { readonly anchor?: Readonly<Record<string, DeviceHead>> } = {},
): LedgerInspection {
  const report = verifyChains(HASH_PORT, chainRows(db));
  const given = opts.anchor;
  const anchor = given ?? checkpointAnchor(db);
  const hashAt = db.prepare(LEDGER_HASH_AT);
  const violations =
    anchor === null
      ? []
      : verifyAnchor(anchor, (deviceId, seq) => {
          const row = hashAt.get({ device_id: deviceId, device_seq: seq });
          return row === undefined ? null : String(row.hash);
        });
  return {
    report,
    anchor: given !== undefined ? 'given' : anchor === null ? 'none' : 'checkpoint',
    anchor_violations: violations,
  };
}

function firstBreakFault(b: ChainBreak): LedgerFault {
  return { kind: 'chain_broken', detail: b.reason, device_id: b.device_id, device_seq: b.device_seq };
}

/** 체인 전체 + 앵커(주어지지 않으면 최신 체크포인트) 대조. 위반 = err(chain_broken | anchor_mismatch), 정상 = ChainReport. */
export function verifyLedger(
  db: SqlitePort,
  opts: { readonly anchor?: Readonly<Record<string, DeviceHead>> } = {},
): Result<ChainReport, LedgerFault> {
  const inspection = inspectLedger(db, opts);
  const broken = inspection.report.breaks[0];
  if (broken !== undefined) {
    return err(firstBreakFault(broken));
  }
  const violation = inspection.anchor_violations[0];
  if (violation !== undefined) {
    return err({ kind: 'anchor_mismatch', detail: violation.reason, device_id: violation.device_id });
  }
  return ok(inspection.report);
}
