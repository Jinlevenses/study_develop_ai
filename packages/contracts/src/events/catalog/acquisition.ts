import { z } from 'zod';
import { Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';

export const AcquisitionImportStagedV1 = S({                    // IF-EV-04
  job_id: Ulid, source_kind: z.enum(['url', 'paste', 'file', 'inbox']),
  diff_summary: S({ concepts: z.number().int(), kus: z.number().int(), items: z.number().int() }), requires_approval: z.boolean(),
});
export type AcquisitionImportStagedV1 = z.infer<typeof AcquisitionImportStagedV1>;
