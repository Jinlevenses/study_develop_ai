// DCP-01 §6.5.2 — packs/<track>/items/<concept_id>.yaml. 저작 형식 22종(랩 기반 code_task·sql_task·infra_lite는 items 파일에 쓰지 않는다).
import { ConceptId, RubricId } from '@fathom/contracts/common/ids';
import { Level, Tag } from '@fathom/contracts/common/domain';
import { z } from 'zod';
import { Bloom, FacetId, KuRef, McRef, Md, ObjKey, ResponseMode, StemFamily } from './common.js';

const ItemCommon = {
  facet: FacetId,
  response_mode: ResponseMode,
  level: Level,
  bloom: Bloom,
  stakes: z.enum(['S1', 'S2']).default('S2'),
  ku_refs: z.array(KuRef).min(1).max(16),
  mc_refs: z.array(McRef).max(6).default([]),
  stem_family: StemFamily,
  roles: z.array(z.enum(['pretest', 'placement', 'timecapsule'])).default([]),
  tags: z.array(Tag).default([]),
  gate_status: z.literal('authored'), // R-GATE: 저자는 항상 authored. seed_reviewed는 packc가 V7로 결정
  explanation_md: Md(20, 800),
  hints: z
    .object({ h1: Md(5, 300), h2: Md(5, 300), h3: Md(5, 400), h4: Md(5, 800) })
    .strict()
    .optional(),
};

export const Opt = z.string().regex(/^opt_[a-h]$/);
export const CodeLang = z.enum(['ts', 'js', 'sql', 'yaml', 'dockerfile', 'bash', 'python', 'json', 'http', 'text', 'diff']);
export const Code = z.object({ lang: CodeLang, src: z.string().min(1).max(4000) }).strict();
export const Normalize = z
  .object({
    nfkc: z.boolean().default(true),
    case: z.enum(['sensitive', 'insensitive']).default('insensitive'),
    space: z.enum(['collapse', 'remove']).default('collapse'),
    strip_josa: z.boolean().default(true),
  })
  .strict();

