import { z } from 'zod';
import { CaseId, ObjKey, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { EpochMs } from '../../../../common/time.js';
import { ItemDeliveryPreSubmit } from '../../../content/v1/pre-submit/item.js';

export const CaseRunPreSubmit = S({
  phase: z.literal('pre_submit'),
  run_id: Ulid,
  case_id: CaseId,
  variant_id: z.string().max(64),
  state: z.literal('active'),
  started_at: EpochMs,
  alarm_md: z.string().max(8000),
  evidence: z.record(
    ObjKey,
    S({
      label_ko: z.string().max(100),
      cost: z.number().int().min(0),
      revealed: z.boolean(),
      content_md: z.string().max(20_000).nullable(),
    }),
  ),
  evidence_requests: z.array(S({ evidence_key: ObjKey, requested_at: EpochMs })).max(50),
  current_node: ItemDeliveryPreSubmit.nullable(), // 결정점(case_decision) 또는 포스트모템(case_postmortem)
  decisions: z.array(S({ node_key: ObjKey, option_key: ObjKey, verdict_id: Ulid })).max(30),
});
export type CaseRunPreSubmit = z.infer<typeof CaseRunPreSubmit>;
