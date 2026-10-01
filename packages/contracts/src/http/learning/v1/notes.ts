import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { NotePostSubmit } from './post-submit/note.js';
import { NotePreSubmit } from './pre-submit/note.js';

export const NoteView = z.discriminatedUnion('phase', [NotePreSubmit, NotePostSubmit]);
export type NoteView = z.infer<typeof NoteView>;
export const NoteDraftBody = S({
  text: z.string().max(20_000),
  updated_at: EpochMs,
  uncertain_spans: z.array(S({ start: z.number().int().min(0), end: z.number().int().min(0) })).max(100),
});
export type NoteDraftBody = z.infer<typeof NoteDraftBody>;
export const NoteDraftAck = S({ block_id: Ulid, saved_at: EpochMs });
export type NoteDraftAck = z.infer<typeof NoteDraftAck>;

export const PracticeNotesGetRoute = defineRoute({
  id: 'learning.practice.notes.get',
  ifId: 'IF-LR-024',
  method: 'GET',
  path: '/internal/v1/practice/notes/{block_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ block_id: Ulid }) },
  response: { 200: NoteView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-STD-018', 'FR-STD-019', 'FR-QST-026'],
});
export const PracticeNotesDraftRoute = defineRoute({
  id: 'learning.practice.notes.draft',
  ifId: 'IF-LR-025',
  method: 'PUT',
  path: '/internal/v1/practice/notes/{block_id}/draft',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ block_id: Ulid }), body: NoteDraftBody },
  response: { 200: NoteDraftAck },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-STD-031'],
});
export const LR_NOTES_ROUTES = [PracticeNotesGetRoute, PracticeNotesDraftRoute] as const;
