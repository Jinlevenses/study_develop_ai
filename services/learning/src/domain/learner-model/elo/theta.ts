import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';

// SP-6 F4 실효 θ · CR-22 θ 증거 수축. 숙달 P·LDI·적응 난이도·승급은 θ̃만 쓴다.

export type ThetaInput = { readonly theta: number; readonly theta_q: number; readonly n_graded: number };

/** θ_eff = min(θ, θ_q + unqualified_ceiling). */
export function effectiveTheta(s: Pick<ThetaInput, 'theta' | 'theta_q'>, mastery: MasteryRulesV1): number {
  return Math.min(s.theta, s.theta_q + mastery.elo.unqualified_ceiling);
}

/** θ̃ = θ_prior + (θ_eff − θ_prior)·n_graded/(n_graded + n0). */
export function shrunkTheta(s: ThetaInput, mastery: MasteryRulesV1): number {
  const { theta_prior: prior, theta_shrink_n0: n0 } = mastery.theta_shrink;
  return prior + (effectiveTheta(s, mastery) - prior) * (s.n_graded / (s.n_graded + n0));
}

/** UI용: n_graded < theta_display_min_events(30)이면 θ 숫자를 표시하지 않고 "증거 부족"을 보인다. */
export function thetaVisible(nGraded: number, mastery: MasteryRulesV1): boolean {
  return nGraded >= mastery.theta_shrink.theta_display_min_events;
}
