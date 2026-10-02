import { createHash } from 'node:crypto';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { rootHash, verifyAnchor } from '../../../src/domain/ledger/chain/anchor.js';
import type { HashableEvent, HashPort } from '../../../src/domain/ledger/chain/hash.js';
import { eventHash, GENESIS_HASH } from '../../../src/domain/ledger/chain/hash.js';
import type { ChainRow } from '../../../src/domain/ledger/chain/verify.js';
import { verifyChains } from '../../../src/domain/ledger/chain/verify.js';
import { NODE_HASH_PORT } from '../../../src/infra/ledger/hash-port.js';

const H: HashPort = NODE_HASH_PORT;

/** `device`의 n건 체인(client_ts 단조, payload 고유). */
function chain(device: string, n: number, from = 1, prev = GENESIS_HASH): ChainRow[] {
  const out: ChainRow[] = [];
  let prevHash = prev;
  for (let seq = from; seq < from + n; seq += 1) {
    const e: HashableEvent = {
      event_id: fixedUlid(seq * 1000 + device.charCodeAt(device.length - 1)),
      device_id: device,
      device_seq: seq,
      client_ts: 1_000_000 + seq,
      type: 'card.status_changed',
      schema_version: 1,
      idempotency_key: `cmd:${fixedUlid(seq)}`,
      payload: { n: seq },
      prev_hash: prevHash,
    };
    const hash = eventHash(H, e);
    out.push({ ...e, hash });
    prevHash = hash;
  }
  return out;
}
const DEV_A = fixedUlid(1);
const DEV_B = fixedUlid(2);

