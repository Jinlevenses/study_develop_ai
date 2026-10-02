import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { describe, expect, it } from 'vitest';
import { eloK, expectedCorrect, guessFloor, observation, sigmoid } from '../../../src/domain/learner-model/elo/elo.js';
import { itemBetaAfter } from '../../../src/domain/learner-model/elo/item-beta.js';
import { effectiveTheta, shrunkTheta, thetaVisible } from '../../../src/domain/learner-model/elo/theta.js';
import { initialConceptState } from '../../../src/domain/learner-model/mastery/mastery.js';
import { foldEvents } from '../../../src/domain/learner-model/projector/apply.js';
import type {
  ConceptState,
  ProjectionSlice,
  ProjectorParams,
} from '../../../src/domain/learner-model/projector/types.js';
import { DAY, EventFactory, T0 } from './support/events.js';
import { FAKE_DB, MemoryResolver } from './support/memory.js';
import { MASTERY, makeParams, REPO_PARAMS } from './support/policy.js';

const PRIOR = MASTERY.theta_shrink.theta_prior;

function run(events: readonly LedgerEventEnvelope[], params: ProjectorParams = REPO_PARAMS): ConceptState {
  const r = new MemoryResolver([params]);
  const slice: ProjectionSlice = foldEvents(events, (ps) => r.resolve(FAKE_DB, ps));
  const concept = slice.concepts['k8s.probes'];
  if (concept === undefined) {
    throw new Error('concept missing');
  }
  return concept.state;
}
const withPs = (p: ProjectorParams): { policy_version: string } => ({ policy_version: p.policy_version });

