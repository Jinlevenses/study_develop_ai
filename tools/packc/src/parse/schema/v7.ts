// DCP-01 §6.15 — review/V7/<pack_id>/<batch_id>.yaml.
import { z } from 'zod';
import { IsoDate } from './common.js';

export const V7Record = z
  .object({
    schema_v: z.literal(1),
    batch_id: z.string().regex(/^v7\.[a-z0-9.]+\.\d{3}$/),
    pack_id: z.string(),
    created_at: IsoDate,
    scope: z.object({ record_ids: z.array(z.string()).min(1) }).strict(),
    policy: z.enum(['tier_a_20pct', 'tier_b_5pct', 't2_5pct', 'full']),
    author: z.object({ wp: z.string(), model_id: z.string(), context_id: z.string() }).strict(),
    reviewer: z
      .object({
        wp: z.literal('WP-REV'),
        model_id: z.string(),
        context_id: z.string(),
        prompt_id: z.string().regex(/^review\.v7\.[a-z_]+@\d+\.\d+\.\d+$/),
        tier: z.literal('upper'),
      })
      .strict(),
    sampling: z.object({ seed: z.int(), sampled_ids: z.array(z.string()).min(1) }).strict(),
    checklist_version: z.literal('v7-checklist@1'),
    findings: z
      .record(
        z.string().regex(/^f_\d{2,3}$/),
        z
          .object({
            record_id: z.string(),
            severity: z.enum(['blocker', 'major', 'minor']),
            category: z.enum([
              'fact',
              'key',
              'ambiguity',
              'leak',
              'level_fit',
              'korean',
              'license',
              'format',
              'safety',
              'pedagogy',
            ]),
            note: z.string().max(400),
            resolution: z.enum(['fixed', 'wont_fix', 'deferred']),
          })
          .strict(),
      )
      .default({}),
    defect_rate: z.number().min(0).max(1),
    decision: z.enum(['approve', 'rework']),
    approved_hashes: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();
export type V7Record = z.infer<typeof V7Record>;
