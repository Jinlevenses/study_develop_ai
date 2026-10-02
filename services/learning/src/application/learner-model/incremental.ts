import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { PolicySwitchedV1 } from '@fathom/contracts/ledger/payloads/policy-switched';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { apply, foldEvents, needsParams, policyVersionOf } from '../../domain/learner-model/projector/apply.js';
import { buildCorrectionIndex, EMPTY_CORRECTIONS } from '../../domain/learner-model/projector/corrections.js';
import {
  attemptGradedPayload,
  cardEnrolledPayload,
  cardStatusChangedPayload,
  evidenceRegradedPayload,
  evidenceUpgradedPayload,
  evidenceVoidedPayload,
  evidenceWeightAdjustedPayload,
} from '../../domain/learner-model/projector/payload.js';
import type { CardRow, ConceptRow, ProjectionSlice } from '../../domain/learner-model/projector/types.js';
import type { EventTargetLookup, LedgerReplaySource, ProjectionStore, ProjectorParamsResolver } from './ports.js';

// ADR-011 §5 증분 · DB-01 §6.3 append 프로토콜 4 — 원장 append와 같은 tx 안에서 동기 실행. await·tx 열기 0(STD-ASY-02).
// fast path = 엄격 비교를 통과한 단순 후행 이벤트, 그 밖(정정·지각 도착·동률)은 카드·개념 키 재도출(ix_lr_event_card·concept).

export type IncrementalDeps = {
  readonly db: SqlitePort;
  readonly source: LedgerReplaySource;
  readonly targets: EventTargetLookup;
  readonly store: ProjectionStore;
  readonly params: ProjectorParamsResolver;
};

export type AffectedKeys = { readonly card_ids: readonly string[]; readonly concept_ids: readonly string[] };
export type IncrementalPlan =
  | { readonly path: 'none'; readonly keys: AffectedKeys }
  | { readonly path: 'fast' | 'slow'; readonly keys: AffectedKeys };

const NO_KEYS: AffectedKeys = { card_ids: [], concept_ids: [] };