export const Item = z.discriminatedUnion('format', [
  z
    .object({
      format: z.literal('ox'),
      ...ItemCommon,
      stem: Md(10, 300),
      answer: z.boolean(),
      false_mc: McRef.optional(),
      correction_md: Md(10, 300),
    })
    .strict()
    .refine((i) => i.answer || i.false_mc !== undefined, 'answer=false면 false_mc 필수'),
  z
    .object({
      format: z.literal('mcq'),
      ...ItemCommon,
      stem: Md(10, 600),
      code: Code.optional(),
      options: z.record(Opt, Md(1, 200)),
      answer: Opt,
      distractor_mc: z.record(Opt, McRef).default({}),
      option_rationale: z.record(Opt, Md(5, 300)).default({}),
    })
    .strict(),
  z
    .object({
      format: z.literal('mcq_multi'),
      ...ItemCommon,
      stem: Md(10, 600),
      options: z.record(Opt, Md(1, 200)),
      answer: z.record(Opt, z.literal(true)),
    })
    .strict(),
  z
    .object({
      format: z.literal('cloze'),
      ...ItemCommon,
      stem: Md(10, 600), // {{b1}} 자리표시자
      blanks: z.record(
        z.string().regex(/^b[1-9]$/),
        z
          .object({
            accept: z.array(z.string().min(1).max(60)).min(1).max(8),
            normalize: Normalize.prefault({}),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      format: z.literal('short'),
      ...ItemCommon,
      stem: Md(10, 600),
      accept: z.array(z.string().min(1).max(80)).max(12).default([]),
      accept_regex: z.string().max(200).optional(),
      numeric: z
        .object({
          value: z.number(),
          tol_abs: z.number().min(0).optional(),
          tol_rel: z.number().min(0).max(0.5).optional(),
          unit: z.string().max(10).optional(),
        })
        .strict()
        .optional(),
      normalize: Normalize.prefault({}),
    })
    .strict(),
  z
    .object({
      format: z.literal('order'),
      ...ItemCommon,
      stem: Md(10, 400),
      steps: z.record(z.string().regex(/^s_[a-z0-9]{1,8}$/), Md(2, 200)),
      answer: z.array(z.string()).min(3).max(8),
    })
    .strict(),
  z
    .object({
      format: z.literal('matching'),
      ...ItemCommon,
      stem: Md(10, 300),
      left: z.record(z.string().regex(/^l_[a-z0-9]{1,8}$/), Md(1, 120)),
      right: z.record(z.string().regex(/^r_[a-z0-9]{1,8}$/), Md(1, 160)),
      answer: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      format: z.literal('code_predict'),
      ...ItemCommon,
      stem: Md(10, 400),
      code: Code.extend({ lang: z.enum(['js', 'ts', 'sql']) }),
      answer: z.union([z.literal('auto'), z.object({ stdout: z.string().max(2000) }).strict()]), // auto = V4가 계산해 채움
    })
    .strict(),
  z
    .object({
      format: z.literal('error_find'),
      ...ItemCommon,
      stem: Md(10, 400),
      code: Code,
      answer: z.object({ from: z.int().min(1), to: z.int().min(1) }).strict(),
      bug_mc: McRef.optional(),
    })
    .strict(),
  z
    .object({
      format: z.literal('parsons'),
      ...ItemCommon,
      stem: Md(10, 400),
      lang: CodeLang,
      lines: z.record(z.string().regex(/^ln_[a-z0-9]{1,8}$/), z.string().max(200)),
      answer: z.array(z.string()).min(3).max(15),
      distractors: z.array(z.string()).max(3).default([]),
      indent: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      format: z.literal('config_review'),
      ...ItemCommon,
      stem: Md(10, 400),
      artifact: Code.extend({ lang: z.enum(['yaml', 'dockerfile', 'json', 'ini', 'toml', 'hcl']) }),
      defect_manifest: z.record(
        z.string().regex(/^df_[a-z0-9_]{1,20}$/),
        z
          .object({
            from: z.int().min(1),
            to: z.int().min(1),
            rule: z.string().max(60),
            severity: z.enum(['high', 'mid', 'low']),
            mc_ref: McRef.optional(),
            note: Md(5, 200),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      format: z.literal('log_read'),
      ...ItemCommon,
      stem: Md(10, 400),
      log: Code,
      options: z.record(Opt, Md(1, 200)),
      answer: Opt,
      distractor_mc: z.record(Opt, McRef).default({}),
    })
    .strict(),
  z
    .object({
      format: z.literal('cond_reversal'),
      ...ItemCommon,
      scenario: Md(20, 600),
      conditions: z.object({ cond_a: Md(10, 300), cond_b: Md(10, 300) }).strict(),
      options: z.record(Opt, Md(1, 200)),
      answer: z.object({ cond_a: Opt, cond_b: Opt }).strict(), // 서로 달라야 함(flip, FR-QST-010)
      pivot_md: Md(10, 300),
    })
    .strict(),
  z
    .object({
      format: z.literal('fermi'),
      ...ItemCommon,
      stem: Md(20, 600),
      answer: z
        .object({ value: z.number().positive(), unit: z.string().max(12), log10_tol: z.number().min(0.1).max(1).default(0.5) })
        .strict(),
      assumptions_rubric: RubricId.optional(),
    })
    .strict(),
  z
    .object({
      format: z.literal('blank_note'),
      ...ItemCommon,
      prompt: Md(10, 400),
      idea_units: z.record(
        z.string().regex(/^iu_[a-z0-9_]{1,20}$/),
        z
          .object({
            text: z.string().max(160),
            ku_ref: KuRef,
            weight: z.number().min(0.5).max(2).default(1),
            keywords: z.array(z.string().max(30)).min(1).max(8),
          })
          .strict(),
      ),
      solo_rubric: RubricId.default('rb.solo-5'),
      model_note_md: Md(50, 2000), // 모범 노트 = 제출 후 공개
    })
    .strict(),
  z
    .object({
      format: z.literal('essay'),
      ...ItemCommon,
      prompt: Md(10, 600),
      key_points: z.record(
        z.string().regex(/^kp_[a-z0-9_]{1,20}$/),
        z.object({ text: z.string().max(160), ku_ref: KuRef }).strict(),
      ),
      rubric: RubricId,
      model_answer_md: Md(50, 2000),
    })
    .strict(),
  z
    .object({
      format: z.literal('digging'),
      ...ItemCommon,
      depth: z.enum(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']),
      question: Md(10, 300),
      expects: z.record(
        z.string().regex(/^kp_[a-z0-9_]{1,20}$/),
        z.object({ text: z.string().max(160), ku_ref: KuRef }).strict(),
      ),
      followups: z
        .record(
          ObjKey,
          z
            .object({
              when: z.enum(['partial', 'misconception', 'dont_know', 'off_topic']),
              mc_ref: McRef.optional(),
              question: Md(10, 300),
            })
            .strict(),
        )
        .default({}),
    })
    .strict(),
  z
    .object({
      format: z.literal('digging_d4_mcq'),
      ...ItemCommon,
      depth: z.enum(['d4', 'd5']),
      stem: Md(10, 600),
      options: z.record(Opt, Md(1, 240)),
      answer: Opt,
      distractor_mc: z.record(Opt, McRef).default({}),
    })
    .strict(),
  z
    .object({
      format: z.literal('feynman'),
      ...ItemCommon,
      student_persona: Md(10, 300),
      student_beliefs: z.record(
        z.string().regex(/^sb_[a-z0-9_]{1,20}$/),
        z.object({ mc_ref: McRef, opening_line: Md(10, 200) }).strict(),
      ),
      checklist: z.record(
        z.string().regex(/^ck_[a-z0-9_]{1,20}$/),
        z.object({ text: z.string().max(160), ku_ref: KuRef }).strict(),
      ),
      rubric: RubricId.default('rb.feynman-teach'),
    })
    .strict(),
  z
    .object({
      format: z.literal('audit'),
      ...ItemCommon,
      prompt: Md(10, 300),
      artifact_md: Md(100, 3000),
      defect_manifest: z.record(
        z.string().regex(/^df_[a-z0-9_]{1,20}$/),
        z
          .object({
            quote: z.string().max(200),
            kind: z.enum(['factual', 'omission', 'unsafe', 'outdated', 'overclaim']),
            mc_ref: McRef.optional(),
            correction: Md(5, 300),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      format: z.literal('pr_review'),
      ...ItemCommon,
      prompt: Md(10, 300),
      diff: Code.extend({ lang: z.literal('diff') }),
      defect_manifest: z.record(
        z.string().regex(/^df_[a-z0-9_]{1,20}$/),
        z
          .object({
            file: z.string().max(120),
            from: z.int().min(1),
            to: z.int().min(1),
            kind: z.enum(['security_weakness', 'std_violation', 'perf_resource']),
            cwe: z
              .string()
              .regex(/^CWE-\d{1,4}$/)
              .optional(),
            std_clause: z.string().max(60).optional(),
            note: Md(5, 300),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      format: z.literal('embedded'),
      ...ItemCommon,
      shape: z.enum(['ox', 'mcq']),
      stem: Md(10, 300),
      answer: z.union([z.boolean(), Opt]),
      options: z.record(Opt, Md(1, 160)).optional(),
      false_mc: McRef.optional(),
    })
    .strict(),
]);
export type Item = z.infer<typeof Item>;

export const ItemFile = z
  .object({
    schema_v: z.literal(1),
    concept_id: ConceptId,
    items: z.record(z.string().regex(/^i\d{2,3}$/), Item),
  })
  .strict();
export type ItemFile = z.infer<typeof ItemFile>;
