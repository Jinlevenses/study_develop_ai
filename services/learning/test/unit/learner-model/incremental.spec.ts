import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { describe, expect, it } from 'vitest';
import {
  affectedKeys,
  applyIncremental,
  type IncrementalDeps,
  planIncremental,
} from '../../../src/application/learner-model/incremental.js';
import { DAY, DEV_A, DEV_B, EventFactory, T0 } from './support/events.js';
import {
  FAKE_DB,
  MemoryLedger,
  MemoryResolver,
  MemoryStore,
  runIncremental,
  runReplay,
  sliceHash,
} from './support/memory.js';
import { REPO_PARAMS } from './support/policy.js';

const resolver = new MemoryResolver([REPO_PARAMS]);
const CARD = 'k8s.probes:concept:p';

function deps(ledger: MemoryLedger, store: MemoryStore): IncrementalDeps {
  return { db: FAKE_DB, source: ledger, targets: ledger, store, params: resolver };
}

/** 이벤트를 원장에 넣고 증분 적용하면서 각 이벤트의 경로 판정을 모은다. */
function plansOf(events: readonly LedgerEventEnvelope[]): string[] {
  const ledger = new MemoryLedger();
  const store = new MemoryStore();
  const d = deps(ledger, store);
  const paths: string[] = [];
  for (const e of events) {
    ledger.append(e);
    paths.push(e.type === 'policy.switched' ? 'none' : planIncremental(d, e).path);
    // 판정 후 같은 이벤트를 적용해 저장소 상태를 다음 판정에 넘긴다
    runOne(d, e);
  }
  return paths;
}

function runOne(d: IncrementalDeps, e: LedgerEventEnvelope): void {
  applyIncremental(d, e);
}

describe('learner-model 증분 적용 — fast path · 키 재도출', () => {
  it('UT-LR-150 영향 키·fast/slow 판정 표 [NFR-DATA-002]', () => {
    const f = new EventFactory();
    const enrolled = f.enrolled({ ts: T0 });
    const g1 = f.graded({ ts: T0 + 1000 }, { rating: 3, fsrs_at: T0 + 1000 });
    // 후행 이벤트 = fast, 동률(client_ts)·지각(client_ts <)·fsrs_at 역행 = slow
    const gTie = f.graded({ ts: T0 + 1000, device: DEV_B }, { rating: 3 });
    const gLate = f.graded({ ts: T0 + 500, device: DEV_B }, { rating: 3 });
    const gOk = f.graded({ ts: T0 + 2000 }, { rating: 3, fsrs_at: T0 + 2000 });
    const gFsrsBack = f.graded({ ts: T0 + 3000 }, { rating: 3, fsrs_at: T0 + 2000 }); // fsrs_at == last_fsrs_at
    const status = f.statusChanged({ ts: T0 + 4000 }, CARD, 'suspended');
    const statusLate = f.statusChanged({ ts: T0 + 100, device: DEV_B }, CARD, 'active');
    const voided = f.voided({ ts: T0 + 5000 }, [g1.event_id]);
    const weight = f.weightAdjusted({ ts: T0 + 6000 }, [g1.event_id], { kind: 'factor', factor: 0.5 });
    const upgraded = f.upgraded({ ts: T0 + 7000 }, g1.event_id, {});
    const regraded = f.regraded({ ts: T0 + 8000 }, upgraded.event_id, {});
    const switched = f.policySwitched({ ts: T0 + 9000 });
    const paths = plansOf([
      enrolled,
      g1,
      gTie,
      gLate,
      gOk,
      gFsrsBack,
      status,
      statusLate,
      voided,
      weight,
      upgraded,
      regraded,
      switched,
    ]);
    expect(paths).toEqual([
      'fast', // enrolled(새 카드)
      'fast', // g1
      'slow', // 동률 client_ts(카드 last_ts == client_ts)
      'slow', // 지각 도착
      'fast', // gOk
      'slow', // fsrs_at == last_fsrs_at(엄격 비교 탈락)
      'fast', // status_changed 후행
      'slow', // status_changed 지각
      'slow', // voided
      'slow', // weight_adjusted
      'slow', // upgraded
      'slow', // regraded
      'none', // policy.switched
    ]);
    // 영향 키: payload 또는 대상 이벤트의 STORED 키
    const ledger = new MemoryLedger();
    for (const e of [enrolled, g1, voided, weight, upgraded, regraded, status]) {
      ledger.append(e);
    }
    const keysDeps = { db: FAKE_DB, targets: ledger };
    expect(affectedKeys(keysDeps, g1)).toEqual({ card_ids: [CARD], concept_ids: ['k8s.probes'] });
    expect(affectedKeys(keysDeps, status)).toEqual({ card_ids: [CARD], concept_ids: [] });
    expect(affectedKeys(keysDeps, voided)).toEqual({ card_ids: [CARD], concept_ids: ['k8s.probes'] });
    expect(affectedKeys(keysDeps, weight)).toEqual({ card_ids: [CARD], concept_ids: ['k8s.probes'] });
    expect(affectedKeys(keysDeps, upgraded)).toEqual({ card_ids: [CARD], concept_ids: ['k8s.probes'] });
    expect(affectedKeys(keysDeps, switched)).toBeNull();
  });

  it('UT-LR-151 fast path 결과 = 전체 fold(단일 기기·순증가 client_ts) [NFR-DATA-002]', () => {
    const f = new EventFactory();
    const events: LedgerEventEnvelope[] = [f.enrolled({ ts: T0 }), f.enrolled({ ts: T0 + 1 }, { facet: 'code' })];
    for (let i = 1; i <= 30; i += 1) {
      events.push(
        f.graded(
          { ts: T0 + i * DAY },
          {
            rating: i % 4 === 0 ? 1 : 3,
            result: i % 5 === 0 ? 'incorrect' : 'correct',
            facet: i % 2 === 0 ? 'code' : 'concept',
          },
        ),
      );
    }
    expect(plansOf(events).every((p) => p === 'fast')).toBe(true);
    const { slice } = runIncremental(events, resolver);
    expect(sliceHash(slice)).toBe(sliceHash(runReplay(events, resolver)));
  });

  it('UT-LR-152 지각 도착(client_ts ≤ last_ts) → 키 재도출 = fold [NFR-DATA-011]', () => {
    const f = new EventFactory();
    const events = [
      f.enrolled({ ts: T0 }),
      f.graded({ ts: T0 + 3000 }, { rating: 3, result: 'incorrect' }),
      f.graded({ ts: T0 + 1000, device: DEV_B }, { rating: 4, result: 'correct' }), // 지각
      f.graded({ ts: T0 + 3000, device: DEV_B }, { rating: 2, result: 'partial' }), // 동률(device_id 순서: A < B)
      f.graded({ ts: T0 + 500, device: DEV_B }, { rating: 3, result: 'correct', item_n_options: 4 }),
    ];
    const { slice } = runIncremental(events, resolver);
    expect(sliceHash(slice)).toBe(sliceHash(runReplay(events, resolver)));
    // 총순서(client_ts, device_id, device_seq)대로 접힌 마지막 last_ts
    expect(slice.cards[CARD]?.last_ts).toBe(T0 + 3000);
    expect(DEV_A < DEV_B).toBe(true);
  });

  it('UT-LR-157 효과 없는 9종 이벤트 → store 쓰기 0 [NFR-DATA-002]', () => {
    const f = new EventFactory();
    const noEffect = [
      'pretest.answered',
      'lesson.completed',
      'self_assessment.recorded',
      'profile.setting_changed',
      'ai_mode.observed',
      'declaration.sealed',
      'promotion.exam_completed',
      'level.promoted',
      'level.provisional_resolved',
    ] as const;
    const ledger = new MemoryLedger();
    const store = new MemoryStore();
    for (const [i, type] of noEffect.entries()) {
      const e = f.envelope(type, { ts: T0 + i }, { card_id: CARD, concept_id: 'k8s.probes' });
      ledger.append(e);
      expect(planIncremental(deps(ledger, store), e).path).toBe('none');
      applyOne(ledger, store, e);
    }
    expect(store.puts).toBe(0);
    expect(store.toSlice()).toEqual({ cards: {}, concepts: {} });
    // policy.switched: 투영 쓰기 0, resolver 등록만
    const sw = f.policySwitched({ ts: T0 + 100 });
    ledger.append(sw);
    applyOne(ledger, store, sw);
    expect(store.puts).toBe(0);
    expect(resolver.registered.at(-1)?.policyVersion).toBe(sw.payload.policy_version);
  });
});

