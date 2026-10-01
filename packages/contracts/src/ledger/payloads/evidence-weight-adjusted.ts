import { z } from 'zod';
import { ItemId, PolicySetId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const EvidenceWeightAdjustedV1 = S({
  // IF-LG-05 — w 대체(원본 불변, FR-PRG-002)
  target_event_ids: z.array(Ulid).min(1).max(10_000),
  adjustment: z.discriminatedUnion('kind', [
    S({ kind: z.literal('factor'), factor: z.number().min(0).max(1) }), // halve = 0.5
    S({
      kind: z.literal('set'),
      w_format: z.number().min(0).max(1).nullable(),
      w_grader: z.number().min(0).max(1).nullable(),
      gaming_factor: z.number().min(0).max(1).nullable(),
    }),
  ]),
  cause: z.enum(['correction_halve', 'policy_recalc']),
  item_id: ItemId.nullable(),
  gate_result_id: Ulid.nullable(),
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type EvidenceWeightAdjustedV1 = z.infer<typeof EvidenceWeightAdjustedV1>;
