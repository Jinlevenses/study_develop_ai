import { z } from 'zod';
import { AiMode, FormatId, Level, Sp1State } from '../../common/domain.js';
import { ItemId, PolicySetId, TrackId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const PromotionExamCompletedV1 = S({
  // IF-LG-15
  exam_id: Ulid,
  track: TrackId,
  level: Level,
  item_ids: z.array(ItemId).length(12),
  formats: z.array(FormatId).min(4).max(12),
  correct_count: z.number().int().min(0).max(12),
  cbm_ratio: z.number(),
  passed: z.boolean(),
  profile: S({ policy_version: PolicySetId, ai_mode: AiMode, sp1_state: Sp1State }),
  study_day: StudyDay,
});
export type PromotionExamCompletedV1 = z.infer<typeof PromotionExamCompletedV1>;
