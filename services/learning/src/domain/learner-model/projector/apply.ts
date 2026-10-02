import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { applyCardRating, newCardState } from '../fsrs/core.js';
import { initialConceptState } from '../mastery/mastery.js';
import { applyVerdictToConcept, type EffectiveVerdict } from './concept.js';
import { EMPTY_CORRECTIONS } from './corrections.js';
import {
  attemptGradedPayload,
  cardEnrolledPayload,
  cardStatusChangedPayload,
  evidenceRegradedPayload,
  evidenceUpgradedPayload,
} from './payload.js';
import type { CardRow, ConceptRow, CorrectionIndex, ProjectionSlice, ProjectorParams } from './types.js';

// ADR-011 §5 순수 리듀서 `apply(state, event, params, corrections)`. 입력은 envelope + 이벤트 policy_version 세트뿐 —
// 시계·난수·현재 설정·I/O 0. 라이브 증분(fast path)과 전체 리플레이가 같은 함수를 쓴다.

type MutableSlice = { cards: Record<string, CardRow>; concepts: Record<string, ConceptRow> };

/** 파라미터가 필요한 이벤트 타입(policy_version으로 해석). 그 밖은 params = null로 충분하다. */
export function needsParams(type: LedgerEventEnvelope['type']): boolean {
  return type === 'card.enrolled' || type === 'attempt.graded';
}

/** needsParams 타입의 payload.policy_version. 그 밖 타입 = null. */
export function policyVersionOf(event: LedgerEventEnvelope): string | null {
  switch (event.type) {
    case 'card.enrolled':
      return cardEnrolledPayload(event).policy_version;
    case 'attempt.graded':
      return attemptGradedPayload(event).policy_version;
    default:
      return null;
  }
}

/** 시드 `<track>.<slug>` → `<track>`, 사용자 `u.<ns>.<slug>` → `u.<ns>` [Brief 결정 — payload에 track 없음]. */
export function trackOfConcept(conceptId: string): string {
  const parts = conceptId.split('.');
  const head = parts[0] ?? conceptId;
  if (head === 'u' && parts[1] !== undefined) {
    return `u.${parts[1]}`;
  }
  return head;
}

