import { describe, expect, it } from 'vitest';
import {
  CompleteWeeklyBody,
  DepthMapCells,
  DepthMapQuery,
  HomeAlert,
  HomePrimaryAction,
  InsightHome,
  MapLayer,
  PortfolioExport,
  PortfolioQuery,
  RadarView,
  WeeklyQuery,
  WeeklyReview,
} from '../../../src/http/learning/v1/insight.js';
import {
  CalibrationQuery,
  CalibrationView,
  CardActionBody,
  CardListQuery,
  CardView,
  EvidencePanel,
  LearnerConceptState,
  LearnerTrackView,
  PromotionPreview,
  ThetaView,
} from '../../../src/http/learning/v1/learner.js';
import { CloseSeasonBody, CreateSeasonBody, LdiSummary, SeasonView } from '../../../src/http/learning/v1/seasons.js';
import { DAY, forecastView, ldiSummary, NOW, PS, SHA, trackCap, ULID, withFields } from './samples.js';

const goal = { track: 'k8s', target_level: 3 };
const mastery = {
  status: 'learning',
  provisional: false,
  needs_reconfirmation: false,
  p: 0.7,
  formats_counted: ['ox'],
  distinct_study_days: 1,
};
const theta = { display: null, n_graded: 3, evidence_sufficient: false, display_min_events: 30 };
const cell = {
  card_id: 'k8s.probes:concept:r',
  concept_id: 'k8s.probes',
  facet: 'concept',
  response_mode: 'recognition',
  tier: 'A',
  status: 'active',
  due_at: null,
  retrievability: null,
  stability_days: null,
  reps: 0,
  lapses: 0,
  leech: false,
};
const profile = { policy_version: PS, ai_mode: 'OFFLINE', sp1_state: 'unknown' };
const promotion = {
  track: 'k8s',
  from_level: 2,
  to_level: 3,
  decision: 'not_ready',
  gates: [],
  blockers: [],
  exam: { eligible: false, retry_after: null, last: null },
  profile,
  cap: trackCap,
};
const weak = {
  concept_id: 'k8s.probes',
  title_ko: '프로브',
  reason_code: 'low_retention',
  nba: { kind: 'review', label_ko: '복습' },
};
const weekly = {
  week: '2026-W40',
  from: '2026-09-28',
  to: '2026-10-04',
  ldi: ldiSummary,
  weak_top5: [weak],
  misconceptions: [],
  mode_mix: [{ mode_id: 'M-01', blocks: 2, share: 0.5 }],
  entropy: { h: 1.2, h_min: 1 },
  calibration: { cbm_ratio: null, brier: null },
  forecast: forecastView,
  summary_ko: '이번 주 요약',
  completed: false,
  completed_at: null,
  reflection_md: null,
};

