import { z } from 'zod';
import { AiMode, Energy, MasteryStatus, ModeId, SessionMinutes, SlotId } from '../../../common/domain.js';
import { ConceptId, PathId, PolicySetId, TrackId, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';
import { AppealView } from '../../content/v1/grading.js';
import {
  ConfirmRatingAck,
  ConfirmRatingBody,
  CreateAppealBody,
  SelfAssessmentAck,
  SelfAssessmentBody,
  SelfGradeBody,
  SubmitAttemptBody,
} from './attempts.js';
import { AttemptOutcomePostSubmit } from './post-submit/attempt.js';
// biome-ignore lint/suspicious/noImportCycles: [Brief 결정 E1] 순환 import는 getter로 TDZ를 피한다(IF-LR-004 응답 ↔ BlockViewPreSubmit.block)
import { BlockViewPreSubmit } from './pre-submit/block.js';

export const SessionScope = z.discriminatedUnion('kind', [
  S({ kind: z.literal('all') }),
  S({ kind: z.literal('path'), path_id: PathId }),
  S({ kind: z.literal('tracks'), tracks: z.array(TrackId).min(1).max(20) }),
  S({ kind: z.literal('concepts'), concept_ids: z.array(ConceptId).min(1).max(50) }),
]);
export type SessionScope = z.infer<typeof SessionScope>;
export const SessionTemplate = z.enum([
  'standard',
  'placement',
  'verify',
  'promotion_exam',
  'weak_drill',
  'dday',
  'return',
]);
export type SessionTemplate = z.infer<typeof SessionTemplate>;
export const StartSessionBody = z.discriminatedUnion('template', [
  S({
    template: z.literal('standard'),
    session_id: Ulid,
    minutes: SessionMinutes,
    energy: Energy,
    scope: SessionScope,
  }), // R0(15분 고정)→R1
  S({ template: z.literal('placement'), session_id: Ulid, tracks: z.array(TrackId).min(1).max(20) }), // R1 FR-PRG-014 (트랙당 5~8문항 CAT)
  S({ template: z.literal('verify'), session_id: Ulid, concept_id: ConceptId }), // R1 FR-PRG-012 (3~5문항, 보정 엔진만)
  S({
    template: z.literal('promotion_exam'),
    session_id: Ulid,
    track: TrackId,
    from_level: z.number().int().min(1).max(4),
  }), // R3 FR-PRG-013 (12문항)
  S({ template: z.literal('weak_drill'), session_id: Ulid, minutes: SessionMinutes, scope: SessionScope }), // R3 FR-STD-030
  S({ template: z.literal('dday'), session_id: Ulid, minutes: SessionMinutes, energy: Energy }), // R3 FR-PRG-019
  S({ template: z.literal('return'), session_id: Ulid, minutes: SessionMinutes }), // R1 FR-PRG-020(최소)
]);
export type StartSessionBody = z.infer<typeof StartSessionBody>;
export const BlockKind = z.enum([
  'lesson',
  'items',
  'blank_note',
  'dialog',
  'lab',
  'case',
  'artifact',
  'jol',
  'reflection',
  'triage',
]);
export type BlockKind = z.infer<typeof BlockKind>;
export const BlockState = z.enum(['pending', 'active', 'awaiting_grade', 'done', 'skipped', 'swapped']);
export type BlockState = z.infer<typeof BlockState>;
export const ReasonChip = S({
  code: z.enum([
    'due',
    'keystone',
    'new',
    'weekly_quota',
    'wildcard',
    'boss',
    'warmup',
    'closer',
    'nba',
    'scope',
    'interleave',
    'dday',
    'return',
    'verify',
    'promotion',
    'placement',
    'weak',
  ]),
  label_ko: z.string().max(40),
  value: z.string().max(40).nullable(), // 'due · R 0.71' → {code:'due', label_ko:'복습 시점', value:'R 0.71'}
});
export type ReasonChip = z.infer<typeof ReasonChip>;
export const BlockSummary = S({
  block_id: Ulid,
  ord: z.number().int().min(0),
  slot: SlotId,
  mode_id: ModeId,
  kind: BlockKind,
  concept_id: ConceptId.nullable(),
  reason_chips: z.array(ReasonChip).max(4),
  locked: z.boolean(),
  state: BlockState,
  est_minutes: z.number().min(0),
  item_count: z.number().int().min(0),
  done_count: z.number().int().min(0),
  wildcard: z.string().max(60).nullable(),
  boss: z.boolean(),
});
export type BlockSummary = z.infer<typeof BlockSummary>;
export const SessionView = S({
  session_id: Ulid,
  template: SessionTemplate,
  state: z.enum(['active', 'paused', 'completed', 'abandoned']),
  scope: SessionScope.nullable(),
  minutes: SessionMinutes.nullable(),
  energy: Energy.nullable(),
  started_at: EpochMs,
  ended_at: EpochMs.nullable(),
  policy_version: PolicySetId,
  ai_mode_at_start: AiMode,
  relaxations: z.array(S({ rule: z.string().max(60), message_ko: z.string().max(200) })).max(10),
  blocks: z.array(BlockSummary).max(60),
  current_block_id: Ulid.nullable(),
  progress: S({ blocks_total: z.number().int(), blocks_done: z.number().int(), elapsed_ms: DurationMs }),
  pending_grades: z.number().int().min(0),
});
export type SessionView = z.infer<typeof SessionView>;
export const ActiveSessionView = S({ session: SessionView.nullable() });
export type ActiveSessionView = z.infer<typeof ActiveSessionView>;
export const BlockAlternatives = S({
  block_id: Ulid,
  candidates: z
    .array(
      S({
        candidate_id: Ulid,
        mode_id: ModeId,
        kind: BlockKind,
        concept_id: ConceptId.nullable(),
        reason_chips: z.array(ReasonChip).max(4),
        est_minutes: z.number().min(0),
      }),
    )
    .max(3),
});
export type BlockAlternatives = z.infer<typeof BlockAlternatives>;
export const SwapBlockBody = S({ candidate_id: Ulid });
export type SwapBlockBody = z.infer<typeof SwapBlockBody>;
export const SkipBlockBody = S({
  reason: z.enum(['too_hard', 'too_easy', 'not_now', 'irrelevant', 'other']).nullable(),
});
export type SkipBlockBody = z.infer<typeof SkipBlockBody>;
export const LockBlockBody = S({ locked: z.boolean() });
export type LockBlockBody = z.infer<typeof LockBlockBody>;
export const CompleteBlockBody = z.discriminatedUnion('kind', [
  S({
    kind: z.literal('lesson'),
    stages_done: z
      .array(z.enum(['theory', 'code', 'core']))
      .min(1)
      .max(3),
    duration_ms: DurationMs,
  }),
  S({ kind: z.literal('jol'), predictions: z.record(ConceptId, z.number().min(0).max(1)) }),
  S({ kind: z.literal('reflection'), answers_ko: z.array(z.string().max(2000)).max(5) }),
  S({ kind: z.literal('triage'), decisions: z.record(Ulid, z.enum(['link', 'probe', 'import', 'discard', 'later'])) }),
  S({ kind: z.literal('generic') }), // 남은 문항 없이 블록 종료
]);
export type CompleteBlockBody = z.infer<typeof CompleteBlockBody>;
export const CompleteSessionBody = S({ reason: z.enum(['finished', 'time_up', 'energy_limit']) });
export type CompleteSessionBody = z.infer<typeof CompleteSessionBody>;
export const SessionReport = S({
  session_id: Ulid,
  completed_at: EpochMs.nullable(),
  duration_ms: DurationMs,
  blocks_done: z.number().int(),
  blocks_total: z.number().int(),
  lines_ko: z.array(z.string().max(200)).min(1).max(3), // R0: 3줄 요약
  attempts: S({
    total: z.number().int(),
    correct: z.number().int(),
    partial: z.number().int(),
    incorrect: z.number().int(),
    pending: z.number().int(),
  }),
  mastery_changes: z
    .array(S({ concept_id: ConceptId, from: MasteryStatus, to: MasteryStatus, provisional: z.boolean() }))
    .max(50),
  jol: z
    .array(
      S({ concept_id: ConceptId, predicted: z.number().min(0).max(1), actual: z.number().min(0).max(1).nullable() }),
    )
    .max(20),
  modes: z.array(ModeId),
  next_due: S({ tomorrow: z.number().int(), week: z.number().int() }),
});
export type SessionReport = z.infer<typeof SessionReport>;

// idem = session_id
export const PracticeSessionsCreateRoute = defineRoute({
  id: 'learning.practice.sessions.create',
  ifId: 'IF-LR-001',
  method: 'POST',
  path: '/internal/v1/practice/sessions',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: StartSessionBody },
  response: { 201: SessionView },
  deadlineMs: 2000,
  freeze: 'D',
  slice: 'R0',
  fr: [
    'FR-STD-001~009',
    'FR-STD-032',
    'FR-STD-033',
    'FR-PRG-006',
    'FR-PRG-012',
    'FR-PRG-014',
    'FR-PRG-020',
    'FR-QST-013',
  ],
});
export const PracticeSessionsActiveRoute = defineRoute({
  id: 'learning.practice.sessions.active',
  ifId: 'IF-LR-002',
  method: 'GET',
  path: '/internal/v1/practice/sessions/active',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: ActiveSessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
export const PracticeSessionsGetRoute = defineRoute({
  id: 'learning.practice.sessions.get',
  ifId: 'IF-LR-003',
  method: 'GET',
  path: '/internal/v1/practice/sessions/{session_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-031'],
});
export const PracticeBlocksGetRoute = defineRoute({
  id: 'learning.practice.blocks.get',
  ifId: 'IF-LR-004',
  method: 'GET',
  path: '/internal/v1/practice/sessions/{session_id}/blocks/{block_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }) },
  response: {
    get 200() {
      return BlockViewPreSubmit;
    },
  }, // [Brief 결정 E1] 순환 import TDZ 회피
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-010~018', 'FR-UX-016'],
});
export const PracticeBlocksAlternativesRoute = defineRoute({
  id: 'learning.practice.blocks.alternatives',
  ifId: 'IF-LR-005',
  method: 'GET',
  path: '/internal/v1/practice/sessions/{session_id}/blocks/{block_id}/alternatives',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }) },
  response: { 200: BlockAlternatives },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
