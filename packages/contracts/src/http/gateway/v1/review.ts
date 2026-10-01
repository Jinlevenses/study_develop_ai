import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { IsoWeek } from '../../../common/time.js';
import {
  CompleteWeeklyBody,
  PortfolioExport,
  PortfolioQuery,
  RadarView,
  WeeklyQuery,
  WeeklyReview,
} from '../../learning/v1/insight.js';
import { CalibrationQuery, CalibrationView } from '../../learning/v1/learner.js';
import { CloseSeasonBody, CreateSeasonBody, SeasonView } from '../../learning/v1/seasons.js';

// 하위 = IF-LR-057
export const ReviewWeeklyRoute = defineRoute({
  id: 'gateway.review.weekly',
  ifId: 'IF-GW-075',
  method: 'GET',
  path: '/api/v1/review/weekly',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: WeeklyQuery },
  response: { 200: WeeklyReview },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-009', 'FR-DSH-011', 'FR-PRG-017'],
});
// 하위 = IF-LR-058
export const ReviewWeeklyCompleteRoute = defineRoute({
  id: 'gateway.review.weekly_complete',
  ifId: 'IF-GW-076',
  method: 'POST',
  path: '/api/v1/review/weekly/{week}:complete',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ week: IsoWeek }), body: CompleteWeeklyBody },
  response: { 200: WeeklyReview },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-009'],
});
// 하위 = IF-LR-047
export const ReviewCalibrationRoute = defineRoute({
  id: 'gateway.review.calibration',
  ifId: 'IF-GW-077',
  method: 'GET',
  path: '/api/v1/review/calibration',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: CalibrationQuery },
  response: { 200: CalibrationView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-010', 'FR-PRG-023~025'],
});
// 하위 = IF-LR-059
export const SeasonGetRoute = defineRoute({
  id: 'gateway.season.get',
  ifId: 'IF-GW-078',
  method: 'GET',
  path: '/api/v1/season',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SeasonView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-012'],
});
// idem = season_id
// 하위 = IF-LR-032
export const SeasonCreateRoute = defineRoute({
  id: 'gateway.season.create',
  ifId: 'IF-GW-079',
  method: 'POST',
  path: '/api/v1/season',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: CreateSeasonBody },
  response: { 201: SeasonView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-012'],
});
// 하위 = IF-LR-033
export const SeasonCloseRoute = defineRoute({
  id: 'gateway.season.close',
  ifId: 'IF-GW-080',
  method: 'POST',
  path: '/api/v1/season/{season_id}:close',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ season_id: Ulid }), body: CloseSeasonBody },
  response: { 200: SeasonView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-012'],
});
// 하위 = IF-LR-060
export const ReviewRadarRoute = defineRoute({
  id: 'gateway.review.radar',
  ifId: 'IF-GW-081',
  method: 'GET',
  path: '/api/v1/review/radar',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: RadarView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-013'],
});
// 하위 = IF-LR-061
export const ReviewPortfolioRoute = defineRoute({
  id: 'gateway.review.portfolio',
  ifId: 'IF-GW-082',
  method: 'GET',
  path: '/api/v1/review/portfolio',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: PortfolioQuery },
  response: { 200: PortfolioExport },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-014'],
});
export const GW_REVIEW_ROUTES = [
  ReviewWeeklyRoute,
  ReviewWeeklyCompleteRoute,
  ReviewCalibrationRoute,
  SeasonGetRoute,
  SeasonCreateRoute,
  SeasonCloseRoute,
  ReviewRadarRoute,
  ReviewPortfolioRoute,
] as const;
