// DCP-01 §6.6 — packs/<track>/item-models/<concept_id>.yaml (T1 바인딩 · T2 템플릿).

import { Level } from '@fathom/contracts/common/domain';
import { ConceptId } from '@fathom/contracts/common/ids';
import { z } from 'zod';
import { Bloom, FacetId, KuRef, ObjKey, ResponseMode, StemFamily } from './common.js';
import { Opt } from './item.js';
import { KuType } from './ku.js';

export const T1GeneratorId = z.enum([
  't1.js_output',
  't1.event_loop_order',
  't1.sql_result',
  't1.regex_match',
  't1.cidr',
  't1.http_status',
  't1.big_o',
  't1.cron',
  't1.bitwise',
  't1.docker_layer_cache',
  't1.k8s_yaml_defect',
  't1.fermi',
]); // 12종(FR-QST-001), 구현 = content itembank 레인(DN-15)

export const ParamSpec = z.discriminatedUnion('type', [
  z.object({ type: z.literal('int'), min: z.int(), max: z.int(), step: z.int().min(1).default(1) }).strict(),
  z.object({ type: z.literal('enum'), values: z.record(ObjKey, z.string().max(80)) }).strict(),
]);

export const ItemModelT1 = z
  .object({
    kind: z.literal('t1'),
    generator: T1GeneratorId,
    format: z.enum(['code_predict', 'short', 'mcq', 'order', 'fermi', 'config_review']),
    facet: FacetId,
    response_mode: ResponseMode,
    level: Level,
    bloom: Bloom,
    stem_family: StemFamily,
    params: z.record(ObjKey, ParamSpec).default({}),
    ku_refs: z.array(KuRef).min(1),
  })
  .strict();

export const ItemModelT2 = z
  .object({
    kind: z.literal('t2'),
    format: z.enum(['ox', 'mcq', 'cloze', 'short', 'matching']),
    facet: FacetId,
    response_mode: ResponseMode,
    stem_family: StemFamily,
    source: z
      .object({
        from: z.enum(['ku', 'mc', 'ku_set']),
        ku_types: z.array(KuType).optional(),
        ku_refs: z.array(KuRef).optional(),
      })
      .strict(),
    template: z
      .object({
        stem: z.string().max(600),
        options: z.record(Opt, z.string()).optional(),
        answer: z.string().max(200),
      })
      .strict(), // {{ku.statement}} {{ku.cloze}} {{mc.wrong_belief}} {{concept.title_ko}} 치환
    constraints: z
      .object({
        dedupe_jaccard: z.number().default(0.85),
        max_instances: z.int().min(1).max(40).default(12),
      })
      .strict(),
    metamorphic: z
      .object({
        preserve: z.array(z.enum(['paraphrase', 'option_order'])).default(['option_order']),
        flip: z.array(z.enum(['negate_condition', 'swap_sibling'])).default([]),
      })
      .strict(),
    stakes_max: z.literal('S1'),
  })
  .strict();

export const ItemModel = z.discriminatedUnion('kind', [ItemModelT1, ItemModelT2]);
export type ItemModel = z.infer<typeof ItemModel>;

export const ItemModelFile = z
  .object({
    schema_v: z.literal(1),
    concept_id: ConceptId,
    models: z.record(z.string().regex(/^im\d{2}$/), ItemModel),
  })
  .strict();
export type ItemModelFile = z.infer<typeof ItemModelFile>;
