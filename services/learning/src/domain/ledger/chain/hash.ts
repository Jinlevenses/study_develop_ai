// ported-from: spikes/sp3-replay-determinism/src/ledger.ts (audit-fixed: lr_event DDL·전체 sha256 체인(32자 절단 폐기)·체인 헤드 외부 앵커·recursive_triggers·CHECK 묵살 재확인·study_day 04:00·정정은 새 이벤트·Date/any 0)
import type { LedgerEventType } from '@fathom/contracts/ledger/envelope';

// ADR-011 §1·§2 — 기기별 해시 체인. 순수 규칙이라 정준화·SHA-256은 포트로 주입받는다(STD-DIR-32, boundaries domain_pure).
export type HashPort = {
  /** 정준 JSON(키 정렬·공백 0, NFR-DATA-002). */
  canonical(v: unknown): string;
  /** 소문자 hex 64. */
  sha256(s: string): string;
};

/** 기기 첫 이벤트의 `prev_hash`. */
export const GENESIS_HASH = '0'.repeat(64);

/** 해시 입력이 되는 9필드. `experiment_arm`·`recorded_at`·`ext`는 해시 대상이 아니다. */
export type HashableEvent = {
  readonly event_id: string;
  readonly device_id: string;
  readonly device_seq: number;
  readonly client_ts: number;
  readonly type: LedgerEventType | string;
  readonly schema_version: number;
  readonly idempotency_key: string;
  /** 저장 문자열이 아니라 파싱된 객체 — 정준화는 포트가 한다. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly prev_hash: string;
};

/** `sha256(canonical({event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash}))`. */
export function eventHash(h: HashPort, e: HashableEvent): string {
  return h.sha256(
    h.canonical({
      event_id: e.event_id,
      device_id: e.device_id,
      device_seq: e.device_seq,
      client_ts: e.client_ts,
      type: e.type,
      schema_version: e.schema_version,
      idempotency_key: e.idempotency_key,
      payload: e.payload,
      prev_hash: e.prev_hash,
    }),
  );
}
