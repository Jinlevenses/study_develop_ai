import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import { createPrng } from '@fathom/testkit/prng';
import { describe, expect, it } from 'vitest';
import { DEV_A, DEV_B, EventFactory, T0 } from '../../unit/learner-model/support/events.js';
import { generateLedger } from '../../unit/learner-model/support/generator.js';
import { MemoryResolver, runIncremental, runReplay, sliceHash } from '../../unit/learner-model/support/memory.js';
import { makeParams, REPO_PARAMS } from '../../unit/learner-model/support/policy.js';

// 속성 테스트(STD-TST-03: 고정 시드). 라이브 증분 투영 = 원장만 전체 리플레이한 투영, 도착 순서 무관, 정정 경로 결정성.

const ALT_PARAMS = makeParams({ fsrs: (f) => ({ ...f, request_retention: { ...f.request_retention, B: 0.8 } }) });
const resolver = new MemoryResolver([REPO_PARAMS, ALT_PARAMS]);
const POLICY_SETS = [REPO_PARAMS.policy_version, ALT_PARAMS.policy_version] as const;

const TARGET_KEYS = [
  'evidence.voided',
  'evidence.weight_adjusted',
  'evidence.upgraded',
  'evidence.regraded',
] as const satisfies readonly LedgerEventEnvelope['type'][];

function isCorrection(e: LedgerEventEnvelope): boolean {
  return (TARGET_KEYS as readonly string[]).includes(e.type);
}
/** 정정이 가리키는 event_id들(void·weight = target_event_ids, upgraded·regraded = supersedes_event_id). */
function targetsOf(e: LedgerEventEnvelope): string[] {
  const t = e.payload.target_event_ids;
  if (Array.isArray(t)) {
    return t.filter((x): x is string => typeof x === 'string');
  }
  const s = e.payload.supersedes_event_id;
  return typeof s === 'string' ? [s] : [];
}

