import { z } from 'zod';
import { ItemId, PolicySetId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const EvidenceVoidedV1 = S({
  // IF-LG-04
  item_id: ItemId,
  target_event_ids: z.array(Ulid).min(1).max(10_000),
  basis: z.enum(['regate_g3', 'regate_g5', 'report', 'health', 'overlay', 'pack_upgrade']),
  correction: z.enum(['quarantined', 'demoted', 'key_fixed', 'retired']), // 멱등 키 'corr:<item_id>:<basis>:<gate_result_id>'도 같은 enum(CR-33)
  gate_result_id: Ulid,
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type EvidenceVoidedV1 = z.infer<typeof EvidenceVoidedV1>;
