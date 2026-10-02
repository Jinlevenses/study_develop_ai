// DCP-01 §6.14.1 — sources/registry.yaml.
import { SourceId } from '@fathom/contracts/common/ids';
import { z } from 'zod';
import { IsoDate, Usage } from './common.js';

const Grade = z.enum(['A', 'B', 'C', 'D', 'P']);

export const SourceEntry = z
  .object({
    kind: z.enum(['web', 'doc', 'book', 'rfc', 'paper', 'repo', 'user']),
    title: z.string().max(120),
    publisher: z.string().max(80),
    base_url: z.string().startsWith('https://').optional(),
    repo: z
      .string()
      .regex(/^github\.com\/[\w.-]+\/[\w.-]+$/)
      .optional(),
    ref_text: z.string().max(200).optional(),
    license: z
      .object({ spdx: z.string().max(40), grade: Grade, verified_at: IsoDate, evidence: z.string().max(200) })
      .strict(),
    code_license: z
      .object({ spdx: z.string().max(40), grade: Grade })
      .strict()
      .optional(),
    attribution_template: z.string().max(200),
    allowed_usage: z.array(Usage).min(1),
    primary: z.boolean().default(false),
    fetch: z
      .object({ method: z.enum(['git_sparse', 'none']), path_glob: z.string().optional(), ref: z.string().optional() })
      .strict(),
    versioned_by: z.enum(['product_version', 'edition', 'none']).default('none'),
  })
  .strict();
export type SourceEntry = z.infer<typeof SourceEntry>;

export const SourceRegistry = z.object({ schema_v: z.literal(1), sources: z.record(SourceId, SourceEntry) }).strict();
export type SourceRegistry = z.infer<typeof SourceRegistry>;