describe('learner-model 리플레이 속성 — 증분 = 전체 리플레이', () => {
  it('UT-LR-500 무작위 이벤트열 1,000 시드(시드당 40~120건, 2기기, 정책 세트 2종): applyIncremental(도착 순서) = 전체 리플레이 [NFR-DATA-002]', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const events = generateLedger(seed, { policySets: POLICY_SETS, chainTargets: true });
      const incremental = runIncremental(events, resolver).slice;
      const replay = runReplay(events, resolver);
      if (sliceHash(incremental) !== sliceHash(replay)) {
        throw new Error(`seed ${seed}: incremental != replay (${events.length} events)`);
      }
    }
  }, 300_000);

  it('UT-LR-501 두 기기 병합: 100 순열의 도착 순서 → 리플레이 해시 동일 [NFR-DATA-011]', () => {
    for (const seed of [11, 12, 13]) {
      const events = generateLedger(seed, { min: 60, max: 100, policySets: POLICY_SETS });
      expect(new Set(events.map((e) => e.device_id)).size).toBe(2);
      const expected = sliceHash(runReplay(events, resolver));
      const rng = createPrng(seed * 7);
      for (let i = 0; i < 100; i += 1) {
        expect(sliceHash(runReplay(rng.shuffle(events), resolver))).toBe(expected);
      }
    }
  }, 120_000);

  it('UT-LR-502 정정 경로: append(correction) 증분 = 전체 리플레이, 다른 기기 정정을 포함한 병합 = 전체 리플레이 [NFR-DATA-011]', () => {
    let withCorrections = 0;
    for (let seed = 2000; seed < 2300; seed += 1) {
      const events = generateLedger(seed, { min: 50, max: 120, policySets: POLICY_SETS, chainTargets: true });
      const corrections = events.filter(isCorrection);
      withCorrections += corrections.length > 0 ? 1 : 0;
      // (a) 정정이 생성 순서대로 append되는 증분
      expect(sliceHash(runIncremental(events, resolver).slice), `seed ${seed} (a)`).toBe(
        sliceHash(runReplay(events, resolver)),
      );
      // (b) 병합 도착: A 기기 먼저, 그다음 B 기기(A의 정정 중 B 이벤트를 가리키는 것은 B 뒤로) — 증분이 전체 리플레이와 같다
      const byId = new Map(events.map((e) => [e.event_id, e]));
      const deferred = (e: LedgerEventEnvelope): boolean =>
        e.device_id === DEV_A && isCorrection(e) && targetsOf(e).some((t) => byId.get(t)?.device_id === DEV_B);
      const aFirst = events.filter((e) => e.device_id === DEV_A && !deferred(e));
      const b = events.filter((e) => e.device_id === DEV_B);
      const late = events.filter(deferred);
      const merged = [...aFirst, ...b, ...late];
      expect(merged).toHaveLength(events.length);
      // B 정정이 A 정정을 가리키는 사슬은 A(late) 뒤에 와야 하므로 목표가 존재하는지 확인해 존재하지 않으면 건너뛴다
      const seen = new Set<string>();
      const orderable = merged.every((e) => {
        const ok = !isCorrection(e) || targetsOf(e).every((t) => seen.has(t));
        seen.add(e.event_id);
        return ok;
      });
      if (orderable) {
        expect(sliceHash(runIncremental(merged, resolver).slice), `seed ${seed} (b)`).toBe(
          sliceHash(runReplay(events, resolver)),
        );
      }
      // (c) 병합 결과(리플레이) = 도착 순서 무관
      expect(sliceHash(runReplay(merged, resolver))).toBe(sliceHash(runReplay(events, resolver)));
    }
    expect(withCorrections).toBeGreaterThan(250);
  }, 300_000);

  it('UT-LR-510 같은 입력 2회 → 바이트 동일 slice [NFR-DATA-002]', () => {
    for (const seed of [21, 22, 23, 24, 25]) {
      const events = generateLedger(seed, { policySets: POLICY_SETS });
      const a = canonicalJson(runReplay(events, resolver));
      const b = canonicalJson(runReplay(events, resolver));
      expect(a).toBe(b);
      expect(canonicalJson(runIncremental(events, resolver).slice)).toBe(a);
    }
  });

  it('UT-LR-511 같은 client_ts의 다른 기기 이벤트 → 총순서(device_id) 고정 [NFR-DATA-011]', () => {
    const f = new EventFactory();
    const enrolled = f.enrolled({ ts: T0 });
    const a = f.graded({ ts: T0 + 1000, device: DEV_A }, { result: 'correct', rating: 4, item_beta: 0.2 });
    const b = f.graded({ ts: T0 + 1000, device: DEV_B }, { result: 'incorrect', rating: 1, item_beta: -0.3 });
    const forward = runReplay([enrolled, a, b], resolver);
    expect(sliceHash(runReplay([b, a, enrolled], resolver))).toBe(sliceHash(forward));
    // device_id 오름차순(A → B)으로 접은 결과 = 손으로 접은 같은 이벤트열
    const manual = runReplay(
      [enrolled, { ...a, client_ts: T0 + 1000 }, { ...b, client_ts: T0 + 1001 }].map((e, i) =>
        i === 2 ? { ...e, device_id: DEV_B } : e,
      ),
      resolver,
    );
    expect(forward.cards['k8s.probes:concept:p']?.state).toEqual(manual.cards['k8s.probes:concept:p']?.state);
    expect(forward.concepts['k8s.probes']?.state.theta).toBe(manual.concepts['k8s.probes']?.state.theta);
    // 도착 순서가 달라도 증분 결과 = 리플레이
    expect(sliceHash(runIncremental([enrolled, b, a], resolver).slice)).toBe(sliceHash(forward));
    expect(sliceHash(runIncremental([enrolled, a, b], resolver).slice)).toBe(sliceHash(forward));
  });

  it('UT-LR-512 지각 도착 무작위 삽입 = 리플레이 [NFR-DATA-011]', () => {
    for (let seed = 3000; seed < 3100; seed += 1) {
      const events = generateLedger(seed, { min: 50, max: 100, policySets: POLICY_SETS, chainTargets: true });
      const referenced = new Set(events.filter(isCorrection).flatMap(targetsOf));
      const rng = createPrng(seed);
      // 정정 대상이 아닌 이벤트 일부를 뒤로 미뤄(지각 도착) 임의 위치에 끼워 넣는다 — 정정은 항상 대상 뒤에 도착.
      // card.enrolled는 미루지 않는다: 로컬 append에서 카드의 첫 이벤트이고, 등록 전 도착(병합)은 job 경로(merge → rebuild)가 전체 리플레이한다.
      const movable = events.filter(
        (e) =>
          !referenced.has(e.event_id) && !isCorrection(e) && e.type !== 'policy.switched' && e.type !== 'card.enrolled',
      );
      const moved = new Set(movable.filter(() => rng.next() < 0.3).map((e) => e.event_id));
      const arrival = events.filter((e) => !moved.has(e.event_id));
      for (const e of events.filter((x) => moved.has(x.event_id))) {
        arrival.splice(rng.int(Math.min(4, arrival.length), arrival.length), 0, e);
      }
      expect(arrival).toHaveLength(events.length);
      expect(sliceHash(runIncremental(arrival, resolver).slice), `seed ${seed}`).toBe(
        sliceHash(runReplay(events, resolver)),
      );
    }
  }, 300_000);
});
