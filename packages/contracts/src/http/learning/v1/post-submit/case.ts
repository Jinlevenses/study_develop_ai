import { z } from 'zod';
import { CaseId, ObjKey, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { EpochMs } from '../../../../common/time.js';

export const CaseRunPostSubmit = S({
  phase: z.literal('post_submit'),
  run_id: Ulid,
  case_id: CaseId,
  variant_id: z.string().max(64),
  state: z.enum(['graded', 'awaiting_self_grade']),
  started_at: EpochMs,
  finished_at: EpochMs,
  decisions: z
    .array(
      S({
        node_key: ObjKey,
        option_key: ObjKey,
        verdict_id: Ulid,
        score: z.number().min(0).max(1),
        best_option_key: ObjKey,
      }),
    )
    .max(30),
  score: S({
    decision_score: z.number().min(0).max(1),
    rubric_score: z.number().min(0).max(4).nullable(),
    total: z.number().min(0).max(4).nullable(),
    mttr_sim_min: z.number().min(0).nullable(),
    evidence_efficiency: z.number().min(0).max(1).nullable(),
    offline_weighting: z.boolean(),
  }),
  debrief_md: z.string().max(20_000),
});
export type CaseRunPostSubmit = z.infer<typeof CaseRunPostSubmit>;
