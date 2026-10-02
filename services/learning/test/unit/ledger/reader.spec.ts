import type { LedgerEventEnvelope, LedgerEventType } from '@fathom/contracts/ledger/envelope';
import { CURRENT_SCHEMA_VERSION } from '@fathom/contracts/ledger/versions';
import { readGoldenLedger, readGoldenMeta } from '@fathom/testkit/golden-ledgers/golden-ledgers';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { compareTotalOrder } from '../../../src/domain/ledger/order/total-order.js';
import { UPCASTER_TYPES, upcast } from '../../../src/domain/ledger/upcasters/registry.js';
import { createLedgerReplayReader } from '../../../src/infra/ledger/replay-source.js';
import { fixtureDraft, fixturePayload, LEDGER_TYPES } from '../../contract/ledger/ledger-fixtures.js';
import { envelopeChain } from './support/chains.js';
import { openMigratedDb } from './support/db.js';
import { makeHarness } from './support/harness.js';

const reader = createLedgerReplayReader();

/** 2기기(같은 client_ts 쌍 포함) 체인을 `insertOrder`(도착 순서)로 한 건씩 import한다. 기기 안에서는 항상 seq 순서다. */
async function twoDeviceLedger(insertOrder: 'a-first' | 'b-first' | 'interleaved') {
  const devA = fixedUlid(1);
  const devB = fixedUlid(2);
  const eventsA = envelopeChain(devA, [1_000, 2_000, 3_000, 4_000], 1);
  const eventsB = envelopeChain(devB, [1_000, 2_000, 3_500, 4_000], 2); // 1_000·2_000·4_000이 A와 같다
  const target = await openMigratedDb();
  const t = await makeHarness({ db: target, idStart: 90_000 });
  const order =
    insertOrder === 'a-first'
      ? [...eventsA, ...eventsB]
      : insertOrder === 'b-first'
        ? [...eventsB, ...eventsA]
        : eventsA.flatMap((e, i) => [e, eventsB[i]]).filter((e): e is LedgerEventEnvelope => e !== undefined);
  for (const e of order) {
    const res = target.tx(() => t.writer.importInTx([e]));
    expect(res.ok).toBe(true);
  }
  return { target, eventsA, eventsB };
}

describe('총순서 리더', () => {
  it('UT-LR-005 리더 순서 = (client_ts, device_id, device_seq) — 삽입 순서 무관 [NFR-DATA-011]', async () => {
    const orders = ['a-first', 'b-first'] as const;
    const results: string[][] = [];
    for (const o of orders) {
      const { target } = await twoDeviceLedger(o);
      const ids = [...reader.replay(target)].map((e) => e.event_id);
      results.push(ids);
      const keys = [...reader.replay(target)];
      for (let i = 1; i < keys.length; i += 1) {
        const prev = keys[i - 1];
        const cur = keys[i];
        if (prev !== undefined && cur !== undefined) {
          expect(compareTotalOrder(prev, cur)).toBeLessThanOrEqual(0);
        }
      }
      // 같은 client_ts는 device_id 오름차순으로 풀린다.
      for (const ts of [1_000, 2_000, 4_000]) {
        const tied = keys.filter((e) => e.client_ts === ts);
        expect(tied.map((e) => e.device_id)).toEqual([fixedUlid(1), fixedUlid(2)]); // device_id 오름차순
      }
    }
    expect(results[0]).toEqual(results[1]); // 도착 순서(rowid)가 달라도 같은 재생 순서
  });

  it('UT-LR-055 byCard·byConcept·corrections 모두 같은 총순서 [NFR-DATA-011]', async () => {
    const h = await makeHarness();
    const card = 'k8s.probes:definition:p';
    h.clock.set(10_000);
    h.writer.append(fixtureDraft('card.enrolled'));
    h.clock.set(11_000);
    h.writer.append(fixtureDraft('attempt.graded'));
    h.clock.set(12_000);
    h.writer.append(fixtureDraft('evidence.voided'));
    h.clock.set(13_000);
    h.writer.append(fixtureDraft('evidence.weight_adjusted'));
    h.clock.set(14_000);
    h.writer.append(fixtureDraft('lesson.completed'));

    const byCard = [...reader.byCard(h.db, card)];
    expect(byCard.map((e) => e.type)).toEqual(['card.enrolled', 'attempt.graded']);
    const byConcept = [...reader.byConcept(h.db, 'k8s.probes')];
    expect(byConcept.map((e) => e.type)).toEqual(['card.enrolled', 'attempt.graded']);
    const lesson = [...reader.byConcept(h.db, 'lang.js-event-loop')];
    expect(lesson.map((e) => e.type)).toEqual(['lesson.completed']);
    const corrections = [...reader.corrections(h.db)];
    expect(corrections.map((e) => e.type)).toEqual(['evidence.voided', 'evidence.weight_adjusted']);
    for (const list of [byCard, byConcept, corrections]) {
      for (let i = 1; i < list.length; i += 1) {
        const prev = list[i - 1];
        const cur = list[i];
        if (prev !== undefined && cur !== undefined) {
          expect(compareTotalOrder(prev, cur)).toBeLessThan(0);
        }
      }
    }
  });

  it('UT-LR-056 sinceRowid는 도착(rowid) 순, 리플레이 순서가 아니다 [NFR-DATA-011]', async () => {
    const { target } = await twoDeviceLedger('b-first');
    const all = [...reader.sinceRowid(target, 0)];
    const replay = [...reader.replay(target)];
    expect(all).toHaveLength(replay.length);
    expect(all.map((e) => e.event_id)).not.toEqual(replay.map((e) => e.event_id));
    // 도착 순서 = B 이벤트 먼저(삽입 순서)
    expect(all.slice(0, 4).every((e) => e.device_id === fixedUlid(2))).toBe(true);
    const cursor = reader.maxRowid(target);
    expect(cursor).toBe(all.length);
    expect([...reader.sinceRowid(target, cursor)]).toEqual([]);
    expect([...reader.sinceRowid(target, cursor - 2)]).toHaveLength(2);
  });

  it('UT-LR-057 maxRowid: 빈 원장 0 [NFR-DATA-011]', async () => {
    const db = await openMigratedDb();
    expect(reader.maxRowid(db)).toBe(0);
    expect([...reader.replay(db)]).toEqual([]);
    const h = await makeHarness({ db });
    h.writer.append(fixtureDraft('card.enrolled'));
    expect(reader.maxRowid(db)).toBe(2);
  });
});

