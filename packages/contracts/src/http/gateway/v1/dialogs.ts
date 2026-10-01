import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DialogView, EndDialogBody, StartDialogBody, SubmitTurnBody, TurnOutcome } from '../../learning/v1/dialogs.js';
import { NoteDraftAck, NoteDraftBody, NoteView } from '../../learning/v1/notes.js';

// NoteView는 재정의하지 않는다(§1.2-4): 라우트 정의가 `import { NoteView } from '@fathom/contracts/http/learning/v1/notes'`를 직접 쓴다(IF-LR-024와 같은 객체 — TST C2 Object.is 단언).
// post 분기의 judge_card는 gateway가 IF-CT-045로 채운다.
// idem = dialog_id
// 하위 = IF-LR-020
export const DialogsCreateRoute = defineRoute({
  id: 'gateway.dialogs.create',
  ifId: 'IF-GW-060',
  method: 'POST',
  path: '/api/v1/dialogs',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: StartDialogBody },
  response: { 201: DialogView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-STD-021', 'FR-STD-031'],
});
// 하위 = IF-LR-021
export const DialogsGetRoute = defineRoute({
  id: 'gateway.dialogs.get',
  ifId: 'IF-GW-061',
  method: 'GET',
  path: '/api/v1/dialogs/{dialog_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ dialog_id: Ulid }) },
  response: { 200: DialogView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-031'],
});
// idem = turn_id
// 하위 = IF-LR-022
export const DialogsTurnRoute = defineRoute({
  id: 'gateway.dialogs.turn',
  ifId: 'IF-GW-062',
  method: 'POST',
  path: '/api/v1/dialogs/{dialog_id}/turns',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ dialog_id: Ulid }), body: SubmitTurnBody },
  response: { 200: TurnOutcome },
  deadlineMs: 3500,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-STD-021', 'FR-AI-017'],
});
// 하위 = IF-CT-046(ref는 learning 턴 기록에서 조회 후 중계)
// Last-Event-ID 헤더(스키마 없음)
// SSE 바이트 중계 — 프레임 스키마는 이 응답이 아니라 http/gateway/v1/stream.ts(IF-GW-005)·ai/stream.ts(§2.14)
export const DialogsUtteranceRoute = defineRoute({
  id: 'gateway.dialogs.utterance',
  ifId: 'IF-GW-063',
  method: 'GET',
  path: '/api/v1/dialogs/{dialog_id}/turns/{turn_id}/utterance',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ dialog_id: Ulid, turn_id: Ulid }) },
  response: { 200: z.string() },
  responseKind: 'sse',
  deadlineMs: 60000,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'IR-016'],
});
// 하위 = IF-LR-023
export const DialogsEndRoute = defineRoute({
  id: 'gateway.dialogs.end',
  ifId: 'IF-GW-064',
  method: 'POST',
  path: '/api/v1/dialogs/{dialog_id}:end',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ dialog_id: Ulid }), body: EndDialogBody },
  response: { 200: DialogView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-PRG-010'],
});
// 하위 = IF-LR-024 (+ 제출 후 ⊕ IF-CT-045)
export const NotesGetRoute = defineRoute({
  id: 'gateway.notes.get',
  ifId: 'IF-GW-065',
  method: 'GET',
  path: '/api/v1/notes/{block_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ block_id: Ulid }) },
  response: { 200: NoteView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-018', 'FR-STD-019', 'FR-QST-026'],
});
// 하위 = IF-LR-025
export const NotesDraftRoute = defineRoute({
  id: 'gateway.notes.draft',
  ifId: 'IF-GW-066',
  method: 'PUT',
  path: '/api/v1/notes/{block_id}/draft',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ block_id: Ulid }), body: NoteDraftBody },
  response: { 200: NoteDraftAck },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
// 하위 = IF-CT-047
// Last-Event-ID 헤더(스키마 없음)
// SSE 바이트 중계 — 프레임 스키마는 이 응답이 아니라 http/gateway/v1/stream.ts(IF-GW-005)·ai/stream.ts(§2.14)
export const VerdictsFeedbackStreamRoute = defineRoute({
  id: 'gateway.verdicts.feedback_stream',
  ifId: 'IF-GW-067',
  method: 'GET',
  path: '/api/v1/verdicts/{verdict_id}/feedback',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ verdict_id: Ulid }) },
  response: { 200: z.string() },
  responseKind: 'sse',
  deadlineMs: 60000,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-019', 'FR-QST-023'],
});
export const GW_DIALOGS_ROUTES = [
  DialogsCreateRoute,
  DialogsGetRoute,
  DialogsTurnRoute,
  DialogsUtteranceRoute,
  DialogsEndRoute,
  NotesGetRoute,
  NotesDraftRoute,
  VerdictsFeedbackStreamRoute,
] as const;
