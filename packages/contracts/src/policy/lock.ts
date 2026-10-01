import { z } from 'zod';
import { PolicyRef, PolicySetId, ServiceName, Sha256Hex } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';

export const PolicyLock = z.record(PolicyRef, S({ sha256: Sha256Hex, owner: ServiceName })); // policy/policy.lock.json
export type PolicyLock = z.infer<typeof PolicyLock>;
export const PolicySetFile = S({
  policy_version: PolicySetId, // FATHOM_HOME/policy/sets/<policy_version>.json
  members: z.record(z.string(), S({ version: PolicyRef, sha256: Sha256Hex })),
  overrides_sha256: Sha256Hex.nullable(),
  created_at: EpochMs,
});
export type PolicySetFile = z.infer<typeof PolicySetFile>;
// policy_version = 'ps_' + sha256(canonicalJson({members, overrides_sha256})).slice(0, 16)
