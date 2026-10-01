import { z } from 'zod';
import { ConceptId, ItemId, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';

export const HintQuery = S({ session_id: Ulid, block_id: Ulid });
export type HintQuery = z.infer<typeof HintQuery>;
export const HintViewPreSubmit = S({
  item_id: ItemId,
  step: z.number().int().min(1).max(4),
  kind: z.enum(['direction', 'concept_link', 'partial_code', 'walkthrough']), // FR-LAB-005 4단
  body_md: z.string().max(8000),
  concept_link: ConceptId.nullable(),
  penalty_note_ko: z.string().max(200),
  steps_available: z.number().int().min(0).max(4),
});
export type HintViewPreSubmit = z.infer<typeof HintViewPreSubmit>;
