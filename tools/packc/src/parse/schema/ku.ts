// DCP-01 §6.3 — packs/<track>/kus/<concept_id>.yaml.
import { ConceptId } from '@fathom/contracts/common/ids';
import { Level, Volatility } from '@fathom/contracts/common/domain';
import { z } from 'zod';
import { Bloom, FacetId, IsoDate, SourceRef } from './common.js';

export const KuType = z.enum([
  'definition',
  'property',
  'mechanism',
  'procedure_step',
  'constraint',
  'comparison',
  'syntax',
  'config_fact',
  'failure_mode',
  'tradeoff',
  'heuristic',
  'example',
]); // R2 §2.2

export const KuFile = z
  .object({
    schema_v: z.literal(1),
    concept_id: ConceptId, // = 파일 이름
    kus: z
      .record(
        z.string().regex(/^k\d{2}$/),
        z
          .object({
            type: KuType,
            facet: FacetId,
            statement: z.string().min(10).max(200),
            scope: z.string().max(80).default(''),
            vol: Volatility,
            valid_as_of: IsoDate,
            level_min: Level,
            bloom_affordance: z.array(Bloom).min(1).max(3),
            cloze_keys: z.array(z.string().min(1).max(30)).max(4).default([]),
            accept: z.record(z.string(), z.array(z.string().min(1).max(40)).max(8)).default({}),
            source_refs: z.array(SourceRef).min(1),
            deprecated_by: z
              .string()
              .regex(/^k\d{2}$/)
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .refine((m) => Object.keys(m).length >= 1, 'at least one ku'),
  })
  .strict();
export type KuFile = z.infer<typeof KuFile>;
