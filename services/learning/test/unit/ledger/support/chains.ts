import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { fixedUlid } from '@fathom/testkit/ids';
import { eventHash, GENESIS_HASH } from '../../../../src/domain/ledger/chain/hash.js';
import { NODE_HASH_PORT } from '../../../../src/infra/ledger/hash-port.js';
import { fixturePayload } from '../../../contract/ledger/ledger-fixtures.js';

/** 기기 하나의 올바른 체인(`card.status_changed` 표본, client_ts = times 그대로 — 단조일 필요 없음). 이벤트 ID·키는 `salt`로 구분한다. */
export function envelopeChain(device: string, times: readonly number[], salt: number): LedgerEventEnvelope[] {
  const out: LedgerEventEnvelope[] = [];
  let prev = GENESIS_HASH;
  for (const [i, ts] of times.entries()) {
    const seq = i + 1;
    const base = {
      event_id: fixedUlid(salt * 1000 + seq),
      device_id: device,
      device_seq: seq,
      client_ts: ts,
      type: 'card.status_changed' as const,
      schema_version: 1,
      idempotency_key: `cmd:${fixedUlid(salt * 1000 + 500 + seq)}`,
      payload: fixturePayload('card.status_changed'),
      prev_hash: prev,
    };
    const hash = eventHash(NODE_HASH_PORT, base);
    out.push({ ...base, hash, experiment_arm: null, recorded_at: 1 });
    prev = hash;
  }
  return out;
}
