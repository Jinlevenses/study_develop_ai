import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { CaseCatalogQuery, CaseCatalogView } from '../../content/v1/catalog.js';
import { DialogView } from '../../learning/v1/dialogs.js';
import {
  ArtifactDraftBody,
  ArtifactRunView,
  ArtifactSubmitBody,
  CaseEvidenceRequestBody,
  CaseRunView,
  LongTaskAttemptBody,
  StartArtifactRunBody,
  StartCaseRunBody,
  StartRebuttalBody,
} from '../../learning/v1/longtasks.js';
import { AttemptOutcomePostSubmit } from '../../learning/v1/post-submit/attempt.js';

// idem = run_id
// 하위 = IF-LR-026
export const CasesStartRoute = defineRoute({
  id: 'gateway.cases.start',
  ifId: 'IF-GW-068',
  method: 'POST',
  path: '/api/v1/cases/runs',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: StartCaseRunBody },
  response: { 201: CaseRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025', 'FR-STD-034'],
});
// 하위 = IF-LR-027
export const CasesGetRoute = defineRoute({
  id: 'gateway.cases.get',
  ifId: 'IF-GW-069',
  method: 'GET',
  path: '/api/v1/cases/runs/{run_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ run_id: Ulid }) },
  response: { 200: CaseRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025', 'FR-STD-031'],
});
// 하위 = IF-CT-024
export const CasesListRoute = defineRoute({
  id: 'gateway.cases.list',
  ifId: 'IF-GW-070',
  method: 'GET',
  path: '/api/v1/cases',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: CaseCatalogQuery },
  response: { 200: CaseCatalogView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025', 'FR-CUR-016'],
});
// idem = request_id
// 하위 = IF-LR-034
export const CasesEvidenceRoute = defineRoute({
  id: 'gateway.cases.evidence',
  ifId: 'IF-GW-083',
  method: 'POST',
  path: '/api/v1/cases/runs/{run_id}/evidence-requests',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: CaseEvidenceRequestBody },
  response: { 200: CaseRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-025'],
});
// idem = attempt_id
// 하위 = IF-LR-035
export const CasesAttemptRoute = defineRoute({
  id: 'gateway.cases.attempt',
  ifId: 'IF-GW-084',
  method: 'POST',
  path: '/api/v1/cases/runs/{run_id}/attempts',
  allowedCallers: ['browser'],
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
// 하위 = IF-LR-028
export const ArtifactsStartRoute = defineRoute({
  id: 'gateway.artifacts.start',
  ifId: 'IF-GW-071',
  method: 'POST',
  path: '/api/v1/artifacts/runs',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: StartArtifactRunBody },
  response: { 201: ArtifactRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026'],
});
// 하위 = IF-LR-029
export const ArtifactsGetRoute = defineRoute({
  id: 'gateway.artifacts.get',
  ifId: 'IF-GW-072',
  method: 'GET',
  path: '/api/v1/artifacts/runs/{run_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ run_id: Ulid }) },
  response: { 200: ArtifactRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026', 'FR-STD-031'],
});
// 하위 = IF-LR-030
export const ArtifactsDraftRoute = defineRoute({
  id: 'gateway.artifacts.draft',
  ifId: 'IF-GW-073',
  method: 'PUT',
  path: '/api/v1/artifacts/runs/{run_id}/draft',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: ArtifactDraftBody },
  response: { 200: ArtifactRunView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-031'],
});
// idem = dialog_id
// 하위 = IF-LR-031
export const ArtifactsRebutRoute = defineRoute({
  id: 'gateway.artifacts.rebut',
  ifId: 'IF-GW-074',
  method: 'POST',
  path: '/api/v1/artifacts/runs/{run_id}:rebut',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: StartRebuttalBody },
  response: { 201: DialogView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026'],
});
// idem = attempt_id
// 하위 = IF-LR-036
export const ArtifactsSubmitRoute = defineRoute({
  id: 'gateway.artifacts.submit',
  ifId: 'IF-GW-103',
  method: 'POST',
  path: '/api/v1/artifacts/runs/{run_id}:submit',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ run_id: Ulid }), body: ArtifactSubmitBody },
  response: { 200: AttemptOutcomePostSubmit },
  deadlineMs: 2900,
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-026', 'FR-PRG-032'],
});
export const GW_LONGTASKS_ROUTES = [
  CasesStartRoute,
  CasesGetRoute,
  CasesListRoute,
  CasesEvidenceRoute,
  CasesAttemptRoute,
  ArtifactsStartRoute,
  ArtifactsGetRoute,
  ArtifactsDraftRoute,
  ArtifactsRebutRoute,
  ArtifactsSubmitRoute,
] as const;
