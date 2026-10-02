// DCP-01 §6.9 — packs/<track>/rubrics/<slug>.yaml · templates/rubrics/<slug>.yaml.
import { RubricId } from '@fathom/contracts/common/ids';
import { z } from 'zod';
import { Md } from './common.js';

export const RubricFile = z
  .object({
    schema_v: z.literal(1),
    id: RubricId,
    title_ko: z.string().max(60),
    applies_to: z.array(z.enum(['case', 'artifact', 'essay', 'feynman', 'blank_note', 'fermi_assumptions'])).min(1),
    dims: z.record(
      z.string().regex(/^d_[a-z0-9_]{1,20}$/),
      z
        .object({
          name_ko: z.string().max(40),
          weight: z.number().min(0.5).max(2).default(1),
          levels: z.object({ l1: Md(10, 300), l2: Md(10, 300), l3: Md(10, 300), l4: Md(10, 300) }).strict(),
        })
        .strict(),
    ),
    pass_mean: z.number().min(1).max(4).default(2.5),
  })
  .strict();
export type RubricFile = z.infer<typeof RubricFile>;