describe('eventHash', () => {
  it('UT-LR-004 hash = sha256(정준 JSON 9필드), 고정 입력 → 고정 64자 hex [FR-PRG-003]', () => {
    const e: HashableEvent = {
      event_id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
      device_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      device_seq: 1,
      client_ts: 1_790_000_000_000,
      type: 'card.enrolled',
      schema_version: 1,
      idempotency_key: 'card:k8s.probes:definition:p',
      payload: { concept_id: 'k8s.probes', card_id: 'k8s.probes:definition:p' },
      prev_hash: GENESIS_HASH,
    };
    const expected = 'a1ef5820b8e2aa6dd76135f2d0643a776ac99e31d8d95bbc67dbf363e90b9eb0';
    expect(eventHash(H, e)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    // 독립 계산(키 사전순 JSON)과 동일 — `|` 연결·32자 절단 해시가 아니다.
    const independent = createHash('sha256')
      .update(
        '{"client_ts":1790000000000,"device_id":"01ARZ3NDEKTSV4RRFFQ69G5FAV","device_seq":1,"event_id":"01ARZ3NDEKTSV4RRFFQ69G5FA1","idempotency_key":"card:k8s.probes:definition:p","payload":{"card_id":"k8s.probes:definition:p","concept_id":"k8s.probes"},"prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","schema_version":1,"type":"card.enrolled"}',
      )
      .digest('hex');
    expect(independent).toBe(expected);
    // 해시 입력은 정확히 9필드 — 여분 필드(experiment_arm·recorded_at·ext)는 영향이 없다.
    const withExtras = { ...e, experiment_arm: 'x', recorded_at: 5, ext: '{"a":1}' };
    expect(eventHash(H, withExtras)).toBe(expected);
    // 포트 주입: 정준화·해시는 포트가 한다.
    const spy: string[] = [];
    eventHash(
      {
        canonical: (v) => {
          spy.push(canonicalJson(v));
          return canonicalJson(v);
        },
        sha256: sha256Hex,
      },
      e,
    );
    expect(Object.keys(JSON.parse(spy[0] ?? '{}')).sort()).toEqual([
      'client_ts',
      'device_id',
      'device_seq',
      'event_id',
      'idempotency_key',
      'payload',
      'prev_hash',
      'schema_version',
      'type',
    ]);
  });
});

describe('verifyChains', () => {
  it('UT-LR-045 첫 행 prev_hash = GENESIS·seq = 1 [FR-PRG-003]', () => {
    const rows = chain(DEV_A, 3);
    expect(verifyChains(H, rows).breaks).toEqual([]);
    const bad = rows.map((r, i) => (i === 0 ? { ...r, prev_hash: 'f'.repeat(64) } : r));
    expect(verifyChains(H, bad).breaks).toEqual([{ device_id: DEV_A, device_seq: 1, reason: 'prev_mismatch' }]);
    const startsAtTwo = chain(DEV_A, 2, 2);
    expect(verifyChains(H, startsAtTwo).breaks[0]).toEqual({ device_id: DEV_A, device_seq: 2, reason: 'seq_gap' });
  });

  it('UT-LR-046 seq 공백 = seq_gap [FR-PRG-003]', () => {
    const rows = chain(DEV_A, 5).filter((r) => r.device_seq !== 3);
    const report = verifyChains(H, rows);
    expect(report.breaks).toEqual([
      { device_id: DEV_A, device_seq: 4, reason: 'seq_gap' }, // 행 4의 번호 공백(+ prev 불일치는 한 행에 한 건만 보고)
    ]);
    expect(report.events).toBe(4);
  });

  it('UT-LR-047 기기 독립: 한 기기의 위반이 다른 기기에 번지지 않는다 [FR-PRG-003]', () => {
    const a = chain(DEV_A, 4);
    const b = chain(DEV_B, 4);
    const tampered = a.map((r) => (r.device_seq === 2 ? { ...r, payload: { n: 999 } } : r));
    const report = verifyChains(H, [...tampered, ...b]);
    expect(report.breaks).toEqual([{ device_id: DEV_A, device_seq: 2, reason: 'hash_mismatch' }]);
    expect(Object.keys(report.devices)).toEqual([DEV_A, DEV_B]);
    expect(report.devices[DEV_B]).toEqual({ seq: 4, head_hash: b[3]?.hash });
  });

  it('UT-LR-048 startHeads: 증분 시작점부터 연속성 검사 [FR-PRG-003]', () => {
    const full = chain(DEV_A, 6);
    const tail = full.slice(3);
    const start = { [DEV_A]: { seq: 3, head_hash: full[2]?.hash ?? '' } };
    expect(verifyChains(H, tail, start).breaks).toEqual([]);
    expect(verifyChains(H, tail).breaks[0]?.reason).toBe('seq_gap');
    const wrongStart = { [DEV_A]: { seq: 3, head_hash: 'e'.repeat(64) } };
    expect(verifyChains(H, tail, wrongStart).breaks[0]?.reason).toBe('prev_mismatch');
  });

  it('UT-LR-006 중간 행 변조 → hash_mismatch / (해시 재계산 변조) prev_mismatch [FR-PRG-003]', () => {
    const rows = chain(DEV_A, 10);
    const payloadTamper = rows.map((r) => (r.device_seq === 5 ? { ...r, payload: { n: 'changed' } } : r));
    expect(verifyChains(H, payloadTamper).breaks).toEqual([
      { device_id: DEV_A, device_seq: 5, reason: 'hash_mismatch' },
    ]);

    // 변조자가 그 행의 hash까지 다시 계산하면 다음 행의 prev_hash가 어긋난다.
    const forged = rows.map((r) => {
      if (r.device_seq !== 5) {
        return r;
      }
      const e = { ...r, payload: { n: 'changed' } };
      return { ...e, hash: eventHash(H, e) };
    });
    expect(verifyChains(H, forged).breaks).toEqual([{ device_id: DEV_A, device_seq: 6, reason: 'prev_mismatch' }]);
  });

  it('UT-LR-049 1,000건 정상 체인 0 위반 [FR-PRG-003]', () => {
    const report = verifyChains(H, [...chain(DEV_A, 600), ...chain(DEV_B, 400)]);
    expect(report.events).toBe(1000);
    expect(report.breaks).toEqual([]);
    expect(report.devices[DEV_A]?.seq).toBe(600);
  });
});

describe('앵커', () => {
  const rows = chain(DEV_A, 5);
  const hashAt =
    (list: readonly ChainRow[]) =>
    (device: string, seq: number): string | null =>
      list.find((r) => r.device_id === device && r.device_seq === seq)?.hash ?? null;
  const anchor = { [DEV_A]: { seq: 5, head_hash: rows[4]?.hash ?? '' } };

  it('UT-LR-007 꼬리 변조·절단·기기 누락을 앵커 seq 시점 해시로 탐지 [FR-PRG-003]', () => {
    expect(verifyAnchor(anchor, hashAt(rows))).toEqual([]);
    // 앵커 이후 정상 append는 위반이 아니다(현재 헤드가 아니라 앵커 seq 시점 비교).
    expect(verifyAnchor(anchor, hashAt([...rows, ...chain(DEV_A, 2, 6, rows[4]?.hash)]))).toEqual([]);
    // 마지막 행 재해시 변조(체인은 자기 일관적이라 verifyChains로는 못 잡는다).
    const last = rows[4];
    if (last === undefined) {
      throw new Error('fixture');
    }
    const forgedLast = { ...last, payload: { n: 'tail' } };
    const reHashed = [...rows.slice(0, 4), { ...forgedLast, hash: eventHash(H, forgedLast) }];
    expect(verifyChains(H, reHashed).breaks).toEqual([]);
    expect(verifyAnchor(anchor, hashAt(reHashed))).toEqual([{ device_id: DEV_A, reason: 'head_mismatch' }]);
    // 꼬리 절단
    expect(verifyAnchor(anchor, hashAt(rows.slice(0, 3)))).toEqual([{ device_id: DEV_A, reason: 'truncated' }]);
    // 기기 통째 누락
    expect(verifyAnchor(anchor, hashAt([]))).toEqual([{ device_id: DEV_A, reason: 'device_missing' }]);
  });

  it('UT-LR-007 rootHash = sha256(정준 devices 맵) — 체크포인트·export 헤더·epoch가 같은 verifyAnchor를 쓴다 [FR-PRG-003][FR-SET-022]', () => {
    const headA = { seq: 5, head_hash: 'a'.repeat(64) };
    const headB = { seq: 2, head_hash: 'b'.repeat(64) };
    const devices = { [DEV_B]: headB, [DEV_A]: headA };
    expect(rootHash(H, devices)).toBe(sha256Hex(canonicalJson(devices)));
    // 키 삽입 순서와 무관
    const reversed = { [DEV_A]: headA, [DEV_B]: headB };
    expect(rootHash(H, reversed)).toBe(rootHash(H, devices));
  });
});
