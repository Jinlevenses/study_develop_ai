import { z } from 'zod';
import { CardId, PolicySetId } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const CardStatusChangedV1 = S({
  card_id: CardId,
  status: z.enum(['active', 'suspended', 'retired']), // IF-LG-10
  reason: z.enum(['user', 'leech', 'irrelevant', 'pack_deprecated']),
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type CardStatusChangedV1 = z.infer<typeof CardStatusChangedV1>;