function uniq(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/** 영향 키 — card.*·attempt.graded·evidence.upgraded/regraded = payload의 card_id·concept_id, 정정 = 대상 이벤트의 키. 효과 없는 타입 = null. */
export function affectedKeys(
  deps: Pick<IncrementalDeps, 'db' | 'targets'>,
  event: LedgerEventEnvelope,
): AffectedKeys | null {
  switch (event.type) {
    case 'card.enrolled': {
      const p = cardEnrolledPayload(event);
      return { card_ids: [p.card_id], concept_ids: [p.concept_id] };
    }
    case 'card.status_changed':
      return { card_ids: [cardStatusChangedPayload(event).card_id], concept_ids: [] };
    case 'attempt.graded': {
      const p = attemptGradedPayload(event);
      return { card_ids: [p.card_id], concept_ids: [p.concept_id] };
    }
    case 'evidence.upgraded': {
      const p = evidenceUpgradedPayload(event);
      return { card_ids: [p.card_id], concept_ids: [p.concept_id] };
    }
    case 'evidence.regraded': {
      const p = evidenceRegradedPayload(event);
      return { card_ids: [p.card_id], concept_ids: [p.concept_id] };
    }
    case 'evidence.voided': {
      const k = deps.targets.keysOf(deps.db, evidenceVoidedPayload(event).target_event_ids);
      return { card_ids: uniq(k.card_ids), concept_ids: uniq(k.concept_ids) };
    }
    case 'evidence.weight_adjusted': {
      const k = deps.targets.keysOf(deps.db, evidenceWeightAdjustedPayload(event).target_event_ids);
      return { card_ids: uniq(k.card_ids), concept_ids: uniq(k.concept_ids) };
    }
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
      return null;
  }
}

function isFastCandidate(type: LedgerEventEnvelope['type']): boolean {
  return type === 'card.enrolled' || type === 'card.status_changed' || type === 'attempt.graded';
}

/** fast path 조건(전부 엄격): 카드 없음 또는 card.last_ts < client_ts ∧ (graded) last_fsrs_at 없음 또는 < fsrs_at ∧ 개념 없음 또는 concept.last_ts < client_ts. */
function fastPathHolds(store: ProjectionStore, event: LedgerEventEnvelope, keys: AffectedKeys): boolean {
  const cardId = keys.card_ids[0];
  if (cardId === undefined) {
    return false;
  }
  const card = store.getCard(cardId);
  if (card !== null && !(card.last_ts < event.client_ts)) {
    return false;
  }
  if (event.type === 'attempt.graded' && card !== null) {
    const last = card.state.last_fsrs_at;
    if (last !== null && !(last < attemptGradedPayload(event).fsrs_at)) {
      return false;
    }
  }
  const conceptId = keys.concept_ids[0];
  if (conceptId !== undefined) {
    const concept = store.getConcept(conceptId);
    if (concept !== null && !(concept.last_ts < event.client_ts)) {
      return false;
    }
  }
  return true;
}

/** 이벤트 → 경로·영향 키(UT-LR-150). policy.switched는 호출자가 register 후 'none'. */
export function planIncremental(deps: IncrementalDeps, event: LedgerEventEnvelope): IncrementalPlan {
  const keys = affectedKeys(deps, event);
  if (keys === null) {
    return { path: 'none', keys: NO_KEYS };
  }
  if (isFastCandidate(event.type) && fastPathHolds(deps.store, event, keys)) {
    return { path: 'fast', keys };
  }
  return { path: 'slow', keys };
}

function applyFast(deps: IncrementalDeps, event: LedgerEventEnvelope, keys: AffectedKeys): void {
  const cardId = keys.card_ids[0];
  const conceptId = keys.concept_ids[0];
  const card = cardId === undefined ? null : deps.store.getCard(cardId);
  const concept = conceptId === undefined ? null : deps.store.getConcept(conceptId);
  const slice: ProjectionSlice = {
    cards: card === null ? {} : { [card.card_id]: card },
    concepts: concept === null ? {} : { [concept.concept_id]: concept },
  };
  const ps = needsParams(event.type) ? policyVersionOf(event) : null;
  const params = ps === null ? null : deps.params.resolve(deps.db, ps);
  const next = apply(slice, event, params, EMPTY_CORRECTIONS);
  if (next === slice) {
    return;
  }
  for (const [id, row] of Object.entries(next.cards)) {
    if (slice.cards[id] !== row) {
      deps.store.putCard(row);
    }
  }
  for (const [id, row] of Object.entries(next.concepts)) {
    if (slice.concepts[id] !== row) {
      deps.store.putConcept(row);
    }
  }
}

function pickCard(slice: ProjectionSlice, id: string): CardRow | undefined {
  return Object.hasOwn(slice.cards, id) ? slice.cards[id] : undefined;
}

function pickConcept(slice: ProjectionSlice, id: string): ConceptRow | undefined {
  return Object.hasOwn(slice.concepts, id) ? slice.concepts[id] : undefined;
}

/**
 * 키 재도출(정정·지각 도착·동률·shadow 캐치업): 정정 인덱스 = 전체 정정 이벤트 + 개념 키별 upgraded/regraded,
 * 카드 키마다 byCard 폴드의 그 카드 행, 개념 키마다 byConcept 폴드의 그 개념 행을 store에 쓴다(행이 없으면 생략).
 */
export function rederiveKeys(deps: IncrementalDeps, keys: AffectedKeys): void {
  const { db, source, store } = deps;
  const supersedes: LedgerEventEnvelope[] = [];
  for (const conceptId of keys.concept_ids) {
    for (const e of source.byConcept(db, conceptId)) {
      if (e.type === 'evidence.upgraded' || e.type === 'evidence.regraded') {
        supersedes.push(e);
      }
    }
  }
  const index = buildCorrectionIndex([...source.corrections(db), ...supersedes]);
  const resolve = (ps: string) => deps.params.resolve(db, ps);
  for (const cardId of keys.card_ids) {
    const row = pickCard(foldEvents(source.byCard(db, cardId), resolve, index), cardId);
    if (row !== undefined) {
      store.putCard(row);
    }
  }
  for (const conceptId of keys.concept_ids) {
    const row = pickConcept(foldEvents(source.byConcept(db, conceptId), resolve, index), conceptId);
    if (row !== undefined) {
      store.putConcept(row);
    }
  }
}

/** 방금 원장에 들어간 이벤트 1건을 투영에 반영한다. 동기 함수 — writer tx 안에서 부른다. */
export function applyIncremental(deps: IncrementalDeps, event: LedgerEventEnvelope): void {
  if (event.type === 'policy.switched') {
    const p = policySwitched(event);
    deps.params.register(p.policy_version, p.members);
    return;
  }
  const plan = planIncremental(deps, event);
  if (plan.path === 'none') {
    return;
  }
  if (plan.path === 'fast') {
    applyFast(deps, event, plan.keys);
    return;
  }
  rederiveKeys(deps, plan.keys);
}

function policySwitched(event: LedgerEventEnvelope): PolicySwitchedV1 {
  const parsed = PolicySwitchedV1.safeParse(event.payload);
  if (!parsed.success) {
    throw new Error(`invariant: policy.switched payload invalid ${event.event_id}`);
  }
  return parsed.data;
}
