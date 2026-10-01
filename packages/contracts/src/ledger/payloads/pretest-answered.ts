import { z } from 'zod';
import { ConceptId, ItemId, PolicySetId, Sha256Hex, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const PretestAnsweredV1 = S({
  // IF-LG-06 — β 추정만(증거 0)
  attempt_id: Ulid,
  verdict_id: Ulid,
  item_id: ItemId,
  item_content_hash: Sha256Hex,
  concept_id: ConceptId,
  item_beta: z.number(),
  item_n_options: z.number().int().min(0),
  result: z.enum(['correct', 'partial', 'incorrect', 'pending']),
  latency_ms: z.number().int().min(0),
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type PretestAnsweredV1 = z.infer<typeof PretestAnsweredV1>;
