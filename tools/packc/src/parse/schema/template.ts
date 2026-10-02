// DCP-01 §6.11 + Brief T-01-03 §4.2-a — content/templates/{t2,dig}/*.yaml, sources/requests/*.yaml 스키마 확정.
import { SourceId } from '@fathom/contracts/common/ids';
import { z } from 'zod';
import { ObjKey } from './common.js';
import { ItemModelT2 } from './item-model.js';
import { KuType } from './ku.js';
import { SourceEntry } from './source.js';

export const TemplateT2File = ItemModelT2.extend({
  schema_v: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  applies_to: z
    .object({ tiers: z.array(z.enum(['A', 'B'])).min(1), ku_types: z.array(KuType).optional() })
    .strict(),
}).strict();
export type TemplateT2File = z.infer<typeof TemplateT2File>;

export const TemplateDigFile = z
  .object({
    schema_v: z.literal(1),
    id: z.string().regex(/^generic-0[1-9]$/),
    kind: z.literal('dig'),
    depth: z.enum(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']),
    question_template: z.string().min(10).max(300),
    expects_from: z.array(KuType).min(1).max(6),
    followups: z
      .record(
        ObjKey,
        z
          .object({
            when: z.enum(['partial', 'misconception', 'dont_know', 'off_topic']),
            question: z.string().min(10).max(300),
          })
          .strict(),
      )
      .default({}),
  })
  .strict();
export type TemplateDigFile = z.infer<typeof TemplateDigFile>;

export const SourceRequestFile = z
  .object({
    schema_v: z.literal(1),
    wp: z.string().regex(/^WP-[A-Za-z0-9.-]{2,40}$/),
    requests: z.record(
      SourceId,
      SourceEntry.extend({ reason: z.string().min(5).max(300), merged: z.boolean() }).strict(),
    ),
  })
  .strict();
export type SourceRequestFile = z.infer<typeof SourceRequestFile>;
