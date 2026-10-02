// ported-from: spikes/sp3-replay-determinism/src/projection.ts (audit-fixed: 파라미터 = 이벤트 policy_version 세트(상수 ELO_K·MASTER_P 폐기)·Elo F0 추측 보정 + θ_q(F4) + 수축(CR-22)·study_day = payload(UTC floor 폐기)·fuzz seed 전략 폐기(fuzz off 고정)·'|' 연결 해시 폐기 → 정준 JSON sha256·Date/any/! 0)
import type { FsrsParamsV1 } from '@fathom/contracts/policy/fsrs_params';
import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import type { Grade } from 'ts-fsrs';
import { createEmptyCard, type FSRS, fsrs, generatorParameters, State } from 'ts-fsrs';
import type { CardState, ProjectorParams } from '../projector/types.js';

// ADR-011 §5 FSRS — `ts-fsrs` 5.4.2, fuzz off, `f.next(card, fsrs_at, rating)`(repeat 금지), 상태는 number(ms)만 저장.

export type CardTier = 'A' | 'B' | 'C';

function toStateNumber(s: State): 0 | 1 | 2 | 3 {
  switch (s) {
    case State.New:
      return 0;
    case State.Learning:
      return 1;
    case State.Review:
      return 2;
    case State.Relearning:
      return 3;
    default:
      throw new Error(`invariant: ts-fsrs returned unknown card state ${String(s)}`);
  }
}

function toGrade(r: 1 | 2 | 3 | 4): Grade {
  return r;
}

function scheduler(params: FsrsParamsV1, tier: CardTier): FSRS {
  return fsrs(
    generatorParameters({
      w: [...params.w],
      enable_fuzz: false,
      enable_short_term: params.enable_short_term,
      request_retention: params.request_retention[tier],
    }),
  );
}

/** policy_version 세트 → 불변 파라미터. tier별 스케줄러 3개를 1회 만든다(UT-LR-128). */
export function buildProjectorParams(
  policyVersion: string,
  fsrsParams: FsrsParamsV1,
  mastery: MasteryRulesV1,
): ProjectorParams {
  const schedulers: Record<CardTier, FSRS> = {
    A: scheduler(fsrsParams, 'A'),
    B: scheduler(fsrsParams, 'B'),
    C: scheduler(fsrsParams, 'C'),
  };
  return { policy_version: policyVersion, fsrs_impl: fsrsParams.impl, fsrs: fsrsParams, mastery, schedulers };
}

/** 새 카드 초기 상태(UT-LR-120: due = client_ts). ts-fsrs 출력의 Date는 즉시 숫자로 바꾼다. */
export function newCardState(clientTs: number): CardState {
  const c = createEmptyCard(clientTs);
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: toStateNumber(c.state),
    last_review: null,
    last_fsrs_at: null,
    leech: false,
  };
}

/** FSRS 입력 시각 = max(fsrs_at, last_fsrs_at) — 지각·역행 입력에서도 FSRSValidationError를 만들지 않는다(UT-LR-124). */
export function fsrsNow(state: CardState, fsrsAt: number): number {
  return state.last_fsrs_at === null ? fsrsAt : Math.max(fsrsAt, state.last_fsrs_at);
}

/** 카드 1회 복습. ts-fsrs 예외(FSRSValidationError)는 삼키지 않는다(STD-ERR-14). */
export function applyCardRating(
  state: CardState,
  tier: CardTier,
  fsrsAt: number,
  rating: 1 | 2 | 3 | 4,
  params: ProjectorParams,
): CardState {
  const now = fsrsNow(state, fsrsAt);
  const { card } = params.schedulers[tier].next(
    {
      due: state.due,
      stability: state.stability,
      difficulty: state.difficulty,
      elapsed_days: state.elapsed_days,
      scheduled_days: state.scheduled_days,
      learning_steps: state.learning_steps,
      reps: state.reps,
      lapses: state.lapses,
      state: state.state,
      last_review: state.last_review,
    },
    now,
    toGrade(rating),
  );
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: toStateNumber(card.state),
    last_review: card.last_review === undefined ? null : card.last_review.getTime(),
    last_fsrs_at: now,
    leech: false,
  };
}