function own<T>(rec: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

function requireParams(
  params: ProjectorParams | null,
  event: LedgerEventEnvelope,
  policyVersion: string,
): ProjectorParams {
  if (params === null) {
    throw new Error(`invariant: projector params required for ${event.type} ${event.event_id}`);
  }
  if (params.policy_version !== policyVersion) {
    throw new Error(
      `invariant: projector params ${params.policy_version} != event policy_version ${policyVersion} (${event.event_id})`,
    );
  }
  return params;
}

function newConceptRow(conceptId: string, clientTs: number, params: ProjectorParams): ConceptRow {
  return {
    concept_id: conceptId,
    track_id: trackOfConcept(conceptId),
    last_ts: clientTs,
    state: initialConceptState(params.mastery),
  };
}

function assertFiniteCard(row: CardRow): void {
  const s = row.state;
  const nums = [s.due, s.stability, s.difficulty, s.elapsed_days, s.scheduled_days, s.learning_steps, s.reps, s.lapses];
  if (!nums.every(Number.isFinite)) {
    throw new Error(`invariant: projector produced non-finite card state ${row.card_id}`);
  }
}

function verdictOf(e: LedgerEventEnvelope): EffectiveVerdict {
  return e.type === 'evidence.upgraded' ? evidenceUpgradedPayload(e) : evidenceRegradedPayload(e);
}

/** 유효 판정 = 최신 대체 이벤트의 Verdict 필드(study_day는 호출자가 원 이벤트 값 유지) + 가중 정정(총순서). */
function effectiveVerdict(
  event: LedgerEventEnvelope,
  corrections: CorrectionIndex,
): { readonly verdict: EffectiveVerdict; readonly studyDay: string } {
  const orig = attemptGradedPayload(event);
  const sup = corrections.latestSupersede.get(event.event_id);
  const base: EffectiveVerdict = sup === undefined ? orig : verdictOf(sup);
  let { w_format: wFormat, w_grader: wGrader, gaming_factor: gamingFactor } = base;
  for (const { adjustment } of corrections.adjustments.get(event.event_id) ?? []) {
    if (adjustment.kind === 'factor') {
      gamingFactor *= adjustment.factor;
    } else {
      wFormat = adjustment.w_format ?? wFormat;
      wGrader = adjustment.w_grader ?? wGrader;
      gamingFactor = adjustment.gaming_factor ?? gamingFactor;
    }
  }
  return {
    verdict: {
      result: base.result,
      pending: base.pending,
      rapid: base.rapid,
      format: base.format,
      response_mode: base.response_mode,
      item_beta: base.item_beta,
      item_n_options: base.item_n_options,
      w_format: wFormat,
      w_grader: wGrader,
      gaming_factor: gamingFactor,
    },
    studyDay: orig.study_day,
  };
}

function applyEnrolled(work: MutableSlice, event: LedgerEventEnvelope, params: ProjectorParams | null): void {
  const p = cardEnrolledPayload(event);
  const prm = requireParams(params, event, p.policy_version);
  const ts = event.client_ts;
  const existing = own(work.cards, p.card_id);
  work.cards[p.card_id] =
    existing === undefined
      ? {
          card_id: p.card_id,
          concept_id: p.concept_id,
          facet: p.facet,
          response_mode: p.response_mode,
          tier: p.tier,
          status: 'active',
          last_ts: ts,
          state: newCardState(ts),
        }
      : { ...existing, last_ts: ts };
  if (own(work.concepts, p.concept_id) === undefined) {
    work.concepts[p.concept_id] = newConceptRow(p.concept_id, ts, prm);
  }
}

function applyStatusChanged(work: MutableSlice, event: LedgerEventEnvelope): void {
  const p = cardStatusChangedPayload(event);
  const card = own(work.cards, p.card_id);
  if (card !== undefined) {
    work.cards[p.card_id] = { ...card, status: p.status, last_ts: event.client_ts };
  }
}

function applyGraded(
  work: MutableSlice,
  event: LedgerEventEnvelope,
  params: ProjectorParams | null,
  corrections: CorrectionIndex,
): void {
  const orig = attemptGradedPayload(event);
  const prm = requireParams(params, event, orig.policy_version);
  if (corrections.voided.has(event.event_id)) {
    return; // 무효 = FSRS·Elo·last_ts 모두 제외(SP-3 foldCard 동일)
  }
  const ts = event.client_ts;
  const { verdict, studyDay } = effectiveVerdict(event, corrections);

  // FSRS — 원 이벤트의 rating·result(대체와 무관, rating_applied: false). 카드가 없으면 payload로 암묵 생성.
  const prevCard =
    own(work.cards, orig.card_id) ??
    ({
      card_id: orig.card_id,
      concept_id: orig.concept_id,
      facet: orig.facet,
      response_mode: orig.response_mode,
      tier: orig.tier,
      status: 'active',
      last_ts: ts,
      state: newCardState(ts),
    } satisfies CardRow);
  const fsrsApplies = orig.rating !== null && orig.result !== 'pending' && prevCard.status === 'active';
  const card: CardRow = {
    ...prevCard,
    last_ts: ts,
    state:
      fsrsApplies && orig.rating !== null
        ? applyCardRating(prevCard.state, prevCard.tier, orig.fsrs_at, orig.rating, prm)
        : prevCard.state,
  };
  assertFiniteCard(card);
  work.cards[card.card_id] = card;

  // Elo·숙달 — 유효 판정 필드.
  const prevConcept = own(work.concepts, orig.concept_id) ?? newConceptRow(orig.concept_id, ts, prm);
  work.concepts[orig.concept_id] = {
    ...prevConcept,
    last_ts: ts,
    state: applyVerdictToConcept(prevConcept.state, verdict, event.event_id, studyDay, ts, prm.mastery),
  };
}

function applySuperseded(work: MutableSlice, event: LedgerEventEnvelope): void {
  // 효과는 인덱스로 원 이벤트 위치에 반영된다. 자기 위치에서는 last_ts만(카드·개념이 있을 때) 갱신.
  const p = event.type === 'evidence.upgraded' ? evidenceUpgradedPayload(event) : evidenceRegradedPayload(event);
  const card = own(work.cards, p.card_id);
  if (card !== undefined) {
    work.cards[p.card_id] = { ...card, last_ts: event.client_ts };
  }
  const concept = own(work.concepts, p.concept_id);
  if (concept !== undefined) {
    work.concepts[p.concept_id] = { ...concept, last_ts: event.client_ts };
  }
}

function applyInto(
  work: MutableSlice,
  event: LedgerEventEnvelope,
  params: ProjectorParams | null,
  corrections: CorrectionIndex,
): boolean {
  switch (event.type) {
    case 'card.enrolled':
      applyEnrolled(work, event, params);
      return true;
    case 'card.status_changed':
      applyStatusChanged(work, event);
      return true;
    case 'attempt.graded':
      applyGraded(work, event, params, corrections);
      return true;
    case 'evidence.upgraded':
    case 'evidence.regraded':
      applySuperseded(work, event);
      return true;
    case 'evidence.voided':
    case 'evidence.weight_adjusted':
    case 'policy.switched':
    case 'pretest.answered':
    case 'lesson.completed':
    case 'self_assessment.recorded':
    case 'profile.setting_changed':
    case 'ai_mode.observed':
    case 'declaration.sealed':
    case 'promotion.exam_completed':
    case 'level.promoted':
    case 'level.provisional_resolved':
      return false; // 투영 효과 0 — 정정은 인덱스로, 나머지는 IT-02~03 WP 범위
  }
}

/** 이벤트 1건 적용. 바뀐 키만 새 객체이고 나머지 참조는 유지한다. 효과가 없으면 입력 slice 그대로. */
export function apply(
  state: ProjectionSlice,
  event: LedgerEventEnvelope,
  params: ProjectorParams | null,
  corrections: CorrectionIndex,
): ProjectionSlice {
  const work: MutableSlice = { cards: { ...state.cards }, concepts: { ...state.concepts } };
  return applyInto(work, event, params, corrections) ? work : state;
}

/** 총순서로 정렬된 이벤트열 전체 폴드. resolve = policy_version → 불변 파라미터 세트. */
export function foldEvents(
  events: Iterable<LedgerEventEnvelope>,
  resolve: (policyVersion: string) => ProjectorParams,
  corrections: CorrectionIndex = EMPTY_CORRECTIONS,
): ProjectionSlice {
  const work: MutableSlice = { cards: {}, concepts: {} };
  const memo = new Map<string, ProjectorParams>();
  for (const event of events) {
    let params: ProjectorParams | null = null;
    if (needsParams(event.type)) {
      const ps = policyVersionOf(event);
      if (ps !== null) {
        params = memo.get(ps) ?? resolve(ps);
        memo.set(ps, params);
      }
    }
    applyInto(work, event, params, corrections);
  }
  return work;
}
