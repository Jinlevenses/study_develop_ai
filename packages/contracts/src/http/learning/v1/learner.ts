import { z } from 'zod';
import {
  AiMode,
  Confidence,
  Facet,
  FormatId,
  GraderEngine,
  JudgeBadge,
  Level,
  Lifecycle,
  MasteryStatus,
  ResponseMode,
  Sp1State,
  Tier,
} from '../../../common/domain.js';
import { CardId, ConceptId, DeviceId, ItemId, PolicySetId, TrackId, Ulid } from '../../../common/ids.js';
import { Cursor, Page, PageQuery } from '../../../common/pagination.js';
import { FeasibilityBlocker, PromotionGate } from '../../../common/practice.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs, StudyDay } from '../../../common/time.js';
import { LedgerEventType } from '../../../ledger/envelope.js';
import { TrackCap } from '../../content/v1/catalog.js';

export const MasteryView = S({
  status: MasteryStatus,
  provisional: z.boolean(),
  needs_reconfirmation: z.boolean(),
  p: z.number().min(0).max(1).nullable(),
  formats_counted: z.array(FormatId),
  distinct_study_days: z.number().int().min(0),
});
export type MasteryView = z.infer<typeof MasteryView>;
export const ThetaView = S({
  display: z.number().nullable(), // n_graded < theta_display_min_events(30)이면 null — UI는 "증거 부족"(CR-22). 표시값 = 수축 θ̃
  n_graded: z.number().int().min(0),
  evidence_sufficient: z.boolean(),
  display_min_events: z.number().int().min(1),
});
export type ThetaView = z.infer<typeof ThetaView>;
export const CardView = S({
  card_id: CardId,
  concept_id: ConceptId,
  facet: Facet,
  response_mode: ResponseMode,
  tier: Tier,
  status: z.enum(['active', 'suspended', 'retired']),
  due_at: EpochMs.nullable(),
  retrievability: z.number().min(0).max(1).nullable(),
  stability_days: z.number().min(0).nullable(),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  leech: z.boolean(),
});
export type CardView = z.infer<typeof CardView>;
export const LearnerConceptMini = S({
  concept_id: ConceptId,
  lifecycle: Lifecycle,
  mastery: MasteryStatus,
  provisional: z.boolean(),
  rusty: z.boolean(),
});
export type LearnerConceptMini = z.infer<typeof LearnerConceptMini>;
export const LearnerConceptState = S({
  concept_id: ConceptId,
  lifecycle: Lifecycle,
  mastery: MasteryView,
  theta: ThetaView,
  competence: S({
    mastered: z.boolean(),
    retained: z.boolean(),
    deepened: z.boolean(),
    transferred: z.boolean(),
    taught: z.boolean(),
  }), // FR-PRG-010
  cards: z.array(CardView).max(20),
  track_level: Level.nullable(),
  rusty: z.boolean(),
  entry_stage: z.enum(['theory', 'pretest', 'problem', 'problem_definition']), // FR-CUR-006: 트랙 레벨 L1~2 이론, L3 프리테스트, L4 문제, L5 문제 정의
  nba: S({
    kind: z.enum(['learn', 'practice', 'verify', 'dig', 'case', 'review', 'revalidate']),
    label_ko: z.string().max(60),
  }).nullable(),
  last_activity_at: EpochMs.nullable(),
});
export type LearnerConceptState = z.infer<typeof LearnerConceptState>;
export const LedgerEventSummary = S({
  event_id: Ulid,
  type: LedgerEventType,
  device_id: DeviceId,
  client_ts: EpochMs,
  study_day: StudyDay.nullable(),
  item_id: ItemId.nullable(),
  format: FormatId.nullable(),
  result: z.enum(['correct', 'partial', 'incorrect', 'pending']).nullable(),
  w: z.number().min(0).max(1).nullable(),
  grader_engine: GraderEngine.nullable(),
  badge: JudgeBadge.nullable(),
  verdict_id: Ulid.nullable(),
  superseded_by: Ulid.nullable(),
  voided: z.boolean(),
});
export type LedgerEventSummary = z.infer<typeof LedgerEventSummary>;
export const PromotionPreview = S({
  track: TrackId,
  from_level: Level,
  to_level: Level,
  decision: z.enum(['promote', 'promote_provisional', 'not_ready', 'cap_reached']),
  gates: z.array(PromotionGate).max(20),
  blockers: z.array(FeasibilityBlocker).max(50),
  exam: S({
    eligible: z.boolean(),
    retry_after: EpochMs.nullable(),
    last: S({
      exam_id: Ulid,
      passed: z.boolean(),
      correct_count: z.number().int(),
      cbm_ratio: z.number(),
      at: EpochMs,
    }).nullable(),
  }),
  profile: S({ policy_version: PolicySetId, ai_mode: AiMode, sp1_state: Sp1State }),
  cap: TrackCap, // = IF-CT-004
});
export type PromotionPreview = z.infer<typeof PromotionPreview>;
export const LearnerTrackView = S({
  track: TrackId,
  level: Level.nullable(),
  provisional: z.boolean(),
  needs_reconfirmation: z.boolean(),
  promoted_at: EpochMs.nullable(),
  mastered_by_level: z.tuple([
    z.number().int(),
    z.number().int(),
    z.number().int(),
    z.number().int(),
    z.number().int(),
  ]),
  required_by_level: z.tuple([
    z.number().int(),
    z.number().int(),
    z.number().int(),
    z.number().int(),
    z.number().int(),
  ]),
  concepts: z.array(LearnerConceptMini).max(200),
  promotion: PromotionPreview.nullable(),
});
export type LearnerTrackView = z.infer<typeof LearnerTrackView>;
export const LearnerTrackList = S({
  tracks: z
    .array(
      S({
        track: TrackId,
        level: Level.nullable(),
        provisional: z.boolean(),
        needs_reconfirmation: z.boolean(),
        mastered: z.number().int().min(0),
      }),
    )
    .max(40),
});
export type LearnerTrackList = z.infer<typeof LearnerTrackList>;
export const EvidencePanel = S({
  concept_id: ConceptId,
  mastery: MasteryView,
  theta: ThetaView,
  gates: z.array(PromotionGate).max(10), // P(θ̃) ≥ 0.80 · 산입 형식 ≥ 3 · 서로 다른 study_day ≥ 2
  formats: z
    .array(
      S({
        format: FormatId,
        counted: z.boolean(),
        best_w_format: z.number(),
        best_w_grader: z.number(),
        event_ids: z.array(Ulid).max(20),
      }),
    )
    .max(30),
  study_days: z.array(StudyDay).max(400),
  recent: z.array(LedgerEventSummary).max(20),
  provisional_reasons_ko: z.array(z.string().max(200)).max(5),
});
export type EvidencePanel = z.infer<typeof EvidencePanel>;
export const ForecastView = S({
  window_days: z.literal(30),
  total_range: S({ low: z.number().int().min(0), high: z.number().int().min(0) }), // 일 단위 값 비표시(CR-05)
  band_source: z.enum(['user_history', 'default_15pct']),
  history_windows: z.number().int().min(0),
  method: z.enum(['model', 'observed']),
  method_provisional: z.literal(true),
  governor: S({
    daily_budget: z.number().int().min(0),
    lower_bound_exceeds_budget: z.boolean(),
    new_cards_throttled: z.boolean(),
  }),
  computed_at: EpochMs,
});
export type ForecastView = z.infer<typeof ForecastView>;
export const CalibrationView = S({
  window_days: z.number().int().min(7).max(365),
  cbm: S({ ratio: z.number().nullable(), n: z.number().int() }),
  brier: z.number().nullable(),
  ece: z.number().nullable(),
  overconfidence: z.number().nullable(),
  bins: z
    .array(S({ confidence: Confidence, n: z.number().int(), accuracy: z.number().min(0).max(1).nullable() }))
    .length(3),
  illusion_concepts: z.array(S({ concept_id: ConceptId, gap: z.number() })).max(50),
  declared_vs_proved: z
    .array(S({ track: TrackId, declared_level: Level.nullable(), proved_level: Level.nullable() }))
    .max(20),
  self_bias: S({ coefficient: z.number().nullable(), n: z.number().int() }).nullable(), // R2 (FR-QST-021)
});
export type CalibrationView = z.infer<typeof CalibrationView>;
export const CardListQuery = S({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  state: z.enum(['active', 'suspended', 'retired', 'leech']).optional(),
  concept_id: ConceptId.optional(),
});
export type CardListQuery = z.infer<typeof CardListQuery>;
export const CardActionBody = S({ reason: z.enum(['user', 'leech', 'irrelevant']) });
export type CardActionBody = z.infer<typeof CardActionBody>;
// [Brief 결정 §4.3] 표에 스키마 이름이 없는 쿼리(이름 고정)
export const CalibrationQuery = S({ window_days: z.coerce.number().int().min(7).max(365).default(30) });
export type CalibrationQuery = z.infer<typeof CalibrationQuery>;

