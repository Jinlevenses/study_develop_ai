import { evidenceWeight } from '../mastery/evidence.js';
import type { ConceptState, ProjectorParams } from '../projector/types.js';
import { eloK, expectedCorrect, guessFloor, observation, type ResultKind } from './elo.js';

// CR-29 · IF-EV-08 `item_beta_after` — 계산 함수만 제공한다(발행 = T-01-09, outbox payload). 리듀서 상태에는 저장하지 않는다.
// [Brief 결정] 문항 노출 수를 투영이 모르므로 학습자 K(= 갱신 전 개념의 n)를 재사용한다.

export type ItemBetaFields = {
  readonly result: ResultKind;
  readonly pending: boolean;
  readonly rapid: boolean;
  readonly w_format: number;
  readonly w_grader: number;
  readonly gaming_factor: number;
  readonly item_beta: number;
  readonly item_n_options: number;
};

/** w ≤ 0 ∨ pending → null, 그 밖 item_beta + K·w·(P(θ) − obs). K·P는 갱신 **전** 개념 상태 기준. */
export function itemBetaAfter(
  conceptBefore: Pick<ConceptState, 'theta' | 'n'>,
  fields: ItemBetaFields,
  params: ProjectorParams,
): number | null {
  if (fields.pending || fields.result === 'pending') {
    return null;
  }
  const w = evidenceWeight(fields);
  if (!(w > 0)) {
    return null;
  }
  const elo = params.mastery.elo;
  const c = guessFloor(fields.item_n_options, elo);
  const p = expectedCorrect(conceptBefore.theta, fields.item_beta, c);
  const next = fields.item_beta + eloK(elo, conceptBefore.n) * w * (p - observation(fields.result));
  if (!Number.isFinite(next)) {
    throw new Error('invariant: projector produced non-finite item_beta_after');
  }
  return next;
}
