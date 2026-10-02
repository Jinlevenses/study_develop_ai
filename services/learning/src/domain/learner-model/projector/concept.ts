import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { guessFloor, observation, type ResultKind, updateElo } from '../elo/elo.js';
import { evidenceWeight } from '../mastery/evidence.js';
import { creditEvent, geq, masteryOf } from '../mastery/mastery.js';
import type { ConceptState } from './types.js';

// 채점 이벤트 1건의 개념 상태 반영(ADR-011 §5 Elo F0·F4 + 숙달). 유효 필드 = 대체·가중 정정이 적용된 값.

export type EffectiveVerdict = {
  readonly result: ResultKind;
  readonly pending: boolean;
  readonly rapid: boolean;
  readonly format: string;
  readonly response_mode: 'recognition' | 'production';
  readonly item_beta: number;
  readonly item_n_options: number;
  readonly w_format: number;
  readonly w_grader: number;
  readonly gaming_factor: number;
};

export function isPendingVerdict(v: Pick<EffectiveVerdict, 'result' | 'pending'>): boolean {
  return v.pending || v.result === 'pending';
}

/**
 * pending → 카운터·Elo 전부 건너뜀(상태 그대로) · n_graded += 1(w = 0 포함) · w > 0이면 θ·n·w_sum·beta_wsum ·
 * θ_q 조건(w > 0 ∧ geq(w_format) ∧ geq(w_grader))이면 θ_q·n_q · 형식 산입 · 숙달 재계산.
 */
export function applyVerdictToConcept(
  s: ConceptState,
  v: EffectiveVerdict,
  rootEventId: string,
  studyDay: string,
  clientTs: number,
  mastery: MasteryRulesV1,
): ConceptState {
  if (isPendingVerdict(v)) {
    return s;
  }
  const elo = mastery.elo;
  const eps = mastery.epsilon;
  const w = evidenceWeight(v);
  const obs = observation(v.result);
  const c = guessFloor(v.item_n_options, elo);
  let { theta, theta_q: thetaQ, n, n_q: nQ, w_sum: wSum, beta_wsum: betaWsum } = s;
  if (w > 0) {
    theta = updateElo(s.theta, s.n, obs, w, v.item_beta, c, elo);
    n = s.n + 1;
    wSum = s.w_sum + w;
    betaWsum = s.beta_wsum + w * v.item_beta;
    if (geq(v.w_format, elo.theta_q.w_format_min, eps) && geq(v.w_grader, elo.theta_q.w_grader_min, eps)) {
      thetaQ = updateElo(s.theta_q, s.n_q, obs, w, v.item_beta, c, elo);
      nQ = s.n_q + 1;
    }
  }
  const credit = creditEvent(s, v, rootEventId, studyDay, mastery);
  const next: ConceptState = {
    theta,
    theta_q: thetaQ,
    n,
    n_q: nQ,
    n_graded: s.n_graded + 1,
    w_sum: wSum,
    beta_wsum: betaWsum,
    credited_formats: credit.credited_formats,
    study_days: credit.study_days,
    mastery: s.mastery,
    first_mastered_ts: s.first_mastered_ts,
  };
  const m = masteryOf(next, mastery);
  next.mastery = { p: m.p, mastered: m.mastered, provisional: false };
  if (next.first_mastered_ts === null && m.mastered) {
    next.first_mastered_ts = clientTs;
  }
  const finite = [theta, thetaQ, wSum, betaWsum, m.p];
  if (!finite.every(Number.isFinite)) {
    throw new Error('invariant: projector produced non-finite concept state');
  }
  return next;
}
