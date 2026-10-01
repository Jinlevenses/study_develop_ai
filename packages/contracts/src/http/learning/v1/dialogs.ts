import { z } from 'zod';
import { ConceptId, ItemId, ObjKey, Sha256Hex, Ulid } from '../../../common/ids.js';
import { DialogEndReason, DialogKind, DialogMove, TurnJudgement, Utterance } from '../../../common/practice.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { ItemDeliveryPreSubmit } from '../../content/v1/pre-submit/item.js';

export const StartDialogBody = S({
  dialog_id: Ulid,
  kind: z.enum(['dig', 'feynman']),
  concept_id: ConceptId,
  session_id: Ulid.nullable(),
  block_id: Ulid.nullable(),
});
export type StartDialogBody = z.infer<typeof StartDialogBody>;
export const SubmitTurnBody = S({
  turn_id: Ulid,
  text: z.string().min(1).max(4000),
  answered_at: EpochMs,
  d4_choice: S({
    item_id: ItemId,
    item_content_hash: Sha256Hex,
    option_keys: z.array(ObjKey).min(1).max(4),
  }).nullable(), // OFFLINE D4·D5 결정적 MCQ 응답
});
export type SubmitTurnBody = z.infer<typeof SubmitTurnBody>;
export const TurnOutcome = S({
  turn_id: Ulid,
  judgement: TurnJudgement,
  move: DialogMove,
  depth: z.number().int().min(1).max(7),
  utterance: Utterance,
  d4_item: ItemDeliveryPreSubmit.nullable(),
  verdict_id: Ulid.nullable(),
  ended: z.boolean(),
  ended_reason: DialogEndReason.nullable(),
});
export type TurnOutcome = z.infer<typeof TurnOutcome>;
export const DialogView = S({
  dialog_id: Ulid,
  kind: DialogKind,
  concept_id: ConceptId,
  state: z.enum(['active', 'ended']),
  session_id: Ulid.nullable(),
  block_id: Ulid.nullable(),
  artifact_run_id: Ulid.nullable(),
  depth: z.number().int().min(1).max(7),
  depth_max_allowed: z.number().int().min(1).max(7), // L1 학습자 = 3
  turn_count: z.number().int().min(0),
  turn_limit: z.literal(12),
  fail_streak: z.number().int().min(0),
  turns: z
    .array(
      S({
        turn_id: Ulid,
        role: z.enum(['learner', 'system']),
        created_at: EpochMs,
        text_md: z.string().max(4000).nullable(), // learner = 원문, system static = 문장, system stream = null(utterance로 재생)
        judgement: TurnJudgement.nullable(),
        move: DialogMove.nullable(),
        utterance: Utterance.nullable(),
        verdict_id: Ulid.nullable(),
      }),
    )
    .max(30),
  discovered: z.array(S({ concept_id: ConceptId.nullable(), label_ko: z.string().max(100) })).max(20),
  pending_d4_item: ItemDeliveryPreSubmit.nullable(),
  ended_reason: DialogEndReason.nullable(),
});
export type DialogView = z.infer<typeof DialogView>;
export const EndDialogBody = S({ reason: z.enum(['learner', 'completed']) });
export type EndDialogBody = z.infer<typeof EndDialogBody>;

// idem = dialog_id
export const PracticeDialogsCreateRoute = defineRoute({
  id: 'learning.practice.dialogs.create',
  ifId: 'IF-LR-020',
  method: 'POST',
  path: '/internal/v1/practice/dialogs',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: StartDialogBody },
  response: { 201: DialogView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-STD-021', 'FR-STD-031'],
});
export const PracticeDialogsGetRoute = defineRoute({
  id: 'learning.practice.dialogs.get',
  ifId: 'IF-LR-021',
  method: 'GET',
  path: '/internal/v1/practice/dialogs/{dialog_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ dialog_id: Ulid }) },
  response: { 200: DialogView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-031'],
});
// idem = turn_id
export const PracticeDialogsTurnRoute = defineRoute({
  id: 'learning.practice.dialogs.turn',
  ifId: 'IF-LR-022',
  method: 'POST',
  path: '/internal/v1/practice/dialogs/{dialog_id}/turns',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ dialog_id: Ulid }), body: SubmitTurnBody },
  response: { 200: TurnOutcome },
  deadlineMs: 3400,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-STD-021', 'FR-STD-022', 'FR-AI-017'],
});
export const PracticeDialogsEndRoute = defineRoute({
  id: 'learning.practice.dialogs.end',
  ifId: 'IF-LR-023',
  method: 'POST',
  path: '/internal/v1/practice/dialogs/{dialog_id}:end',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ dialog_id: Ulid }), body: EndDialogBody },
  response: { 200: DialogView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-PRG-010'],
});
export const LR_DIALOGS_ROUTES = [
  PracticeDialogsCreateRoute,
  PracticeDialogsGetRoute,
  PracticeDialogsTurnRoute,
  PracticeDialogsEndRoute,
] as const;