describe('learner-model Elo — 추측 보정 · K · θ_q · 수축', () => {
  it('UT-LR-104 P = c + (1−c)·σ(θ−β), c = 1/item_n_options, 열린 형식 c = 0 [FR-PRG-008]', () => {
    // 고정 입력: θ = −0.5, β = 0, n_options 4 → P = 0.25 + 0.75·σ(−0.5)
    const c = guessFloor(4, MASTERY.elo);
    expect(c).toBe(0.25);
    expect(expectedCorrect(-0.5, 0, c)).toBeCloseTo(0.533155501598609, 12);
    expect(guessFloor(0, MASTERY.elo)).toBe(0); // 열린 형식
    expect(expectedCorrect(0.7, 0.2, 0)).toBeCloseTo(sigmoid(0.5), 12);
    // 리듀서: 정답 1건 → θ = −0.5 + 1·0.8·(1 − P)
    const f = new EventFactory();
    const s = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { item_n_options: 4, item_beta: 0 })]);
    expect(s.theta).toBeCloseTo(-0.1265244012788872, 12);
    expect(s.theta).toBeGreaterThan(PRIOR);
  });

  it('UT-LR-105 K = α/(1+b·n), n = w>0 관측 수(정책 값 α .8·b .05) [FR-PRG-008]', () => {
    expect(MASTERY.elo.alpha).toBe(0.8);
    expect(MASTERY.elo.b).toBe(0.05);
    expect(eloK(MASTERY.elo, 0)).toBe(0.8);
    expect(eloK(MASTERY.elo, 20)).toBeCloseTo(0.4, 12);
    // 두 번째 정답의 K = 0.8/1.05(n = 1)
    const f = new EventFactory();
    const s2 = run([
      f.enrolled({ ts: T0 }),
      f.graded({ ts: T0 + 1 }, { item_n_options: 4 }),
      f.graded({ ts: T0 + 2 }, { item_n_options: 4 }),
    ]);
    expect(s2.theta).toBeCloseTo(0.17724072486708858, 12);
    expect(s2.n).toBe(2);
    // w = 0 관측(rapid)은 n을 올리지 않아 K가 줄지 않는다
    const withRapid = run([
      f.enrolled({ ts: T0 }),
      f.graded({ ts: T0 + 1 }, { item_n_options: 4 }),
      f.graded({ ts: T0 + 2 }, { item_n_options: 4, rapid: true }),
      f.graded({ ts: T0 + 3 }, { item_n_options: 4 }),
    ]);
    expect(withRapid.theta).toBeCloseTo(s2.theta, 12);
    expect(withRapid.n).toBe(2);
    expect(withRapid.n_graded).toBe(3);
  });

  it('UT-LR-106 θ_q는 형식 산입 2조건 이벤트만, θ_eff = min(θ, θ_q) [FR-PRG-008][FR-PRG-009]', () => {
    const f = new EventFactory();
    // w_format .5 < .7 → θ만 갱신
    const low = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { w_format: 0.5 })]);
    expect(low.n).toBe(1);
    expect(low.n_q).toBe(0);
    expect(low.theta_q).toBe(PRIOR);
    expect(low.theta).toBeGreaterThan(PRIOR);
    expect(effectiveTheta(low, MASTERY)).toBe(PRIOR);
    // w_grader .5 < .6
    const lowGrader = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { w_grader: 0.5 })]);
    expect(lowGrader.n_q).toBe(0);
    // 두 조건 충족 → θ_q도 갱신
    const ok = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { w_format: 0.7, w_grader: 0.6 })]);
    expect(ok.n_q).toBe(1);
    expect(ok.theta_q).toBeGreaterThan(PRIOR);
    expect(effectiveTheta({ theta: 2, theta_q: 1 }, MASTERY)).toBe(1);
    expect(effectiveTheta({ theta: 0.5, theta_q: 1 }, MASTERY)).toBe(0.5);
  });

  it('UT-LR-107 n_graded < 30 → thetaVisible false, θ̃ 식 고정 입력 → 기대값 [FR-PRG-008][FR-PRG-017]', () => {
    expect(thetaVisible(29, MASTERY)).toBe(false);
    expect(thetaVisible(30, MASTERY)).toBe(true);
    // θ_prior −0.5, n0 10: θ̃ = −0.5 + (1.5 + 0.5)·30/40 = 1.0
    expect(shrunkTheta({ theta: 1.5, theta_q: 1.5, n_graded: 30 }, MASTERY)).toBeCloseTo(1.0, 12);
    expect(shrunkTheta({ theta: 1.5, theta_q: 1.5, n_graded: 10 }, MASTERY)).toBeCloseTo(0.5, 12);
  });

  it('UT-LR-130 obs partial = .5 [FR-PRG-008]', () => {
    expect(observation('correct')).toBe(1);
    expect(observation('partial')).toBe(0.5);
    expect(observation('incorrect')).toBe(0);
    const f = new EventFactory();
    const s = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { result: 'partial' })]);
    expect(s.theta).toBeCloseTo(-0.4020325350385163, 12);
  });

  it('UT-LR-131 w = 0(rapid·gaming 0)·pending 분기별 카운터(n·n_q·n_graded) [FR-PRG-008]', () => {
    const f = new EventFactory();
    const base = run([f.enrolled({ ts: T0 })]);
    const rapid = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { rapid: true })]);
    const incorrectRapid = run([
      f.enrolled({ ts: T0 }),
      f.graded({ ts: T0 + 1 }, { rapid: true, result: 'incorrect' }),
    ]);
    const gaming0 = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { gaming_factor: 0 })]);
    const pending = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { result: 'pending' })]);
    for (const s of [rapid, incorrectRapid, gaming0]) {
      expect(s).toMatchObject({
        theta: base.theta,
        theta_q: base.theta_q,
        n: 0,
        n_q: 0,
        w_sum: 0,
        beta_wsum: 0,
        n_graded: 1,
      });
    }
    expect(pending).toEqual(base); // pending = 카운터 포함 전부 건너뜀
    const normal = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + 1 }, { item_beta: 0.4 })]);
    expect(normal).toMatchObject({ n: 1, n_q: 1, n_graded: 1, w_sum: 1 });
    expect(normal.beta_wsum).toBeCloseTo(0.4, 12);
  });

  it('UT-LR-132 K_q가 n_q로 감소 [FR-PRG-008]', () => {
    const f = new EventFactory();
    const events: LedgerEventEnvelope[] = [f.enrolled({ ts: T0 })];
    // θ만 갱신되는(θ_q 비산입) 이벤트 20건 뒤에도 θ_q의 K는 n_q = 0 기준
    for (let i = 1; i <= 20; i += 1) {
      events.push(f.graded({ ts: T0 + i }, { w_format: 0.5 }));
    }
    events.push(f.graded({ ts: T0 + 100 }, { w_format: 1 }));
    const s = run(events);
    expect(s.n).toBe(21);
    expect(s.n_q).toBe(1);
    // θ_q 첫 갱신: K_q = 0.8 (n_q = 0) → θ_q = −0.5 + 0.8·(1 − σ(−0.5))
    expect(s.theta_q).toBeCloseTo(PRIOR + 0.8 * (1 - sigmoid(PRIOR)), 12);
    const two = run([
      f.enrolled({ ts: T0 }),
      f.graded({ ts: T0 + 1 }, { w_format: 1 }),
      f.graded({ ts: T0 + 2 }, { w_format: 1 }),
    ]);
    const first = PRIOR + 0.8 * (1 - sigmoid(PRIOR));
    expect(two.theta_q).toBeCloseTo(first + (0.8 / 1.05) * (1 - sigmoid(first)), 12);
  });

  it('UT-LR-133 unqualified_ceiling 반영 [FR-PRG-009]', () => {
    const ceiling = makeParams({ mastery: (m) => ({ ...m, elo: { ...m.elo, unqualified_ceiling: 0.3 } }) });
    const f = new EventFactory();
    const events = [f.enrolled({ ts: T0 }, withPs(ceiling))];
    for (let i = 1; i <= 12; i += 1) {
      events.push(f.graded({ ts: T0 + i }, { ...withPs(ceiling), w_format: 0.5 })); // θ만 증가, θ_q = prior
    }
    const s = run(events, ceiling);
    expect(s.theta_q).toBe(PRIOR);
    expect(s.theta).toBeGreaterThan(PRIOR + 0.3);
    expect(effectiveTheta(s, ceiling.mastery)).toBeCloseTo(PRIOR + 0.3, 12);
  });

  it('UT-LR-134 수축: n_graded 0 → θ_prior, 1,000 → θ_eff 근접 [CR-22]', () => {
    expect(shrunkTheta({ theta: 3, theta_q: 3, n_graded: 0 }, MASTERY)).toBe(PRIOR);
    const near = shrunkTheta({ theta: 3, theta_q: 3, n_graded: 1000 }, MASTERY);
    expect(Math.abs(near - 3)).toBeLessThan(0.04);
    expect(near).toBeLessThan(3);
  });

  it('UT-LR-135 guess_correction:false 정책 → c = 0 [CR-22]', () => {
    const noGuess = makeParams({ mastery: (m) => ({ ...m, elo: { ...m.elo, guess_correction: false } }) });
    expect(guessFloor(4, noGuess.mastery.elo)).toBe(0);
    const f = new EventFactory();
    const s = run(
      [f.enrolled({ ts: T0 }, withPs(noGuess)), f.graded({ ts: T0 + 1 }, { ...withPs(noGuess), item_n_options: 4 })],
      noGuess,
    );
    expect(s.theta).toBeCloseTo(PRIOR + 0.8 * (1 - sigmoid(PRIOR)), 12);
  });

  it('UT-LR-136 비유한 값이면 invariant로 던진다(정준 JSON 보호) [NFR-DATA-002]', () => {
    const blown = makeParams({ mastery: (m) => ({ ...m, elo: { ...m.elo, alpha: Number.POSITIVE_INFINITY } }) });
    const f = new EventFactory();
    expect(() => run([f.enrolled({ ts: T0 }, withPs(blown)), f.graded({ ts: T0 + 1 }, withPs(blown))], blown)).toThrow(
      /invariant: projector produced non-finite/,
    );
    const betaBlown = makeParams({ mastery: (m) => ({ ...m, elo: { ...m.elo, alpha: Number.POSITIVE_INFINITY } }) });
    expect(() =>
      itemBetaAfter(
        initialConceptState(betaBlown.mastery),
        {
          result: 'correct',
          pending: false,
          rapid: false,
          w_format: 1,
          w_grader: 1,
          gaming_factor: 1,
          item_beta: 0,
          item_n_options: 0,
        },
        betaBlown,
      ),
    ).toThrow(/non-finite item_beta_after/);
  });

  it('UT-LR-137 초기 개념 행 값 [CR-22]', () => {
    const init = initialConceptState(MASTERY);
    expect(init).toEqual({
      theta: PRIOR,
      theta_q: PRIOR,
      n: 0,
      n_q: 0,
      n_graded: 0,
      w_sum: 0,
      beta_wsum: 0,
      credited_formats: {},
      study_days: [],
      mastery: { p: sigmoid(PRIOR), mastered: false, provisional: false },
      first_mastered_ts: null,
    });
    const f = new EventFactory();
    const s = run([f.enrolled({ ts: T0 })]);
    expect(s).toEqual(init);
    // 개념 행 track_id (Brief 결정): 시드 '<track>.<slug>' → '<track>', 사용자 'u.<ns>.<slug>' → 'u.<ns>'
    const r = new MemoryResolver([REPO_PARAMS]);
    const slice = foldEvents(
      [
        f.enrolled({ ts: T0 }, { concept_id: 'u.acme.vpn-setup' }),
        f.enrolled({ ts: T0 + 1 }, { concept_id: 'net.tcp' }),
      ],
      (ps) => r.resolve(FAKE_DB, ps),
    );
    expect(slice.concepts['u.acme.vpn-setup']?.track_id).toBe('u.acme');
    expect(slice.concepts['net.tcp']?.track_id).toBe('net');
  });
});