describe('learner-model 증분 적용 — 사슬 구성원 정정 · 지각 card.status_changed', () => {
  it('UT-LR-516 upgraded/regraded를 가리키는 void·weight_adjust + 지각 status_changed → 증분 = 리플레이 [NFR-DATA-002]', () => {
    const scenarios: readonly (readonly [string, (f: EventFactory, chainId: string) => LedgerEventEnvelope])[] = [
      ['void', (f, id) => f.voided({ ts: T0 + 3000 }, [id])],
      ['weight_adjust', (f, id) => f.weightAdjusted({ ts: T0 + 3000 }, [id], { kind: 'factor', factor: 0 })],
    ];
    for (const [name, correct] of scenarios) {
      for (const chain of ['upgraded', 'regraded'] as const) {
        const f = new EventFactory();
        const enrolled = f.enrolled({ ts: T0 });
        const graded = f.graded({ ts: T0 + 1000 }, { rating: 4, result: 'correct' });
        const link = f[chain]({ ts: T0 + 2000 }, graded.event_id, { result: 'correct' });
        const correction = correct(f, link.event_id);
        // 마지막에 도착하는 지각 card.status_changed(concept_id 없음 → concept_ids = []) = slow path
        const lateStatus = f.statusChanged({ ts: T0 + 500, device: DEV_B }, CARD, 'active');
        const events = [enrolled, graded, link, correction, lateStatus];
        const label = `${name}/${chain}`;
        const { slice, ledger, store } = runIncremental(events, resolver);
        expect(planIncremental(deps(ledger, store), lateStatus).path, label).toBe('slow');
        expect(sliceHash(slice), label).toBe(sliceHash(runReplay(events, resolver)));
      }
    }
  });

  it('UT-LR-517 void가 사슬 구성원을 가리키면 root attempt.graded의 rating이 FSRS에 적용되지 않는다 [NFR-DATA-002]', () => {
    const f = new EventFactory();
    const events = [f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1000 }, { rating: 4 })];
    const upgraded = f.upgraded({ ts: T0 + 2000 }, events[1]?.event_id ?? '', {});
    const voided = f.voided({ ts: T0 + 3000 }, [upgraded.event_id]);
    const late = f.statusChanged({ ts: T0 + 500, device: DEV_B }, CARD, 'active');
    const all = [...events, upgraded, voided, late];
    const { slice } = runIncremental(all, resolver);
    expect(slice.cards[CARD]?.state.reps).toBe(0);
    expect(sliceHash(slice)).toBe(sliceHash(runReplay(all, resolver)));
  });
});

function applyOne(ledger: MemoryLedger, store: MemoryStore, e: LedgerEventEnvelope): void {
  applyIncremental(deps(ledger, store), e);
}
