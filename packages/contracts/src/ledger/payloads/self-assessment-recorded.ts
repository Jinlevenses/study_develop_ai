import { z } from 'zod';
import { FsrsRating } from '../../common/domain.js';
import { PolicySetId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const SelfAssessmentRecordedV1 = S({
  // IF-LG-08
  kind: z.enum(['self_grade', 'jol', 'regrade_rating_confirm', 'bias_probe']),
  target: S({ kind: z.enum(['concept', 'item', 'attempt', 'ledger_event', 'session']), id: z.string().max(160) }),
  value: z.discriminatedUnion('kind', [
    S({ kind: z.literal('grade'), grade: z.number().min(0).max(4) }),
    S({ kind: z.literal('probability'), p: z.number().min(0).max(1) }), // JOL
    S({ kind: z.literal('rating_confirm'), accepted: z.boolean(), rating: FsrsRating }),
  ]),
  session_id: Ulid.nullable(),
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type SelfAssessmentRecordedV1 = z.infer<typeof SelfAssessmentRecordedV1>;
