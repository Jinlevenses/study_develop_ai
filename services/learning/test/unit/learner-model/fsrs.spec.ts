import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { createEmptyCard, fsrs, generatorParameters, Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { buildProjectorParams, fsrsNow, newCardState } from '../../../src/domain/learner-model/fsrs/core.js';
import { fsrsRating } from '../../../src/domain/learner-model/fsrs/grade.js';
import { apply, foldEvents } from '../../../src/domain/learner-model/projector/apply.js';
import { EMPTY_CORRECTIONS } from '../../../src/domain/learner-model/projector/corrections.js';
import type { CardState, ProjectionSlice } from '../../../src/domain/learner-model/projector/types.js';
import { EMPTY_SLICE } from '../../../src/domain/learner-model/projector/types.js';
import { CardStateSchema } from '../../../src/infra/db/learner-model-state-schema.js';
import { DAY, EventFactory, T0 } from './support/events.js';
import { FAKE_DB, MemoryResolver } from './support/memory.js';
import { FSRS, GAMING, MASTERY, makeParams, REPO_PARAMS, REPO_PS, REPO_ROOT } from './support/policy.js';

const CARD = 'k8s.probes:concept:p';
const resolver = new MemoryResolver([REPO_PARAMS]);

function fold(events: readonly LedgerEventEnvelope[], r = resolver): ProjectionSlice {
  return foldEvents(events, (ps) => r.resolve(FAKE_DB, ps));
}
function cardOf(slice: ProjectionSlice, id = CARD) {
  const row = slice.cards[id];
  if (row === undefined) {
    throw new Error(`card ${id} missing`);
  }
  return row;
}

describe('learner-model FSRS 투영 — ts-fsrs 5.4.2 · 파라미터 · 카드 키', () => {
  it('UT-LR-100 ts-fsrs 5.4.2 next, fuzz off, 숫자 ms 입·출력(상태에 Date 0) [FR-PRG-005]', () => {
    // Arrange: 설치된 ts-fsrs 버전 고정 + 직접 호출한 기대값
    const installed = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'services/learning/node_modules/ts-fsrs/package.json'), 'utf8'),
    ) as { version: string };
    expect(installed.version).toBe('5.4.2');
    const f = new EventFactory();
    const reviewAt = T0 + 3 * DAY;
    const slice = fold([f.enrolled({ ts: T0 }), f.graded({ ts: reviewAt }, { rating: 3 })]);
    // Act: 같은 입력을 ts-fsrs로 직접
    const direct = fsrs(
      generatorParameters({
        w: [...FSRS.w],
        enable_fuzz: false,
        enable_short_term: FSRS.enable_short_term,
        request_retention: FSRS.request_retention.A,
      }),
    ).next(createEmptyCard(T0), reviewAt, Rating.Good).card;
    // Assert
    const state = cardOf(slice).state;
    expect(state.due).toBe(direct.due.getTime());
    expect(state.stability).toBe(direct.stability);
    expect(state.difficulty).toBe(direct.difficulty);
    expect(state.scheduled_days).toBe(direct.scheduled_days);
    expect(state.last_review).toBe(reviewAt);
    for (const v of Object.values(state)) {
      expect(typeof v === 'number' || typeof v === 'boolean' || v === null).toBe(true); // Date·객체 0
    }
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(REPO_PARAMS.fsrs_impl).toBe('ts-fsrs@5.4.2');
    expect(FSRS.enable_fuzz).toBe(false);
  });

  it('UT-LR-101 파라미터는 이벤트 policy_version 세트에서만 — ps만 바꾸면 결과가 바뀌고 현재 설정은 무영향 [FR-CUR-017][NFR-DATA-002]', () => {
    // Arrange: A = 레포 값, B = 보존율 A계층 0.80
    const paramsB = makeParams({ fsrs: (f) => ({ ...f, request_retention: { ...f.request_retention, A: 0.8 } }) });
    expect(paramsB.policy_version).not.toBe(REPO_PS);
    const history = (ps: string): LedgerEventEnvelope[] => {
      const f = new EventFactory();
      return [
        f.enrolled({ ts: T0 }, { policy_version: ps }),
        f.graded({ ts: T0 + DAY }, { policy_version: ps, rating: 3 }),
        f.graded({ ts: T0 + 5 * DAY }, { policy_version: ps, rating: 3 }),
        f.graded({ ts: T0 + 20 * DAY }, { policy_version: ps, rating: 3 }),
      ];
    };
    const both = new MemoryResolver([REPO_PARAMS, paramsB]);
    // Act
    const a = fold(history(REPO_PS), both);
    const b = fold(history(paramsB.policy_version), both);
    const aWithOnlyA = fold(history(REPO_PS), new MemoryResolver([REPO_PARAMS]));
    // Assert: 같은 이벤트열, ps만 다르면 일정이 달라진다(낮은 보존율 → 더 긴 간격)
    expect(cardOf(b).state.scheduled_days).toBeGreaterThan(cardOf(a).state.scheduled_days);
    // 다른 세트가 해석기에 더 등록돼도 A 이벤트의 결과는 같다
    expect(a).toEqual(aWithOnlyA);
  });

  it('UT-LR-159 이벤트 ps와 다른 파라미터를 넘기면 결함으로 던진다 [NFR-DATA-002]', () => {
    const f = new EventFactory();
    const other = makeParams({ fsrs: (x) => ({ ...x, enable_short_term: false }) });
    expect(() => apply(EMPTY_SLICE, f.enrolled({ ts: T0 }), other, EMPTY_CORRECTIONS)).toThrow(
      /invariant: projector params/,
    );
    expect(() => apply(EMPTY_SLICE, f.enrolled({ ts: T0 }), null, EMPTY_CORRECTIONS)).toThrow(/params required/);
  });

  it('UT-LR-102 fsrsRating: recognition ≤ 3, 힌트 1 → ≤ 3 · 2 → ≤ 2, rapid → ≤ grade_cap, pending → null [FR-PRG-007][FR-QST-025]', () => {
    const base = {
      result: 'correct',
      pending: false,
      recommended_grade: 4,
      response_mode: 'production',
      rapid: false,
      hints_used: 0,
    } as const;
    expect(fsrsRating(base, GAMING)).toBe(4);
    expect(fsrsRating({ ...base, response_mode: 'recognition' }, GAMING)).toBe(3);
    expect(fsrsRating({ ...base, hints_used: 1 }, GAMING)).toBe(3);
    expect(fsrsRating({ ...base, hints_used: 2 }, GAMING)).toBe(2);
    expect(fsrsRating({ ...base, hints_used: 5 }, GAMING)).toBe(2);
    expect(GAMING.rapid.grade_cap).toBe(2);
    expect(fsrsRating({ ...base, rapid: true }, GAMING)).toBe(2);
    expect(fsrsRating({ ...base, rapid: true }, { ...GAMING, rapid: { ...GAMING.rapid, grade_cap: 1 } })).toBe(1);
    expect(fsrsRating({ ...base, recommended_grade: 1, hints_used: 1 }, GAMING)).toBe(1);
    expect(fsrsRating({ ...base, pending: true }, GAMING)).toBeNull();
    expect(fsrsRating({ ...base, result: 'pending' }, GAMING)).toBeNull();
  });

  it('UT-LR-103 카드 키 = (concept, facet, response_mode), 같은 개념 r·p 카드는 독립 [FR-PRG-004]', () => {
    const f = new EventFactory();
    const slice = fold([
      f.enrolled({ ts: T0 }, { response_mode: 'production' }),
      f.enrolled({ ts: T0 + 1 }, { response_mode: 'recognition' }),
      f.enrolled({ ts: T0 + 2 }, { facet: 'code', response_mode: 'production' }),
      f.graded({ ts: T0 + DAY }, { rating: 4, response_mode: 'production' }),
    ]);
    expect(Object.keys(slice.cards).sort()).toEqual([
      'k8s.probes:code:p',
      'k8s.probes:concept:p',
      'k8s.probes:concept:r',
    ]);
    expect(cardOf(slice, 'k8s.probes:concept:p').state.reps).toBe(1);
    expect(cardOf(slice, 'k8s.probes:concept:r').state.reps).toBe(0);
    expect(cardOf(slice, 'k8s.probes:code:p').state.reps).toBe(0);
    expect(Object.keys(slice.concepts)).toEqual(['k8s.probes']); // 개념 행은 카드 수와 무관하게 1개
    expect(cardOf(slice, 'k8s.probes:concept:r').response_mode).toBe('recognition');
  });
});

