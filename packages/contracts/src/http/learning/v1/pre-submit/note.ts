import { z } from 'zod';
import { ConceptId, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { EpochMs } from '../../../../common/time.js';
import { ItemDeliveryPreSubmit } from '../../../content/v1/pre-submit/item.js';

export const NotePreSubmit = S({
  phase: z.literal('pre_submit'),
  block_id: Ulid,
  session_id: Ulid,
  concept_id: ConceptId,
  ladder_step: z.enum(['BN-1', 'BN-2', 'BN-3', 'BN-4', 'BN-5']),
  prompt_md: z.string().max(4000),
  item: ItemDeliveryPreSubmit,
  draft: S({
    text: z.string().max(20_000),
    updated_at: EpochMs,
    uncertain_spans: z.array(S({ start: z.number().int(), end: z.number().int() })).max(100),
  }).nullable(),
  timer: S({ limit_ms: z.number().int().nullable(), extensions: z.array(z.union([z.literal(1.5), z.literal(2)])) }),
});
export type NotePreSubmit = z.infer<typeof NotePreSubmit>;
