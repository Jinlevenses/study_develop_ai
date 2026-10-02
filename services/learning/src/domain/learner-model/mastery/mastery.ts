// ported-from: spikes/sp3-replay-determinism/src/projection.ts (audit-fixed: 파라미터 = 이벤트 policy_version 세트(상수 ELO_K·MASTER_P 폐기)·Elo F0 추측 보정 + θ_q(F4) + 수축(CR-22)·study_day = payload(UTC floor 폐기)·fuzz seed 전략 폐기(fuzz off 고정)·'|' 연결 해시 폐기 → 정준 JSON sha256·Date/any/! 0)
// ported-from: spikes/sp6-promotion-reachability/src/promotion.ts countsAsFormatEvidence·masteryStatus (refBeta 대신 β̄ = 가중 평균 β, SP-3 규칙)
import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { type ResultKind, sigmoid } from '../elo/elo.js';
import { shrunkTheta } from '../elo/theta.js';
import type { ConceptState } from '../projector/types.js';

// FR-PRG-009 · DEC-CNV-19 — 숙달 = P(θ̃) ≥ p_min ∧ 산입 형식 ≥ formats_min ∧ 서로 다른 study_day ≥ distinct_days_min.

/** geq(a, b) = a ≥ b − ε (ε = mastery_rules.epsilon, 모든 임계 비교 공통). */
export function geq(a: number, b: number, epsilon: number): boolean {
  return a >= b - epsilon;
}

export type CreditFields = {
  readonly result: ResultKind;
  readonly pending: boolean;
  readonly rapid: boolean;
  readonly gaming_factor: number;
  readonly w_format: number;
  readonly w_grader: number;
  readonly format: string;
};

/** 초기 개념 상태: θ = θ_q = θ_prior, 카운터 0, 숙달 p = σ(θ̃ − 0)(θ̃ = θ_prior). */
export function initialConceptState(mastery: MasteryRulesV1): ConceptState {
  const prior = mastery.theta_shrink.theta_prior;
  return {
    theta: prior,
    theta_q: prior,
    n: 0,
    n_q: 0,
    n_graded: 0,
    w_sum: 0,
    beta_wsum: 0,
    credited_formats: {},
    study_days: [],
    mastery: { p: sigmoid(prior), mastered: false, provisional: false },
    first_mastered_ts: null,
  };
}

/** 형식 산입 6조건: 정답 ∧ ¬pending ∧ ¬rapid ∧ gaming_factor > 0 ∧ geq(w_format) ∧ geq(w_grader). */
export function countsAsFormatEvidence(f: CreditFields, mastery: MasteryRulesV1): boolean {
  const fc = mastery.mastery.format_counts;
  const eps = mastery.epsilon;
  return (
    f.result === 'correct' &&
    !f.pending &&
    !f.rapid &&
    f.gaming_factor > 0 &&
    geq(f.w_format, fc.w_format_min, eps) &&
    geq(f.w_grader, fc.w_grader_min, eps)
  );
}

/** 산입 이벤트면 형식(처음 산입한 루트 event_id)·study_day를 더한 새 집합을 낸다. 아니면 입력 그대로(참조 유지). */
export function creditEvent(
  state: Pick<ConceptState, 'credited_formats' | 'study_days'>,
  f: CreditFields,
  rootEventId: string,
  studyDay: string,
  mastery: MasteryRulesV1,
): Pick<ConceptState, 'credited_formats' | 'study_days'> {
  if (!countsAsFormatEvidence(f, mastery)) {
    return state;
  }
  const credited = Object.hasOwn(state.credited_formats, f.format)
    ? state.credited_formats
    : { ...state.credited_formats, [f.format]: rootEventId };
  const days = state.study_days.includes(studyDay) ? state.study_days : [...state.study_days, studyDay].sort();
  return { credited_formats: credited, study_days: days };
}

/** β̄ = w_sum > 0 ? beta_wsum / w_sum : 0 (SP-3 규칙). */
export function meanBeta(s: Pick<ConceptState, 'w_sum' | 'beta_wsum'>): number {
  return s.w_sum > 0 ? s.beta_wsum / s.w_sum : 0;
}

/** p = σ(θ̃ − β̄), mastered = geq(p, p_min) ∧ |credited_formats| ≥ formats_min ∧ |study_days| ≥ distinct_days_min. */
export function masteryOf(s: ConceptState, mastery: MasteryRulesV1): { p: number; mastered: boolean } {
  const p = sigmoid(shrunkTheta(s, mastery) - meanBeta(s));
  const m = mastery.mastery;
  const mastered =
    geq(p, m.p_min, mastery.epsilon) &&
    Object.keys(s.credited_formats).length >= m.formats_min &&
    s.study_days.length >= m.distinct_days_min;
  return { p, mastered };
}
