import { z } from 'zod';
import { Confidence } from '../../../common/domain.js';
import { ArtifactId, CaseId, ItemId, ObjKey, Sha256Hex, Ulid } from '../../../common/ids.js';
import { AttemptResponse } from '../../../common/practice.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { DialogView } from './dialogs.js';
import { ArtifactRunPostSubmit } from './post-submit/artifact.js';
import { AttemptOutcomePostSubmit } from './post-submit/attempt.js';
import { CaseRunPostSubmit } from './post-submit/case.js';
import { ArtifactRunPreSubmit } from './pre-submit/artifact.js';
import { CaseRunPreSubmit } from './pre-submit/case.js';

export const StartCaseRunBody = S({
  run_id: Ulid,
  case_id: CaseId,
  session_id: Ulid.nullable(),
  block_id: Ulid.nullable(),
  variant_seed: z.number().int().min(0).max(2_147_483_647).nullable(),
}); // null = 서버가 미노출 변형 선택(FR-STD-034)
export type StartCaseRunBody = z.infer<typeof StartCaseRunBody>;
export const CaseEvidenceRequestBody = S({ request_id: Ulid, evidence_key: ObjKey });
export type CaseEvidenceRequestBody = z.infer<typeof CaseEvidenceRequestBody>;
export const LongTaskAttemptBody = S({
  attempt_id: Ulid,
  item_id: ItemId,
  item_content_hash: Sha256Hex,
  response: AttemptResponse,
  confidence: Confidence.nullable(),
  presented_at: EpochMs,
  answered_at: EpochMs,
});
export type LongTaskAttemptBody = z.infer<typeof LongTaskAttemptBody>;
export const CaseRunView = z.discriminatedUnion('phase', [CaseRunPreSubmit, CaseRunPostSubmit]);
export type CaseRunView = z.infer<typeof CaseRunView>;
export const StartArtifactRunBody = S({
  run_id: Ulid,
  artifact_id: ArtifactId,
  session_id: Ulid.nullable(),
  block_id: Ulid.nullable(),
});
export type StartArtifactRunBody = z.infer<typeof StartArtifactRunBody>;
export const ArtifactDraftBody = S({ text: z.string().max(40_000), updated_at: EpochMs });
export type ArtifactDraftBody = z.infer<typeof ArtifactDraftBody>;
export const ArtifactSubmitBody = S({
  attempt_id: Ulid,
  text: z.string().min(1).max(40_000),
  confidence: Confidence.nullable(),
});
export type ArtifactSubmitBody = z.infer<typeof ArtifactSubmitBody>;
export const StartRebuttalBody = S({ dialog_id: Ulid });
export type StartRebuttalBody = z.infer<typeof StartRebuttalBody>;
export const ArtifactRunView = z.discriminatedUnion('phase', [ArtifactRunPreSubmit, ArtifactRunPostSubmit]);
export type ArtifactRunView = z.infer<typeof ArtifactRunView>;

// idem = run_id
export const PracticeCaseRunsCreateRoute = defineRoute({
  id: 'learning.practice.case_runs.create',
  ifId: 'IF-LR-026',
  method: 'POST',
  path: '/internal/v1/practice/case-runs',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: StartCaseRunBody },
  response: { 201: CaseRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025', 'FR-STD-034'],
});
export const PracticeCaseRunsGetRoute = defineRoute({
  id: 'learning.practice.case_runs.get',
  ifId: 'IF-LR-027',
  method: 'GET',
  path: '/internal/v1/practice/case-runs/{run_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ run_id: Ulid }) },
  response: { 200: CaseRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025', 'FR-STD-031'],
});
// idem = request_id
export const PracticeCaseRunsEvidenceRoute = defineRoute({
  id: 'learning.practice.case_runs.evidence',
  ifId: 'IF-LR-034',
  method: 'POST',
  path: '/internal/v1/practice/case-runs/{run_id}/evidence-requests',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: CaseEvidenceRequestBody },
  response: { 200: CaseRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025'],
});
// idem = attempt_id
export const PracticeCaseRunsAttemptRoute = defineRoute({
  id: 'learning.practice.case_runs.attempt',
  ifId: 'IF-LR-035',
  method: 'POST',
  path: '/internal/v1/practice/case-runs/{run_id}/attempts',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: LongTaskAttemptBody },
  response: { 200: AttemptOutcomePostSubmit },
  deadlineMs: 2900,
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025', 'FR-STD-034', 'FR-PRG-013'],
});
// idem = run_id
export const PracticeArtifactRunsCreateRoute = defineRoute({
  id: 'learning.practice.artifact_runs.create',
  ifId: 'IF-LR-028',
  method: 'POST',
  path: '/internal/v1/practice/artifact-runs',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: StartArtifactRunBody },
  response: { 201: ArtifactRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026'],
});
export const PracticeArtifactRunsGetRoute = defineRoute({
  id: 'learning.practice.artifact_runs.get',
  ifId: 'IF-LR-029',
  method: 'GET',
  path: '/internal/v1/practice/artifact-runs/{run_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ run_id: Ulid }) },
  response: { 200: ArtifactRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026', 'FR-STD-031'],
});
export const PracticeArtifactRunsDraftRoute = defineRoute({
  id: 'learning.practice.artifact_runs.draft',
  ifId: 'IF-LR-030',
  method: 'PUT',
  path: '/internal/v1/practice/artifact-runs/{run_id}/draft',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: ArtifactDraftBody },
  response: { 200: ArtifactRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-031'],
});
// idem = attempt_id
export const PracticeArtifactRunsSubmitRoute = defineRoute({
  id: 'learning.practice.artifact_runs.submit',
  ifId: 'IF-LR-036',
  method: 'POST',
  path: '/internal/v1/practice/artifact-runs/{run_id}:submit',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: ArtifactSubmitBody },
  response: { 200: AttemptOutcomePostSubmit },
  deadlineMs: 2900,
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026', 'FR-PRG-032'],
});
// idem = dialog_id
export const PracticeArtifactRunsRebutRoute = defineRoute({
  id: 'learning.practice.artifact_runs.rebut',
  ifId: 'IF-LR-031',
  method: 'POST',
  path: '/internal/v1/practice/artifact-runs/{run_id}:rebut',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: StartRebuttalBody },
  response: { 201: DialogView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026'],
});
export const LR_LONGTASKS_ROUTES = [
  PracticeCaseRunsCreateRoute,
  PracticeCaseRunsGetRoute,
  PracticeCaseRunsEvidenceRoute,
  PracticeCaseRunsAttemptRoute,
  PracticeArtifactRunsCreateRoute,
  PracticeArtifactRunsGetRoute,
  PracticeArtifactRunsDraftRoute,
  PracticeArtifactRunsSubmitRoute,
  PracticeArtifactRunsRebutRoute,
] as const;
