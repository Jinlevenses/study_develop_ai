import { z } from 'zod';
import { Level } from '../../common/domain.js';
import { TrackId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const LevelProvisionalResolvedV1 = S({
  // IF-LG-17 — 레벨은 내려가지 않는다
  track: TrackId,
  level: Level,
  outcome: z.enum(['confirmed', 'provisional_revoked']),
  needs_reconfirmation: z.boolean(),
  regrade_verdict_ids: z.array(Ulid).max(50),
  study_day: StudyDay,
}).refine((v) => v.outcome !== 'provisional_revoked' || v.needs_reconfirmation === true);
export type LevelProvisionalResolvedV1 = z.infer<typeof LevelProvisionalResolvedV1>;
