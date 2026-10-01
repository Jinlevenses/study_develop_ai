import { z } from 'zod';
import { PolicyRef, PolicySetId, Sha256Hex, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';

export const PolicySwitchedV1 = S({
  // IF-LG-12
  policy_version: PolicySetId,
  previous_policy_version: PolicySetId,
  members: z.record(z.string(), S({ version: PolicyRef, sha256: Sha256Hex })),
  overrides_sha256: Sha256Hex.nullable(),
  replay_report_ref: Ulid.nullable(),
  study_day: StudyDay,
});
export type PolicySwitchedV1 = z.infer<typeof PolicySwitchedV1>;
