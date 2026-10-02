// DCP-01 §6.2.1 — packs/<track>/concepts/<concept_id>.md frontmatter.
import { ConceptId, TrackId } from '@fathom/contracts/common/ids';
import { KnowledgeType, Level, Tag, Tier, Volatility } from '@fathom/contracts/common/domain';
import { z } from 'zod';
import { Bloom, IsoDate, KeyMap, ObjKey, SourceRef } from './common.js';

export const ConceptFrontmatter = z
  .object({
    schema_v: z.literal(1),
    id: ConceptId, // = 파일 이름
    track: TrackId, // = id 첫 마디
    level: Level,
    tier: Tier,
    knowledge_type: z.object({ primary: KnowledgeType, secondary: z.array(KnowledgeType).max(2).default([]) }).strict(),
    stage2_kind: z.enum(['code', 'case']),
    title: z.object({ ko: z.string().min(1).max(60), en: z.string().min(1).max(80) }).strict(),
    summary_ko: z.string().min(10).max(160),
    aliases: z.array(z.string().min(1).max(60)).max(12),
    tags: z.array(Tag).max(16).default([]),
    volatility: Volatility,
    required_for_level: Level.nullable(), // Tier A/B = level, Tier C = null (R-REQ)
    prereqs: z.array(ConceptId).max(8).default([]),
    siblings: z.record(ConceptId, z.object({ axis: z.string().min(2).max(60) }).strict()).default({}),
    extends: z.array(ConceptId).max(4).default([]),
    deprecated_by: ConceptId.nullable().default(null),
    id_aliases: z.array(ConceptId).default([]),
    sources: z.array(SourceRef).max(12),
    diagrams: z
      .record(ObjKey, z.object({ alt: z.string().min(5).max(120), summary: z.string().min(40).max(400) }).strict())
      .default({}),
    learning: z
      .object({
        objectives: KeyMap(z.object({ bloom: Bloom, text: z.string().min(10).max(140) }).strict(), 3, 6),
        depth_facets: z.partialRecord(z.enum(['l2', 'l3', 'l4', 'l5']), z.string().min(10).max(200)).default({}),
        pre_questions: z.array(z.string().min(10).max(140)).length(2),
        contrast_pairs: z
          .record(ObjKey, z.object({ a: z.string(), b: z.string(), axis: z.string().max(80) }).strict())
          .default({}),
        mnemonic: z.string().max(80).optional(),
        estimated_minutes: z
          .object({ theory: z.int().min(1).max(60), code: z.int().min(0).max(90), core: z.int().min(1).max(30) })
          .strict(),
      })
      .strict()
      .optional(),
    review: z
      .object({
        verified_against: z.string().max(60).optional(),
        valid_as_of: IsoDate,
        review_by: IsoDate,
      })
      .strict(),
  })
  .strict();
export type ConceptFrontmatter = z.infer<typeof ConceptFrontmatter>;
