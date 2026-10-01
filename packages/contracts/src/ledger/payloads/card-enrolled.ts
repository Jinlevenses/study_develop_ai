import type { z } from 'zod';
import { Facet, ResponseMode, Tier } from '../../common/domain.js';
import { CardId, ConceptId, PolicySetId } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const CardEnrolledV1 = S({
  card_id: CardId,
  concept_id: ConceptId,
  facet: Facet,
  response_mode: ResponseMode,
  tier: Tier, // IF-LG-09
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type CardEnrolledV1 = z.infer<typeof CardEnrolledV1>;
