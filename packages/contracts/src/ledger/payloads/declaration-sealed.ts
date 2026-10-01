import { z } from 'zod';
import { Sha256Hex, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { EpochMs, StudyDay } from '../../common/time.js';

export const DeclarationSealedV1 = S({
  // IF-LG-14
  declaration_id: Ulid,
  kind: z.enum(['time_capsule', 'anchor_0', 'season_goal', 'self_declaration']),
  content_hash: Sha256Hex,
  sealed_payload: z.record(z.string(), z.unknown()),
  unseal_at: EpochMs.nullable(),
  study_day: StudyDay,
});
export type DeclarationSealedV1 = z.infer<typeof DeclarationSealedV1>;
