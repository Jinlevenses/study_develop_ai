import { z } from 'zod';
import { ConceptId, PolicySetId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { DurationMs, StudyDay } from '../../common/time.js';

export const LessonCompletedV1 = S({
  // IF-LG-07
  concept_id: ConceptId,
  session_id: Ulid,
  block_id: Ulid,
  stage: z.enum(['theory', 'code', 'core']),
  duration_ms: DurationMs,
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type LessonCompletedV1 = z.infer<typeof LessonCompletedV1>;