export const PracticeBlocksSwapRoute = defineRoute({
  id: 'learning.practice.blocks.swap',
  ifId: 'IF-LR-006',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}/blocks/{block_id}:swap',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: SwapBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
export const PracticeBlocksSkipRoute = defineRoute({
  id: 'learning.practice.blocks.skip',
  ifId: 'IF-LR-007',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}/blocks/{block_id}:skip',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: SkipBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
export const PracticeBlocksLockRoute = defineRoute({
  id: 'learning.practice.blocks.lock',
  ifId: 'IF-LR-008',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}/blocks/{block_id}:lock',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: LockBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-006'],
});
export const PracticeBlocksCompleteRoute = defineRoute({
  id: 'learning.practice.blocks.complete',
  ifId: 'IF-LR-009',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}/blocks/{block_id}:complete',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, block_id: Ulid }), body: CompleteBlockBody },
  response: { 200: BlockSummary },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-010', 'FR-CUR-005~008', 'FR-PRG-026'],
});
// idem = attempt_id
export const PracticeAttemptsSubmitRoute = defineRoute({
  id: 'learning.practice.attempts.submit',
  ifId: 'IF-LR-010',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}/attempts',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }), body: SubmitAttemptBody },
  response: { 200: AttemptOutcomePostSubmit },
  deadlineMs: 2900,
  freeze: 'D',
  slice: 'R0',
  fr: [
    'FR-QST-017~026',
    'FR-PRG-001',
    'FR-PRG-002',
    'FR-PRG-004',
    'FR-PRG-005',
    'FR-PRG-007',
    'FR-PRG-008',
    'FR-PRG-009',
    'FR-PRG-011',
    'FR-LAB-004',
    'FR-LAB-013',
    'FR-STD-004',
    'FR-STD-005',
  ],
});
export const PracticeAttemptsSelfGradeRoute = defineRoute({
  id: 'learning.practice.attempts.self_grade',
  ifId: 'IF-LR-011',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}/attempts/{attempt_id}/self-grade',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid, attempt_id: Ulid }), body: SelfGradeBody },
  response: { 200: AttemptOutcomePostSubmit },
  deadlineMs: 2900,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-QST-017', 'FR-QST-021', 'FR-STD-019'],
});
export const PracticeSessionsPauseRoute = defineRoute({
  id: 'learning.practice.sessions.pause',
  ifId: 'IF-LR-012',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}:pause',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
export const PracticeSessionsResumeRoute = defineRoute({
  id: 'learning.practice.sessions.resume',
  ifId: 'IF-LR-013',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}:resume',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
export const PracticeSessionsCompleteRoute = defineRoute({
  id: 'learning.practice.sessions.complete',
  ifId: 'IF-LR-014',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}:complete',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }), body: CompleteSessionBody },
  response: { 200: SessionReport },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-DSH-008', 'FR-PRG-022', 'FR-PRG-026'],
});
export const PracticeSessionsAbandonRoute = defineRoute({
  id: 'learning.practice.sessions.abandon',
  ifId: 'IF-LR-015',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}:abandon',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
export const PracticeSessionsReportRoute = defineRoute({
  id: 'learning.practice.sessions.report',
  ifId: 'IF-LR-016',
  method: 'GET',
  path: '/internal/v1/practice/sessions/{session_id}/report',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ session_id: Ulid }) },
  response: { 200: SessionReport },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-DSH-008'],
});
export const PracticeEvidenceConfirmRatingRoute = defineRoute({
  id: 'learning.practice.evidence.confirm_rating',
  ifId: 'IF-LR-017',
  method: 'POST',
  path: '/internal/v1/practice/evidence/{ledger_event_id}:confirm-rating',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ ledger_event_id: Ulid }), body: ConfirmRatingBody },
  response: { 200: ConfirmRatingAck },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-020'],
});
// idem = appeal_id
export const PracticeAppealsCreateRoute = defineRoute({
  id: 'learning.practice.appeals.create',
  ifId: 'IF-LR-018',
  method: 'POST',
  path: '/internal/v1/practice/appeals',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: CreateAppealBody },
  response: { 201: AppealView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-012'],
});
// idem = assessment_id
export const PracticeSelfAssessmentsCreateRoute = defineRoute({
  id: 'learning.practice.self_assessments.create',
  ifId: 'IF-LR-019',
  method: 'POST',
  path: '/internal/v1/practice/sessions/{session_id}/self-assessments',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ session_id: Ulid }), body: SelfAssessmentBody },
  response: { 201: SelfAssessmentAck },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-QST-021'],
});
export const LR_SESSIONS_ROUTES = [
  PracticeSessionsCreateRoute,
  PracticeSessionsActiveRoute,
  PracticeSessionsGetRoute,
  PracticeBlocksGetRoute,
  PracticeBlocksAlternativesRoute,
  PracticeBlocksSwapRoute,
  PracticeBlocksSkipRoute,
  PracticeBlocksLockRoute,
  PracticeBlocksCompleteRoute,
  PracticeAttemptsSubmitRoute,
  PracticeAttemptsSelfGradeRoute,
  PracticeSessionsPauseRoute,
  PracticeSessionsResumeRoute,
  PracticeSessionsCompleteRoute,
  PracticeSessionsAbandonRoute,
  PracticeSessionsReportRoute,
  PracticeEvidenceConfirmRatingRoute,
  PracticeAppealsCreateRoute,
  PracticeSelfAssessmentsCreateRoute,
] as const;