describe('learning seasons.ts · learner.ts · insight.ts', () => {
  it('UT-CON-185 CreateSeasonBody.weeks 5 거부·ThetaView·PromotionPreview.decision 4·CardListQuery 기본 50·CalibrationQuery 기본 30 [FR-PRG-013][FR-DSH-012]', () => {
    const season = { season_id: ULID, starts_on: DAY, weeks: 6, goals: [goal], premortem_ko: ['실패 상상'] };
    expect(CreateSeasonBody.safeParse(season).success).toBe(true);
    expect(CreateSeasonBody.safeParse({ ...season, weeks: 8 }).success).toBe(true);
    expect(CreateSeasonBody.safeParse({ ...season, weeks: 5 }).success).toBe(false);
    expect(CreateSeasonBody.safeParse({ ...season, weeks: 9 }).success).toBe(false);
    expect(CreateSeasonBody.safeParse({ ...season, goals: [] }).success).toBe(false);
    expect(CreateSeasonBody.safeParse({ ...season, extra: 1 }).success).toBe(false);
    expect(CloseSeasonBody.safeParse({ retro_md: '회고' }).success).toBe(true);
    expect(LdiSummary.safeParse(ldiSummary).success).toBe(true);
    expect(LdiSummary.safeParse({ ...ldiSummary, params: 'ldi' }).success).toBe(false);
    const view = { season: null, history: [], ldi: null };
    expect(SeasonView.safeParse(view).success).toBe(true);
    const active = {
      season_id: ULID,
      starts_on: DAY,
      ends_on: DAY,
      weeks: 6,
      state: 'active',
      goals: [{ ...goal, probability: null, required_minutes_per_week: null }],
      premortem_ko: [],
      retro_md: null,
    };
    expect(SeasonView.safeParse({ ...view, season: active }).success).toBe(true);
    expect(SeasonView.safeParse({ ...view, season: { ...active, state: 'paused' } }).success).toBe(false);

    expect(ThetaView.safeParse(theta).success).toBe(true);
    expect(ThetaView.safeParse({ ...theta, display: 0.4, evidence_sufficient: true }).success).toBe(true);
    expect(ThetaView.safeParse({ ...theta, display_min_events: 0 }).success).toBe(false);
    expect(ThetaView.safeParse({ ...theta, extra: 1 }).success).toBe(false);
    expect(PromotionPreview.shape.decision.options).toHaveLength(4);
    expect(PromotionPreview.safeParse(promotion).success).toBe(true);
    expect(PromotionPreview.safeParse(withFields(promotion, { decision: 'promote_provisional' })).success).toBe(true);
    expect(PromotionPreview.safeParse(withFields(promotion, { decision: 'maybe' })).success).toBe(false);
    expect(PromotionPreview.safeParse(withFields(promotion, { to_level: 6 })).success).toBe(false);
    expect(PromotionPreview.safeParse({ ...promotion, extra: 1 }).success).toBe(false);
    expect(CardView.safeParse(cell).success).toBe(true);
    expect(CardView.safeParse({ ...cell, card_id: 'bad' }).success).toBe(false);
    expect(CardActionBody.safeParse({ reason: 'user' }).success).toBe(true);
    expect(CardActionBody.safeParse({ reason: 'bored' }).success).toBe(false);
    expect(CardListQuery.parse({})).toEqual({ limit: 50 });
    expect(CardListQuery.parse({ limit: '200', state: 'leech' })).toEqual({ limit: 200, state: 'leech' });
    expect(CardListQuery.safeParse({ limit: '201' }).success).toBe(false);
    expect(CardListQuery.safeParse({ state: 'paused' }).success).toBe(false);
    expect(CalibrationQuery.parse({})).toEqual({ window_days: 30 });
    expect(CalibrationQuery.parse({ window_days: '7' })).toEqual({ window_days: 7 });
    expect(CalibrationQuery.safeParse({ window_days: '6' }).success).toBe(false);
    expect(CalibrationQuery.safeParse({ window_days: '366' }).success).toBe(false);
    expect(CalibrationQuery.safeParse({ window_days: '30', extra: 1 }).success).toBe(false);

    const learnerState = {
      concept_id: 'k8s.probes',
      lifecycle: 'CL-3',
      mastery,
      theta,
      competence: { mastered: false, retained: false, deepened: false, transferred: false, taught: false },
      cards: [cell],
      track_level: 2,
      rusty: false,
      entry_stage: 'theory',
      nba: null,
      last_activity_at: null,
    };
    expect(LearnerConceptState.safeParse(learnerState).success).toBe(true);
    expect(LearnerConceptState.safeParse({ ...learnerState, entry_stage: 'code' }).success).toBe(false);
    const track = {
      track: 'k8s',
      level: 2,
      provisional: false,
      needs_reconfirmation: false,
      promoted_at: null,
      mastered_by_level: [0, 0, 0, 0, 0],
      required_by_level: [1, 2, 3, 4, 5],
      concepts: [],
      promotion: null,
    };
    expect(LearnerTrackView.safeParse(track).success).toBe(true);
    expect(LearnerTrackView.safeParse({ ...track, mastered_by_level: [0, 0, 0, 0] }).success).toBe(false);
    const panel = {
      concept_id: 'k8s.probes',
      mastery,
      theta,
      gates: [],
      formats: [{ format: 'ox', counted: true, best_w_format: 0.5, best_w_grader: 1, event_ids: [ULID] }],
      study_days: [DAY],
      recent: [],
      provisional_reasons_ko: [],
    };
    expect(EvidencePanel.safeParse(panel).success).toBe(true);
    expect(EvidencePanel.safeParse({ ...panel, extra: 1 }).success).toBe(false);
    const calibration = {
      window_days: 30,
      cbm: { ratio: null, n: 0 },
      brier: null,
      ece: null,
      overconfidence: null,
      bins: [1, 2, 3].map((confidence) => ({ confidence, n: 0, accuracy: null })),
      illusion_concepts: [],
      declared_vs_proved: [],
      self_bias: null,
    };
    expect(CalibrationView.safeParse(calibration).success).toBe(true);
    expect(CalibrationView.safeParse({ ...calibration, bins: calibration.bins.slice(0, 2) }).success).toBe(false);
  });

  it('UT-CON-186 HomeAlert.action.href 상대경로만·DepthMapQuery.track 기본 all·WeeklyReview.weak_top5 6 거부·PortfolioQuery 기본 md [FR-DSH-001][FR-DSH-009]', () => {
    const alert = {
      code: 'due_overflow',
      severity: 'warn',
      message_ko: '복습이 쌓였습니다',
      action: { label_ko: '시작', href: '/x?y=1' },
    };
    expect(HomeAlert.safeParse(alert).success).toBe(true);
    expect(HomeAlert.safeParse({ ...alert, action: null }).success).toBe(true);
    expect(HomeAlert.safeParse({ ...alert, action: { label_ko: '시작', href: 'http://x' } }).success).toBe(false);
    expect(HomeAlert.safeParse({ ...alert, action: { label_ko: '시작', href: 'x?y=1' } }).success).toBe(false);
    expect(HomeAlert.safeParse({ ...alert, code: 'nope' }).success).toBe(false);
    expect(HomeAlert.safeParse({ ...alert, extra: 1 }).success).toBe(false);
    const primary = {
      kind: 'start_session',
      label_ko: '시작',
      suggested: { minutes: 15, energy: 'normal' },
      session_id: null,
    };
    expect(HomePrimaryAction.safeParse(primary).success).toBe(true);
    expect(HomePrimaryAction.safeParse({ ...primary, kind: 'quit' }).success).toBe(false);
    const home = {
      primary_action: primary,
      alerts: [alert],
      energy_default: 'normal',
      minutes_default: 15,
      today: { due_cards: 3, new_budget: 2, est_minutes: 15 },
      weekly_goal: { target_sessions: 3, done_sessions: 1, streak_weeks: 0, rest_tokens: 1 },
    };
    expect(InsightHome.safeParse(home).success).toBe(true);
    expect(InsightHome.safeParse({ ...home, alerts: [alert, alert, alert, alert] }).success).toBe(false);

    expect(MapLayer.options).toHaveLength(7);
    expect(DepthMapQuery.parse({})).toEqual({ track: 'all' });
    expect(DepthMapQuery.parse({ track: 'k8s', layers: 'mastery,rusty', as_of: '5' })).toEqual({
      track: 'k8s',
      layers: 'mastery,rusty',
      as_of: 5,
    });
    expect(DepthMapQuery.safeParse({ layers: 'Mastery' }).success).toBe(false);
    expect(DepthMapQuery.safeParse({ track: 'nope' }).success).toBe(false);
    const cells = { track: 'all', as_of: null, layers: ['mastery'], cells: [], edges: [] };
    expect(DepthMapCells.safeParse(cells).success).toBe(true);
    expect(DepthMapCells.safeParse({ ...cells, layers: ['video'] }).success).toBe(false);

    expect(WeeklyReview.safeParse(weekly).success).toBe(true);
    expect(
      WeeklyReview.safeParse(withFields(weekly, { weak_top5: Array.from({ length: 5 }, () => weak) })).success,
    ).toBe(true);
    expect(
      WeeklyReview.safeParse(withFields(weekly, { weak_top5: Array.from({ length: 6 }, () => weak) })).success,
    ).toBe(false);
    expect(WeeklyReview.safeParse(withFields(weekly, { week: '2026-40' })).success).toBe(false);
    expect(WeeklyReview.safeParse({ ...weekly, extra: 1 }).success).toBe(false);
    expect(WeeklyQuery.parse({})).toEqual({});
    expect(WeeklyQuery.parse({ week: '2026-W40' })).toEqual({ week: '2026-W40' });
    expect(WeeklyQuery.safeParse({ week: '2026-W54' }).success).toBe(false);
    expect(CompleteWeeklyBody.safeParse({ reflection_md: null, next_week_focus: [] }).success).toBe(true);
    expect(
      CompleteWeeklyBody.safeParse({
        reflection_md: null,
        next_week_focus: Array.from({ length: 6 }, () => 'k8s.probes'),
      }).success,
    ).toBe(false);
    expect(RadarView.safeParse({ at_risk: [], computed_at: NOW }).success).toBe(true);
    expect(PortfolioQuery.parse({})).toEqual({ format: 'md' });
    expect(PortfolioQuery.parse({ format: 'json' })).toEqual({ format: 'json' });
    expect(PortfolioQuery.safeParse({ format: 'html' }).success).toBe(false);
    expect(
      PortfolioExport.safeParse({ format: 'md', content: '# 포트폴리오', generated_at: NOW, sha256: SHA }).success,
    ).toBe(true);
    expect(
      PortfolioExport.safeParse({ format: 'md', content: 'x'.repeat(5_000_001), generated_at: NOW, sha256: SHA })
        .success,
    ).toBe(false);
  });
});
