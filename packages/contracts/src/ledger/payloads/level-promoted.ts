import { z } from 'zod';
import { AiMode, Level, Sp1State } from '../../common/domain.js';
import { PolicySetId, TrackId } from '../../common/ids.js';
import { PromotionGate } from '../../common/practice.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const LevelPromotedV1 = S({
  // IF-LG-16 — 끈적한 사실(강등 없음, BR-14)
  track: TrackId,
  from: Level.nullable(),
  to: Level,
  provisional: z.boolean(),
  basis: z.enum(['promotion_exam', 'placement']),
  gates: z.array(PromotionGate).max(20),
  profile: S({ policy_version: PolicySetId, ai_mode: AiMode, sp1_state: Sp1State }),
  study_day: StudyDay,
});
export type LevelPromotedV1 = z.infer<typeof LevelPromotedV1>;