describe('learner-model β 갱신 — CR-29 · IF-EV-08 item_beta_after', () => {
  const fields = {
    result: 'correct',
    pending: false,
    rapid: false,
    w_format: 1,
    w_grader: 1,
    gaming_factor: 1,
    item_beta: 0,
    item_n_options: 4,
  } as const;

  it('UT-LR-115 itemBetaAfter 고정 입력 → 기대값, w = 0·pending → null, 리플레이 2회 동일 [FR-PRG-008][FR-CUR-007]', () => {
    const before = { theta: -0.5, n: 0 };
    // β' = β + K·w·(P − obs) = 0 + 0.8·1·(0.5331555 − 1)
    expect(itemBetaAfter(before, fields, REPO_PARAMS)).toBeCloseTo(-0.3734755987211128, 12);
    expect(itemBetaAfter(before, { ...fields, result: 'incorrect' }, REPO_PARAMS)).toBeCloseTo(
      0.8 * 0.533155501598609,
      12,
    );
    expect(itemBetaAfter(before, { ...fields, rapid: true }, REPO_PARAMS)).toBeNull();
    expect(itemBetaAfter(before, { ...fields, gaming_factor: 0 }, REPO_PARAMS)).toBeNull();
    expect(itemBetaAfter(before, { ...fields, pending: true }, REPO_PARAMS)).toBeNull();
    expect(itemBetaAfter(before, { ...fields, result: 'pending' }, REPO_PARAMS)).toBeNull();
    // K는 갱신 전 개념 상태(n) 기준
    expect(itemBetaAfter({ theta: -0.5, n: 20 }, fields, REPO_PARAMS)).toBeCloseTo(0.4 * (0.533155501598609 - 1), 12);
    // 리듀서 상태에는 저장하지 않는다 — 개념 상태 키 11개 그대로
    const f = new EventFactory();
    const s = run([f.enrolled({ ts: T0 }), f.graded({ ts: T0 + DAY }, { item_n_options: 4 })]);
    expect(Object.keys(s)).not.toContain('item_beta');
    // 리플레이 2회 동일
    const a = itemBetaAfter(before, fields, REPO_PARAMS);
    const b = itemBetaAfter(before, fields, REPO_PARAMS);
    expect(a).toBe(b);
  });
});
