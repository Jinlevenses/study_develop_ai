// ported-from: spikes/sp3-replay-determinism/src/projection.ts (audit-fixed: 파라미터 = 이벤트 policy_version 세트(상수 ELO_K·MASTER_P 폐기)·Elo F0 추측 보정 + θ_q(F4) + 수축(CR-22)·study_day = payload(UTC floor 폐기)·fuzz seed 전략 폐기(fuzz off 고정)·'|' 연결 해시 폐기 → 정준 JSON sha256·Date/any/! 0)
// ported-from: spikes/sp6-promotion-reachability/src/promotion.ts applyResponse·expectedCorrect (clamp(θMin/θMax)·refBeta 미이식 — 정책에 키 없음, Brief T-01-06 §4.3)
import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';

// ADR-011 §5 Elo(F0·F4): P = c + (1 − c)·σ(θ − β), K = α/(1 + b·n), θ += w·K·(obs − P). clamp 없음.

export type EloRules = MasteryRulesV1['elo'];
export type ResultKind = 'correct' | 'partial' | 'incorrect' | 'pending';

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** obs = {correct: 1, partial: 0.5, incorrect: 0}(pending은 호출 전에 걸러진다). */
export function observation(result: ResultKind): number {
  switch (result) {
    case 'correct':
      return 1;
    case 'partial':
      return 0.5;
    default:
      return 0;
  }
}

/** 추측 하한 c = guess_correction ∧ item_n_options > 0 ? 1/item_n_options : 0 (열린 형식 c = 0). */
export function guessFloor(itemNOptions: number, elo: EloRules): number {
  return elo.guess_correction && itemNOptions > 0 ? 1 / itemNOptions : 0;
}

export function expectedCorrect(theta: number, itemBeta: number, c: number): number {
  return c + (1 - c) * sigmoid(theta - itemBeta);
}

/** K = α / (1 + b·n), n = w > 0 관측 수(학습자 θ는 n, θ_q는 n_q). */
export function eloK(elo: EloRules, n: number): number {
  return elo.alpha / (1 + elo.b * n);
}

/** θ 한 번 갱신. w ≤ 0이면 불변(호출자가 n도 올리지 않는다). */
export function updateElo(
  theta: number,
  n: number,
  obs: number,
  w: number,
  itemBeta: number,
  c: number,
  elo: EloRules,
): number {
  if (w <= 0) {
    return theta;
  }
  const p = expectedCorrect(theta, itemBeta, c);
  return theta + w * eloK(elo, n) * (obs - p);
}