describe('upcaster', () => {
  it('UT-LR-008 v1 항등 17종 — payload 불변 + 골든 ledger_sha256 불변 [NFR-DATA-003]', () => {
    for (const type of LEDGER_TYPES) {
      const payload = fixturePayload(type);
      const res = upcast(type, 1, payload);
      expect(res.ok, type).toBe(true);
      if (res.ok) {
        expect(res.value.schema_version).toBe(1);
        expect(res.value.payload).toBe(payload); // 같은 객체(항등)
      }
    }
    // 골든 3세트의 파일 해시가 meta와 같다 — 읽기 경로(upcast)는 저장 바이트를 바꾸지 않는다.
    for (const set of ['basic', 'two-device', 'corrections'] as const) {
      const ledger = readGoldenLedger(set);
      const meta = readGoldenMeta(set);
      expect(ledger.events).toHaveLength(meta.events);
      const hashes = ledger.events.map((e) => {
        const up = upcast(e.type, e.schema_version, e.payload);
        return up.ok ? up.value.payload === e.payload : false;
      });
      expect(hashes.every(Boolean)).toBe(true);
    }
  });

  it('UT-LR-058 범위 밖 버전(0·현재+1·비정수) = schema_version_unsupported [NFR-DATA-003]', () => {
    for (const bad of [0, 2, -1, 1.5, Number.NaN]) {
      const res = upcast('attempt.graded', bad, {});
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error.kind).toBe('schema_version_unsupported');
    }
  });

  it('UT-LR-059 upcaster 표 완전성: 17종 전부 + CURRENT_SCHEMA_VERSION과 같은 키 [NFR-DATA-003]', () => {
    expect([...UPCASTER_TYPES].sort()).toEqual([...LEDGER_TYPES].sort());
    expect(Object.keys(CURRENT_SCHEMA_VERSION).sort()).toEqual([...LEDGER_TYPES].sort());
    expect(LEDGER_TYPES).toHaveLength(17);
  });

  it('UT-LR-060 리더는 upcast·검증 실패 행에서 invariant throw [NFR-DATA-003]', async () => {
    const h = await makeHarness();
    h.writer.append(fixtureDraft('card.enrolled'));
    // 미래 버전 스탬프(실제 원장 손상 모사): 트리거를 잠시 풀고 행을 변조한다 — 테스트 전용.
    h.db.exec('DROP TRIGGER lr_event_no_update');
    h.db.exec("UPDATE lr_event SET schema_version = 9 WHERE type = 'card.enrolled'");
    expect(() => [...reader.replay(h.db)]).toThrow(/invariant: ledger row unreadable .*type=card\.enrolled/);

    h.db.exec(
      'UPDATE lr_event SET schema_version = 1, payload = \'{"card_id":"secret-value"}\' WHERE type = \'card.enrolled\'',
    );
    let message = '';
    try {
      [...reader.replay(h.db)];
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }
    expect(message).toContain('invalid at');
    expect(message).not.toContain('secret-value'); // 값은 오류 문장에 없다(STD-LOG-22)
    h.db.exec("UPDATE lr_event SET payload = '[1]' WHERE type = 'card.enrolled'");
    expect(() => [...reader.replay(h.db)]).toThrow(/payload is not an object/);
  });

  it('UT-LR-060 정상 행: 모든 메서드가 최신 버전 envelope(LedgerEventEnvelope 검증 통과)를 낸다 [NFR-DATA-003]', async () => {
    const h = await makeHarness();
    for (const type of LEDGER_TYPES) {
      h.clock.set(1_000_000 + LEDGER_TYPES.indexOf(type));
      expect(h.writer.append(fixtureDraft(type)).ok, type).toBe(true);
    }
    const events = [...reader.replay(h.db)];
    expect(events).toHaveLength(17); // 초기 policy.switched + 16종(policy.switched 표본은 같은 키 = duplicate)
    const types = new Set<LedgerEventType>(events.map((e) => e.type));
    expect(types.size).toBe(17);
    for (const e of events) {
      expect(e.schema_version).toBe(1);
    }
  });
});