export const LearnerConceptsGetRoute = defineRoute({
  id: 'learning.learner.concepts.get',
  ifId: 'IF-LR-040',
  method: 'GET',
  path: '/internal/v1/learner/concepts/{concept_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ concept_id: ConceptId }) },
  response: { 200: LearnerConceptState },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-PRG-008~011', 'FR-CUR-006', 'CR-22'],
});
export const LearnerConceptsEvidenceRoute = defineRoute({
  id: 'learning.learner.concepts.evidence',
  ifId: 'IF-LR-041',
  method: 'GET',
  path: '/internal/v1/learner/concepts/{concept_id}/evidence',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ concept_id: ConceptId }) },
  response: { 200: EvidencePanel },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-007', 'FR-PRG-009', 'FR-PRG-010'],
});
export const LearnerConceptsEventsRoute = defineRoute({
  id: 'learning.learner.concepts.events',
  ifId: 'IF-LR-042',
  method: 'GET',
  path: '/internal/v1/learner/concepts/{concept_id}/events',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { params: S({ concept_id: ConceptId }), query: PageQuery },
  response: { 200: Page(LedgerEventSummary) },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-007', 'FR-PRG-001'],
});
export const LearnerTracksListRoute = defineRoute({
  id: 'learning.learner.tracks.list',
  ifId: 'IF-LR-043',
  method: 'GET',
  path: '/internal/v1/learner/tracks',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: LearnerTrackList },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-PRG-013', 'FR-CUR-025'],
});
export const LearnerTracksGetRoute = defineRoute({
  id: 'learning.learner.tracks.get',
  ifId: 'IF-LR-044',
  method: 'GET',
  path: '/internal/v1/learner/tracks/{track}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ track: TrackId }) },
  response: { 200: LearnerTrackView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-013', 'FR-PRG-032', 'FR-CUR-025'],
});
export const LearnerTracksPromotionRoute = defineRoute({
  id: 'learning.learner.tracks.promotion',
  ifId: 'IF-LR-045',
  method: 'GET',
  path: '/internal/v1/learner/tracks/{track}/promotion',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ track: TrackId }) },
  response: { 200: PromotionPreview },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-012', 'FR-PRG-013', 'FR-PRG-032', 'FR-PRG-033', 'CR-18~21'],
});
export const LearnerForecastRoute = defineRoute({
  id: 'learning.learner.forecast',
  ifId: 'IF-LR-046',
  method: 'GET',
  path: '/internal/v1/learner/forecast',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: ForecastView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-018', 'CR-05'],
});
export const LearnerCalibrationRoute = defineRoute({
  id: 'learning.learner.calibration',
  ifId: 'IF-LR-047',
  method: 'GET',
  path: '/internal/v1/learner/calibration',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { query: CalibrationQuery },
  response: { 200: CalibrationView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-023~025', 'FR-DSH-010', 'FR-QST-021'],
});
export const LearnerCardsListRoute = defineRoute({
  id: 'learning.learner.cards.list',
  ifId: 'IF-LR-048',
  method: 'GET',
  path: '/internal/v1/learner/cards',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { query: CardListQuery },
  response: { 200: Page(CardView) },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-030', 'FR-PRG-031'],
});
export const LearnerCardsSuspendRoute = defineRoute({
  id: 'learning.learner.cards.suspend',
  ifId: 'IF-LR-049',
  method: 'POST',
  path: '/internal/v1/learner/cards/{card_id}:suspend',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ card_id: CardId }), body: CardActionBody },
  response: { 200: CardView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-031'],
});
export const LearnerCardsRetireRoute = defineRoute({
  id: 'learning.learner.cards.retire',
  ifId: 'IF-LR-050',
  method: 'POST',
  path: '/internal/v1/learner/cards/{card_id}:retire',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ card_id: CardId }), body: CardActionBody },
  response: { 200: CardView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-031'],
});
export const LearnerCardsResumeRoute = defineRoute({
  id: 'learning.learner.cards.resume',
  ifId: 'IF-LR-051',
  method: 'POST',
  path: '/internal/v1/learner/cards/{card_id}:resume',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ card_id: CardId }), body: CardActionBody },
  response: { 200: CardView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-031'],
});
export const LR_LEARNER_ROUTES = [
  LearnerConceptsGetRoute,
  LearnerConceptsEvidenceRoute,
  LearnerConceptsEventsRoute,
  LearnerTracksListRoute,
  LearnerTracksGetRoute,
  LearnerTracksPromotionRoute,
  LearnerForecastRoute,
  LearnerCalibrationRoute,
  LearnerCardsListRoute,
  LearnerCardsSuspendRoute,
  LearnerCardsRetireRoute,
  LearnerCardsResumeRoute,
] as const;
