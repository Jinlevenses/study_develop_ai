import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { SelfAssessmentAck, SelfAssessmentBody, SelfGradeBody, SubmitAttemptBody } from '../../learning/v1/attempts.js';
import { AttemptOutcomePostSubmit } from '../../learning/v1/post-submit/attempt.js';
import { BlockViewPreSubmit } from '../../learning/v1/pre-submit/block.js';
import {
  ActiveSessionView,
  BlockAlternatives,
  BlockSummary,
  CompleteBlockBody,
  CompleteSessionBody,
  LockBlockBody,
  SessionReport,
  SessionView,
  SkipBlockBody,
  StartSessionBody,
  SwapBlockBody,
} from '../../learning/v1/sessions.js';

// 하위 = IF-LR-001
export const SessionsCreateRoute = defineRoute({
  id: 'gateway.sessions.create',
  ifId: 'IF-GW-015',
  method: 'POST',
  path: '/api/v1/sessions',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: StartSessionBody },
  response: { 201: SessionView },
  deadlineMs: 2000,
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-001~009', 'FR-STD-032', 'FR-PRG-012~014'],
});
// 하위 = IF-LR-002
export const SessionsActiveRoute = defineRoute({
  id: 'gateway.sessions.active',
  ifId: 'IF-GW-016',
  method: 'GET',
  path: '/api/v1/sessions/active',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: ActiveSessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
// 하위 = IF-LR-003
export const SessionsGetRoute = defineRoute({
  id: 'gateway.sessions.get',
  ifId: 'IF-GW-017',
  method: 'GET',
  path: '/api/v1/sessions/{session_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-031'],
});
// 하위 = IF-LR-004
export const SessionsBlockRoute = defineRoute({
  id: 'gateway.sessions.block',
  ifId: 'IF-GW-018',
  method: 'GET',
  path: '/api/v1/sessions/{session_id}/blocks/{block_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }) },
  response: { 200: BlockViewPreSubmit },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-010~013', 'FR-UX-016'],
});
// 하위 = IF-LR-005
export const SessionsBlockAlternativesRoute = defineRoute({
  id: 'gateway.sessions.block_alternatives',
  ifId: 'IF-GW-019',
  method: 'GET',
  path: '/api/v1/sessions/{session_id}/blocks/{block_id}/alternatives',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }) },
  response: { 200: BlockAlternatives },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
// idem = attempt_id
// 하위 = IF-LR-010
export const SessionsAttemptsSubmitRoute = defineRoute({
  id: 'gateway.sessions.attempts.submit',
  ifId: 'IF-GW-020',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}/attempts',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }), body: SubmitAttemptBody },
  response: { 200: AttemptOutcomePostSubmit },
  deadlineMs: 2900,
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-QST-017', 'FR-QST-019', 'FR-QST-022~026', 'FR-PRG-001', 'FR-PRG-002', 'FR-LAB-004'],
});
// 하위 = IF-LR-011
export const SessionsAttemptsSelfGradeRoute = defineRoute({
  id: 'gateway.sessions.attempts.self_grade',
  ifId: 'IF-GW-021',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}/attempts/{attempt_id}/self-grade',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, attempt_id: Ulid }), body: SelfGradeBody },
  response: { 200: AttemptOutcomePostSubmit },
  deadlineMs: 2900,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-017', 'FR-QST-021'],
});
// 하위 = IF-LR-006
export const SessionsBlockSwapRoute = defineRoute({
  id: 'gateway.sessions.block_swap',
  ifId: 'IF-GW-022',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}/blocks/{block_id}:swap',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: SwapBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
// 하위 = IF-LR-007
export const SessionsBlockSkipRoute = defineRoute({
  id: 'gateway.sessions.block_skip',
  ifId: 'IF-GW-023',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}/blocks/{block_id}:skip',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: SkipBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
// 하위 = IF-LR-008
export const SessionsBlockLockRoute = defineRoute({
  id: 'gateway.sessions.block_lock',
  ifId: 'IF-GW-024',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}/blocks/{block_id}:lock',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: LockBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
// 하위 = IF-LR-009
export const SessionsBlockCompleteRoute = defineRoute({
  id: 'gateway.sessions.block_complete',
  ifId: 'IF-GW-025',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}/blocks/{block_id}:complete',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: CompleteBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-010', 'FR-CUR-005~008', 'FR-PRG-026'],
});
// 하위 = IF-LR-012
export const SessionsPauseRoute = defineRoute({
  id: 'gateway.sessions.pause',
  ifId: 'IF-GW-026',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}:pause',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
// 하위 = IF-LR-013
export const SessionsResumeRoute = defineRoute({
  id: 'gateway.sessions.resume',
  ifId: 'IF-GW-027',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}:resume',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
// 하위 = IF-LR-014
export const SessionsCompleteRoute = defineRoute({
  id: 'gateway.sessions.complete',
  ifId: 'IF-GW-028',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}:complete',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }), body: CompleteSessionBody },
  response: { 200: SessionReport },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-DSH-008', 'FR-PRG-026'],
});
// 하위 = IF-LR-015
export const SessionsAbandonRoute = defineRoute({
  id: 'gateway.sessions.abandon',
  ifId: 'IF-GW-029',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}:abandon',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
// 하위 = IF-LR-016
export const SessionsReportRoute = defineRoute({
  id: 'gateway.sessions.report',
  ifId: 'IF-GW-030',
  method: 'GET',
  path: '/api/v1/sessions/{session_id}/report',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionReport },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-DSH-008'],
});
// 하위 = IF-LR-019
export const SessionsSelfAssessmentsRoute = defineRoute({
  id: 'gateway.sessions.self_assessments',
  ifId: 'IF-GW-031',
  method: 'POST',
  path: '/api/v1/sessions/{session_id}/self-assessments',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }), body: SelfAssessmentBody },
  response: { 201: SelfAssessmentAck },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-021'],
});
export const GW_SESSIONS_ROUTES = [
  SessionsCreateRoute,
  SessionsActiveRoute,
  SessionsGetRoute,
  SessionsBlockRoute,
  SessionsBlockAlternativesRoute,
  SessionsAttemptsSubmitRoute,
  SessionsAttemptsSelfGradeRoute,
  SessionsBlockSwapRoute,
  SessionsBlockSkipRoute,
  SessionsBlockLockRoute,
  SessionsBlockCompleteRoute,
  SessionsPauseRoute,
  SessionsResumeRoute,
  SessionsCompleteRoute,
  SessionsAbandonRoute,
  SessionsReportRoute,
  SessionsSelfAssessmentsRoute,
] as const;
