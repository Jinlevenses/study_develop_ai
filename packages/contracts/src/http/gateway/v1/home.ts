import { z } from 'zod';
import { DegradedPart } from '../../../common/degraded.js';
import { AiMode, Energy, SessionMinutes } from '../../../common/domain.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { HomeAlert, HomePrimaryAction } from '../../learning/v1/insight.js';
import { ForecastView } from '../../learning/v1/learner.js';
import { Banner } from '../../ops/v1/health.js';

// HomePrimaryAction·HomeAlert의 정본은 learning(`http/learning/v1/insight.ts`, IF-LR-055) — 여기서는 import만 한다.
export const HomeView = S({
  primary_action: HomePrimaryAction,
  alerts: z.array(HomeAlert).max(3), // FR-DSH-001: 홈 요소 ≤ 5
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
  ai_chip: S({
    mode: AiMode,
    label_ko: z.enum(['AI: 전체', 'AI: 판단만', 'AI: 생성만', 'AI: 오프라인']),
    degraded_badge: z.boolean(),
  }),
  banners: z.array(Banner).max(5), // Banner = IF-OP-001 스키마(§8.3)
  degraded: z.array(DegradedPart),
});
export type HomeView = z.infer<typeof HomeView>;
// 하위 ⊕ IF-LR-055 + IF-AI-039 + IF-OP-001
export const HomeGetRoute = defineRoute({
  id: 'gateway.home.get',
  ifId: 'IF-GW-010',
  method: 'GET',
  path: '/api/v1/home',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: HomeView },
  deadlineMs: 1500,
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-DSH-001', 'FR-AI-002', 'FR-SET-017'],
});
// 하위 = IF-LR-046
export const HomeForecastRoute = defineRoute({
  id: 'gateway.home.forecast',
  ifId: 'IF-GW-011',
  method: 'GET',
  path: '/api/v1/home/forecast',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: ForecastView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-018'],
});
export const GW_HOME_ROUTES = [HomeGetRoute, HomeForecastRoute] as const;
