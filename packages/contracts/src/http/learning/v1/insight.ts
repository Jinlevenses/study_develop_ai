import { z } from 'zod';
import { Energy, Level, Lifecycle, MasteryStatus, ModeId, SessionMinutes } from '../../../common/domain.js';
import { BlueprintId, ConceptId, MisconceptionId, Sha256Hex, TrackId, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs, IsoWeek, StudyDay } from '../../../common/time.js';
import { ForecastView } from './learner.js';
import { LdiSummary, SeasonView } from './seasons.js';

export const HomePrimaryAction = S({
  kind: z.enum(['start_session', 'resume_session', 'onboarding', 'return_mode', 'paused']),
  label_ko: z.string().max(60),
  suggested: S({ minutes: SessionMinutes, energy: Energy }).nullable(),
  session_id: Ulid.nullable(),
});
export type HomePrimaryAction = z.infer<typeof HomePrimaryAction>;
export const HomeAlert = S({
  code: z.enum([
    'due_overflow',
    'return_mode',
    'paused',
    'promotion_ready',
    'verify_suggested',
    'weekly_review_due',
    'pending_grades',
    'rating_confirm',
    'policy_switch_available',
    'onboarding',
  ]),
  severity: z.enum(['info', 'warn', 'critical']),
  message_ko: z.string().max(200),
  action: S({ label_ko: z.string().max(40), href: z.string().regex(/^\/(?!\/)[A-Za-z0-9/_$.?=&-]*$/) }).nullable(),
});
export type HomeAlert = z.infer<typeof HomeAlert>;
export const InsightHome = S({
  primary_action: HomePrimaryAction,
  alerts: z.array(HomeAlert).max(3),
  energy_default: Energy,
  minutes_default: SessionMinutes,
  today: S({
    due_cards: z.number().int().min(0),
    new_budget: z.number().int().min(0),
    est_minutes: z.number().int().min(0),
  }),
  weekly_goal: S({
    target_sessions: z.number().int().min(1).max(14),
    done_sessions: z.number().int().min(0),
    streak_weeks: z.number().int().min(0),
    rest_tokens: z.number().int().min(0),
  }),
});
export type InsightHome = z.infer<typeof InsightHome>;
export const MapLayer = z.enum([
  'mastery',
  'retention',
  'illusion',
  'foundation_crack',
  'revalidation',
  'rusty',
  'blueprint',
]);
export type MapLayer = z.infer<typeof MapLayer>;
export const DepthMapQuery = S({
  track: z.union([TrackId, z.literal('all')]).default('all'),
  layers: z
    .string()
    .regex(/^[a-z_]+(,[a-z_]+)*$/)
    .optional(), // 쉼표 목록(MapLayer)
  as_of: z.coerce.number().int().min(0).optional(), // 과거 오버레이(FR-DSH-005)
  blueprint_id: BlueprintId.optional(),
});
export type DepthMapQuery = z.infer<typeof DepthMapQuery>;
export const DepthMapCells = S({
  track: z.union([TrackId, z.literal('all')]),
  as_of: EpochMs.nullable(),
  layers: z.array(MapLayer),
  cells: z
    .array(
      S({
        concept_id: ConceptId,
        track: TrackId,
        level: Level,
        lifecycle: Lifecycle,
        mastery: MasteryStatus,
        provisional: z.boolean(),
        retention: z.number().min(0).max(1).nullable(),
        rusty: z.boolean(),
        illusion: z.boolean(),
        foundation_crack: z.boolean(),
        needs_revalidation: z.boolean(),
        depth_ring: z.number().int().min(0).max(4),
        star: z.boolean(),
        blueprint_weight: z.number().min(0).nullable(),
      }),
    )
    .max(2000),
  edges: z.array(S({ from: ConceptId, to: ConceptId })).max(5000),
});
export type DepthMapCells = z.infer<typeof DepthMapCells>;
export const WeeklyReview = S({
  week: IsoWeek,
  from: StudyDay,
  to: StudyDay,
  ldi: LdiSummary,
  weak_top5: z
    .array(
      S({
        concept_id: ConceptId,
        title_ko: z.string(),
        reason_code: z.enum(['low_retention', 'illusion', 'misconception', 'foundation_crack', 'leech']),
        nba: S({
          kind: z.enum(['learn', 'practice', 'verify', 'dig', 'case', 'review', 'revalidate']),
          label_ko: z.string(),
        }),
      }),
    )
    .max(5),
  misconceptions: z
    .array(S({ mc_id: MisconceptionId, count: z.number().int(), meta_family: z.string().max(60).nullable() }))
    .max(20),
  mode_mix: z.array(S({ mode_id: ModeId, blocks: z.number().int(), share: z.number().min(0).max(1) })).max(21),
  entropy: S({ h: z.number(), h_min: z.number() }),
  calibration: S({ cbm_ratio: z.number().nullable(), brier: z.number().nullable() }),
  forecast: ForecastView,
  summary_ko: z.string().max(2000), // 템플릿 문장(v1 AI 0, X-23)
  completed: z.boolean(),
  completed_at: EpochMs.nullable(),
  reflection_md: z.string().nullable(),
});
export type WeeklyReview = z.infer<typeof WeeklyReview>;
export const CompleteWeeklyBody = S({
  reflection_md: z.string().max(8000).nullable(),
  next_week_focus: z.array(ConceptId).max(5),
});
export type CompleteWeeklyBody = z.infer<typeof CompleteWeeklyBody>;
export const RadarView = S({
  at_risk: z
    .array(
      S({
        concept_id: ConceptId,
        retention: z.number().min(0).max(1),
        due_at: EpochMs,
        reason_ko: z.string().max(100),
      }),
    )
    .max(50),
  computed_at: EpochMs,
});
export type RadarView = z.infer<typeof RadarView>;
export const PortfolioExport = S({
  format: z.enum(['md', 'json']),
  content: z.string().max(5_000_000),
  generated_at: EpochMs,
  sha256: Sha256Hex,
});
export type PortfolioExport = z.infer<typeof PortfolioExport>;
// [Brief 결정 §4.3] 표에 스키마 이름이 없는 쿼리(이름 고정)
export const WeeklyQuery = S({ week: IsoWeek.optional() });
export type WeeklyQuery = z.infer<typeof WeeklyQuery>;
export const PortfolioQuery = S({ format: z.enum(['md', 'json']).default('md') });
export type PortfolioQuery = z.infer<typeof PortfolioQuery>;

