import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import type { EvidenceWeightAdjustedV1 } from '@fathom/contracts/ledger/payloads/evidence-weight-adjusted';
import type { FsrsParamsV1 } from '@fathom/contracts/policy/fsrs_params';
import type { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import type { FSRS } from 'ts-fsrs';

// ADR-011 §5 · Brief T-01-06 §4.2 — 리듀서 입출력 타입. state_json 키 = 0001_projections.sql STORED 생성 열 경로
// (`$.due`·`$.lapses`·`$.n_graded`·`$.mastery.mastered`)와 일치해야 한다.

export type ProjectorParams = {
  readonly policy_version: string;
  readonly fsrs_impl: 'ts-fsrs@5.4.2';
  readonly fsrs: FsrsParamsV1;
  readonly mastery: MasteryRulesV1;
  /** buildProjectorParams가 tier별 1회 생성(request_retention[tier]). */
  readonly schedulers: Readonly<Record<'A' | 'B' | 'C', FSRS>>;
};

/** lr_card_state.state_json — 키 12개 정확히. 시각은 epoch ms 숫자(Date 금지). */
export type CardState = {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;
  last_review: number | null;
  last_fsrs_at: number | null;
  leech: false; // leech 판정 = IT-02(UT-LR-113)
};

export type CardRow = {
  card_id: string;
  concept_id: string;
  facet: string;
  response_mode: 'recognition' | 'production';
  tier: 'A' | 'B' | 'C';
  status: 'active' | 'suspended' | 'retired';
  last_ts: number;
  state: CardState;
};

/** lr_concept_state.state_json — IT-01 키 정확히(4중 역량·d_max 등은 IT-02~03 WP가 가산 + rebuild). */
export type ConceptState = {
  theta: number;
  theta_q: number;
  n: number;
  n_q: number;
  n_graded: number;
  w_sum: number;
  beta_wsum: number;
  credited_formats: Record<string, string>; // FormatId → 처음 산입한 event_id(객체 키)
  study_days: string[]; // 산입 이벤트의 study_day, 오름차순 중복 제거
  mastery: { p: number; mastered: boolean; provisional: false };
  first_mastered_ts: number | null;
};

export type ConceptRow = { concept_id: string; track_id: string; last_ts: number; state: ConceptState };

export type ProjectionSlice = {
  readonly cards: Readonly<Record<string, CardRow>>;
  readonly concepts: Readonly<Record<string, ConceptRow>>;
};

export type WeightAdjustment = {
  /** [client_ts, device_id, device_seq] — 총순서 키. */
  readonly order: readonly [number, string, number];
  readonly adjustment: EvidenceWeightAdjustedV1['adjustment'];
};

export type CorrectionIndex = {
  /** 원 attempt.graded event_id(루트로 정규화). */
  readonly voided: ReadonlySet<string>;
  /** 루트 event_id → 총순서 정렬. */
  readonly adjustments: ReadonlyMap<string, readonly WeightAdjustment[]>;
  /** 루트 event_id → 총순서상 마지막 upgraded/regraded. */
  readonly latestSupersede: ReadonlyMap<string, LedgerEventEnvelope>;
  /** upgraded/regraded event_id → 루트. */
  readonly rootOf: ReadonlyMap<string, string>;
};

export const EMPTY_CORRECTIONS: CorrectionIndex = {
  voided: new Set<string>(),
  adjustments: new Map<string, readonly WeightAdjustment[]>(),
  latestSupersede: new Map<string, LedgerEventEnvelope>(),
  rootOf: new Map<string, string>(),
};

export const EMPTY_SLICE: ProjectionSlice = { cards: {}, concepts: {} };
