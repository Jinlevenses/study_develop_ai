import { z } from 'zod';
import { ItemId, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { AppealView } from '../../content/v1/grading.js';
import { CreateReportBody, ReportView } from '../../content/v1/itembank.js';
import { JudgeCardPostSubmit } from '../../content/v1/post-submit/judge-card.js';
import { HintQuery, HintViewPreSubmit } from '../../content/v1/pre-submit/hint.js';
import { CreateRunBody, RunnerPlatformView, RunResultView } from '../../content/v1/runner.js';
import { AppealBody, ConfirmRatingAck, ConfirmRatingBody } from '../../learning/v1/attempts.js';

// 하위 = IF-CT-056
export const ItemsHintRoute = defineRoute({
  id: 'gateway.items.hint',
  ifId: 'IF-GW-032',
  method: 'GET',
  path: '/api/v1/items/{item_id}/hints/{step}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ item_id: ItemId, step: z.coerce.number().int().min(1).max(4) }), query: HintQuery },
  response: { 200: HintViewPreSubmit },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-LAB-005', 'FR-QST-026'],
});
// idem = report_id
// 하위 = IF-CT-057
export const ItemsReportRoute = defineRoute({
  id: 'gateway.items.report',
  ifId: 'IF-GW-033',
  method: 'POST',
  path: '/api/v1/items/{item_id}/reports',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ item_id: ItemId }), body: CreateReportBody },
  response: { 201: ReportView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-016'],
});
// 하위 = IF-LR-017
export const EvidenceConfirmRatingRoute = defineRoute({
  id: 'gateway.evidence.confirm_rating',
  ifId: 'IF-GW-034',
  method: 'POST',
  path: '/api/v1/evidence/events/{ledger_event_id}:confirm-rating',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ ledger_event_id: Ulid }), body: ConfirmRatingBody },
  response: { 200: ConfirmRatingAck },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-020'],
});
// 하위 = IF-CT-045
export const VerdictsGetRoute = defineRoute({
  id: 'gateway.verdicts.get',
  ifId: 'IF-GW-035',
  method: 'GET',
  path: '/api/v1/verdicts/{verdict_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ verdict_id: Ulid }) },
  response: { 200: JudgeCardPostSubmit },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-011', 'FR-UX-007'],
});
// idem = appeal_id
// 하위 = IF-LR-018 (`verdict_id`는 경로 → 본문 병합)
export const VerdictsAppealRoute = defineRoute({
  id: 'gateway.verdicts.appeal',
  ifId: 'IF-GW-036',
  method: 'POST',
  path: '/api/v1/verdicts/{verdict_id}/appeals',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ verdict_id: Ulid }), body: AppealBody },
  response: { 201: AppealView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-012'],
});
// 하위 = IF-CT-044
export const AppealsGetRoute = defineRoute({
  id: 'gateway.appeals.get',
  ifId: 'IF-GW-037',
  method: 'GET',
  path: '/api/v1/appeals/{appeal_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ appeal_id: Ulid }) },
  response: { 200: AppealView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-012'],
});
// idem = run_id
// 하위 = IF-CT-050(`source_kind` = `learner` 강제)
export const LabsRunRoute = defineRoute({
  id: 'gateway.labs.run',
  ifId: 'IF-GW-038',
  method: 'POST',
  path: '/api/v1/labs/runs',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: CreateRunBody },
  response: { 200: RunResultView },
  deadlineMs: 6000,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-LAB-001~003', 'FR-LAB-006', 'FR-LAB-007', 'FR-LAB-013', 'FR-LAB-016'],
});
// 하위 = IF-CT-051
export const LabsPlatformRoute = defineRoute({
  id: 'gateway.labs.platform',
  ifId: 'IF-GW-039',
  method: 'GET',
  path: '/api/v1/labs/platform',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: RunnerPlatformView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-LAB-012', 'NFR-PORT-001'],
});
export const GW_PRACTICE_ITEMS_ROUTES = [
  ItemsHintRoute,
  ItemsReportRoute,
  EvidenceConfirmRatingRoute,
  VerdictsGetRoute,
  VerdictsAppealRoute,
  AppealsGetRoute,
  LabsRunRoute,
  LabsPlatformRoute,
] as const;