export const InsightHomeRoute = defineRoute({
  id: 'learning.insight.home',
  ifId: 'IF-LR-055',
  method: 'GET',
  path: '/internal/v1/insight/home',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: InsightHome },
  deadlineMs: 1200,
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-DSH-001', 'FR-PRG-006', 'FR-PRG-020~022'],
});
export const InsightDepthMapRoute = defineRoute({
  id: 'learning.insight.depth_map',
  ifId: 'IF-LR-056',
  method: 'GET',
  path: '/internal/v1/insight/depth-map',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { query: DepthMapQuery },
  response: { 200: DepthMapCells },
  deadlineMs: 1200,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-003~006', 'FR-PRG-024'],
});
export const InsightWeeklyRoute = defineRoute({
  id: 'learning.insight.weekly',
  ifId: 'IF-LR-057',
  method: 'GET',
  path: '/internal/v1/insight/weekly',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { query: WeeklyQuery },
  response: { 200: WeeklyReview },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-009', 'FR-DSH-011', 'FR-PRG-017', 'FR-STD-009', 'CR-25'],
});
export const InsightWeeklyCompleteRoute = defineRoute({
  id: 'learning.insight.weekly_complete',
  ifId: 'IF-LR-058',
  method: 'POST',
  path: '/internal/v1/insight/weekly/{week}:complete',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ week: IsoWeek }), body: CompleteWeeklyBody },
  response: { 200: WeeklyReview },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-009'],
});
export const InsightSeasonRoute = defineRoute({
  id: 'learning.insight.season',
  ifId: 'IF-LR-059',
  method: 'GET',
  path: '/internal/v1/insight/season',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SeasonView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-012'],
});
export const InsightRadarRoute = defineRoute({
  id: 'learning.insight.radar',
  ifId: 'IF-LR-060',
  method: 'GET',
  path: '/internal/v1/insight/radar',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: RadarView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-013'],
});
export const InsightPortfolioRoute = defineRoute({
  id: 'learning.insight.portfolio',
  ifId: 'IF-LR-061',
  method: 'GET',
  path: '/internal/v1/insight/portfolio',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { query: PortfolioQuery },
  response: { 200: PortfolioExport },
  deadlineMs: 10000,
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-014'],
});
export const LR_INSIGHT_ROUTES = [
  InsightHomeRoute,
  InsightDepthMapRoute,
  InsightWeeklyRoute,
  InsightWeeklyCompleteRoute,
  InsightSeasonRoute,
  InsightRadarRoute,
  InsightPortfolioRoute,
] as const;
