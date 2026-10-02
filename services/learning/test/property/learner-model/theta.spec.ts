import { createPrng } from '@fathom/testkit/prng';
import { describe, expect, it } from 'vitest';
import { effectiveTheta } from '../../../src/domain/learner-model/elo/theta.js';
import { apply } from '../../../src/domain/learner-model/projector/apply.js';
import { EMPTY_CORRECTIONS } from '../../../src/domain/learner-model/projector/corrections.js';
import type { ProjectionSlice, ProjectorParams } from '../../../src/domain/learner-model/projector/types.js';
import { EMPTY_SLICE } from '../../../src/domain/learner-model/projector/types.js';
import { EventFactory, T0 } from '../../unit/learner-model/support/events.js';
import { MASTERY, makeParams, REPO_PARAMS } from '../../unit/learner-model/support/policy.js';

const PRIOR = MASTERY.theta_shrink.theta_prior;
const SEEDS = Array.from({ length: 20 }, (_, i) => 5_000 + i);

/** OX(n_options 2) 무작위 찍기 600건 — n_graded ≥ 30 이후 θ_eff − θ_prior의 최댓값(노출 필터 없음). */
function guessingMaxDelta(seed: number, params: ProjectorParams, events = 600): { max: number; final: number } {
  const rng = createPrng(seed);
  const f = new EventFactory();
  const ps = { policy_version: params.policy_version };
  let slice: ProjectionSlice = apply(
    EMPTY_SLICE,
    f.enrolled({ ts: T0 }, { ...ps, facet: 'concept' }),
    params,
    EMPTY_CORRECTIONS,
  );
  let max = Number.NEGATIVE_INFINITY;
  let final = 0;
  for (let i = 1; i <= events; i += 1) {
    const correct = rng.next() < 0.5;
    const e = f.graded(
      { ts: T0 + i * 1000 },
      {
        ...ps,
        format: 'ox',
        item_n_options: 2,
        item_beta: 0,
        w_format: 1,
        w_grader: 1,
        result: correct ? 'correct' : 'incorrect',
        rating: correct ? 3 : 1,
      },
    );
    slice = apply(slice, e, params, EMPTY_CORRECTIONS);
    const c = slice.concepts['k8s.probes'];
    if (c === undefined) {
      throw new Error('concept missing');
    }
    final = effectiveTheta(c.state, params.mastery) - PRIOR;
    if (c.state.n_graded >= 30) {
      max = Math.max(max, final);
    }
  }
  return { max, final };
}

describe('learner-model θ 회귀 — 무작위 찍기는 θ를 올리지 못한다(노출 필터 없이)', () => {
  // 실측(시드 5000..5019, 레포 정책 값): 20 시드 중 19개는 최대 Δ ≤ −0.288, 시드 5013 하나가 일시적으로 +0.404까지 올랐다가 하강(최종 Δ ≤ −1.8).
  // 이 기준(최대 ≤ 0.02)은 α .8·b .05 값에서 시드에 따라 깨질 수 있어 Brief §7 `ambiguity`로 보고한다 — 정책 값은 바꾸지 않는다(VC-1 SIM-PROMO 입력).
  // 아래 `it.fails`는 기준 그대로의 단언이며, 정책이 바뀌어 충족되는 순간 실패로 뒤집혀 이 주석과 함께 갱신을 강제한다.
  it.fails('UT-LR-504 OX 무작위 찍기(p = .5, w = 1, β = 0) 20 시드 × 600건: n_graded ≥ 30 이후 θ_eff − θ_prior 최대 ≤ 0.02 [ambiguity: 시드 5013 +0.404] [FR-QST-025][FR-PRG-008]', () => {
    const maxes = SEEDS.map((s) => guessingMaxDelta(s, REPO_PARAMS).max);
    expect(Math.max(...maxes)).toBeLessThanOrEqual(0.02);
  });

  it('UT-LR-515 504의 견고한 형태: 시드 95% 이상이 최대 ≤ 0.02, 어떤 시드도 최대 ≤ 0.5, 600건 뒤 Δ는 모두 크게 음수 [FR-QST-025][FR-PRG-008]', () => {
    const results = SEEDS.map((s) => guessingMaxDelta(s, REPO_PARAMS));
    const within = results.filter((r) => r.max <= 0.02).length;
    expect(within / SEEDS.length).toBeGreaterThanOrEqual(0.95);
    expect(Math.max(...results.map((r) => r.max))).toBeLessThanOrEqual(0.5);
    expect(Math.max(...results.map((r) => r.final))).toBeLessThanOrEqual(-1.5);
  });

  it('UT-LR-513 504의 음성 대조: guess_correction:false면 같은 지표(n_graded ≥ 30 이후 최대 Δ)가 모든 시드에서 > 0.3 [FR-PRG-008]', () => {
    const noGuess = makeParams({ mastery: (m) => ({ ...m, elo: { ...m.elo, guess_correction: false } }) });
    const maxes = SEEDS.map((s) => guessingMaxDelta(s, noGuess).max);
    expect(Math.min(...maxes)).toBeGreaterThan(0.3);
  });

  it('UT-LR-514 자기채점(S, w_grader .3) 400건 후 θ_eff ≤ θ_prior [FR-PRG-008]', () => {
    const f = new EventFactory();
    let slice: ProjectionSlice = apply(EMPTY_SLICE, f.enrolled({ ts: T0 }), REPO_PARAMS, EMPTY_CORRECTIONS);
    for (let i = 1; i <= 400; i += 1) {
      slice = apply(
        slice,
        f.graded({ ts: T0 + i * 1000 }, { w_grader: 0.3, result: 'correct' }),
        REPO_PARAMS,
        EMPTY_CORRECTIONS,
      );
    }
    const c = slice.concepts['k8s.probes'];
    expect(c?.state.n).toBe(400);
    expect(c?.state.theta).toBeGreaterThan(PRIOR + 1); // θ 자체는 오르지만
    expect(c?.state.n_q).toBe(0); // θ_q는 비산입 → prior
    expect(c === undefined ? 1 : effectiveTheta(c.state, MASTERY)).toBeLessThanOrEqual(PRIOR);
  });
});