describe('learner-model FSRS 카드 상태 전이', () => {
  it('UT-LR-120 card.enrolled 초기 상태(due = client_ts, 키 12개, status active) [FR-PRG-004]', () => {
    const f = new EventFactory();
    const slice = fold([f.enrolled({ ts: T0 }, { tier: 'B', facet: 'concept', response_mode: 'production' })]);
    const row = cardOf(slice);
    expect(row).toMatchObject({
      card_id: CARD,
      concept_id: 'k8s.probes',
      facet: 'concept',
      response_mode: 'production',
      tier: 'B',
      status: 'active',
      last_ts: T0,
    });
    expect(row.state).toEqual({
      due: T0,
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      state: 0,
      last_review: null,
      last_fsrs_at: null,
      leech: false,
    });
    expect(Object.keys(row.state)).toHaveLength(12);
    expect(newCardState(T0)).toEqual(row.state);
    // 다시 enrolled → last_ts만 갱신(상태·tier 유지)
    const again = apply(slice, f.enrolled({ ts: T0 + 5 }, { tier: 'C' }), REPO_PARAMS, EMPTY_CORRECTIONS);
    expect(cardOf(again)).toEqual({ ...row, last_ts: T0 + 5 });
  });

  it('UT-LR-121 tier A·B·C → retention .92·.90·.85(CO-18 잠정)로 같은 이력의 scheduled_days 차이 [FR-PRG-005]', () => {
    expect(FSRS.request_retention).toMatchObject({ A: 0.92, B: 0.9, C: 0.85 });
    const days = (tier: 'A' | 'B' | 'C'): number => {
      const f = new EventFactory();
      const events: LedgerEventEnvelope[] = [f.enrolled({ ts: T0 }, { tier })];
      for (let i = 1; i <= 6; i += 1) {
        events.push(f.graded({ ts: T0 + i * 10 * DAY }, { tier, rating: 3 }));
      }
      return cardOf(fold(events)).state.scheduled_days;
    };
    const [a, b, c] = [days('A'), days('B'), days('C')];
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('UT-LR-122 rating null·pending → FSRS 불변, last_ts만 갱신 [FR-PRG-005]', () => {
    const f = new EventFactory();
    const before = fold([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + DAY }, { rating: 3 })]);
    const prior = cardOf(before);
    const nullRating = apply(
      before,
      f.graded({ ts: T0 + 2 * DAY }, { rating: null, result: 'correct' }),
      REPO_PARAMS,
      EMPTY_CORRECTIONS,
    );
    const pending = apply(
      before,
      f.graded({ ts: T0 + 3 * DAY }, { result: 'pending', rating: 3 }),
      REPO_PARAMS,
      EMPTY_CORRECTIONS,
    );
    expect(cardOf(nullRating).state).toEqual(prior.state);
    expect(cardOf(nullRating).last_ts).toBe(T0 + 2 * DAY);
    expect(cardOf(pending).state).toEqual(prior.state);
    expect(cardOf(pending).last_ts).toBe(T0 + 3 * DAY);
  });

  it('UT-LR-123 suspended·retired 카드는 FSRS 불변, active 복귀 후 재개 [FR-PRG-004]', () => {
    for (const status of ['suspended', 'retired'] as const) {
      const f = new EventFactory();
      const events = [
        f.enrolled({ ts: T0 }),
        f.graded({ ts: T0 + DAY }, { rating: 3 }),
        f.statusChanged({ ts: T0 + 2 * DAY }, CARD, status),
        f.graded({ ts: T0 + 3 * DAY }, { rating: 3 }),
      ];
      const held = fold(events);
      const afterFirst = fold(events.slice(0, 2));
      expect(cardOf(held).status).toBe(status);
      expect(cardOf(held).state).toEqual(cardOf(afterFirst).state);
      // 개념(Elo)은 계속 갱신된다
      expect(held.concepts['k8s.probes']?.state.n_graded).toBe(2);
      // active 복귀 후 재개
      const resumed = fold([
        ...events,
        f.statusChanged({ ts: T0 + 4 * DAY }, CARD, 'active'),
        f.graded({ ts: T0 + 5 * DAY }, { rating: 3 }),
      ]);
      expect(cardOf(resumed).status).toBe('active');
      expect(cardOf(resumed).state.reps).toBeGreaterThan(cardOf(afterFirst).state.reps);
    }
  });

  it('UT-LR-124 now = max(fsrs_at, last_fsrs_at) — 동률·역행 입력에서 예외 0 [NFR-DATA-002]', () => {
    const f = new EventFactory();
    const events = [
      f.enrolled({ ts: T0 }),
      f.graded({ ts: T0 + DAY }, { rating: 3, fsrs_at: T0 + DAY }),
      f.graded({ ts: T0 + DAY + 1 }, { rating: 3, fsrs_at: T0 + DAY }), // 동률
      f.graded({ ts: T0 + DAY + 2 }, { rating: 2, fsrs_at: T0 + 100 }), // 역행
    ];
    const slice = fold(events);
    expect(cardOf(slice).state.last_fsrs_at).toBe(T0 + DAY);
    expect(cardOf(slice).state.reps).toBe(3);
    const state = cardOf(slice).state;
    expect(fsrsNow(state, T0)).toBe(T0 + DAY);
    expect(fsrsNow(newCardState(T0), T0 + 7)).toBe(T0 + 7);
  });

  it('UT-LR-125 state_json 왕복 = 원본(키 12개), 왕복한 상태로 이어서 적용해도 같다 [NFR-DATA-002]', () => {
    const f = new EventFactory();
    const events = [f.enrolled({ ts: T0 }), f.graded({ ts: T0 + DAY }, { rating: 3 })];
    const first = fold(events);
    const state = cardOf(first).state;
    const round = CardStateSchema.parse(JSON.parse(JSON.stringify(state))) satisfies CardState;
    expect(round).toEqual(state);
    expect(Object.keys(state).sort()).toEqual(
      [
        'due',
        'stability',
        'difficulty',
        'elapsed_days',
        'scheduled_days',
        'learning_steps',
        'reps',
        'lapses',
        'state',
        'last_review',
        'last_fsrs_at',
        'leech',
      ].sort(),
    );
    const next = f.graded({ ts: T0 + 6 * DAY }, { rating: 2 });
    const direct = apply(first, next, REPO_PARAMS, EMPTY_CORRECTIONS);
    const viaJson = apply(
      { ...first, cards: { [CARD]: { ...cardOf(first), state: round } } },
      next,
      REPO_PARAMS,
      EMPTY_CORRECTIONS,
    );
    expect(cardOf(viaJson)).toEqual(cardOf(direct));
  });

  it('UT-LR-126 enrolled 없는 graded → payload로 암묵 카드 생성 [FR-PRG-004]', () => {
    const f = new EventFactory();
    const slice = fold([f.graded({ ts: T0 }, { rating: 3, tier: 'C', facet: 'code', response_mode: 'recognition' })]);
    const row = cardOf(slice, 'k8s.probes:code:r');
    expect(row).toMatchObject({
      tier: 'C',
      facet: 'code',
      response_mode: 'recognition',
      status: 'active',
      last_ts: T0,
    });
    expect(row.state.reps).toBe(1);
    expect(slice.concepts['k8s.probes']?.state.n_graded).toBe(1);
  });

  it('UT-LR-127 domain에 Date.now·new Date(·Math.random 0건 [STD-TS-20]', () => {
    const root = path.join(REPO_ROOT, 'services/learning/src/domain/learner-model');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (name.endsWith('.ts') && /Date\.now|new Date\(|Math\.random/.test(readFileSync(full, 'utf8'))) {
          hits.push(full);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });

  it('UT-LR-128 buildProjectorParams: tier별 스케줄러 3개, w 21개 전달 [NFR-DATA-002]', () => {
    const p = buildProjectorParams('ps_0123456789abcdef', FSRS, MASTERY);
    expect(new Set([p.schedulers.A, p.schedulers.B, p.schedulers.C]).size).toBe(3);
    for (const tier of ['A', 'B', 'C'] as const) {
      const prm = p.schedulers[tier].parameters;
      expect(prm.w).toHaveLength(21);
      expect([...prm.w]).toEqual([...FSRS.w]);
      expect(prm.enable_fuzz).toBe(false);
      expect(prm.request_retention).toBe(FSRS.request_retention[tier]);
    }
    expect(p.policy_version).toBe('ps_0123456789abcdef');
    expect(p.fsrs_impl).toBe('ts-fsrs@5.4.2');
  });
});
