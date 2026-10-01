import { z } from 'zod';
import { FormatId, KnowledgeType, Level, ModeId, ResponseMode, Tier } from '../common/domain.js';
import { S } from '../common/schema.js';

const P = z.number().min(0).max(1);
const LevelKey = z.enum(['1', '2', '3', '4', '5']);

// IF-01 §13.4 — formats 절은 블록 전사(w_format의 유일한 저장 위치, DCP §6.5.1 값, CR-36). 키 = FormatId 33종 전부(누락·추가 = 위반).
export const FormatPolicy = S({
  w_format: z.number().min(0).max(1),
  grade_class: z.enum(['D', 'J', 'S', 'H']), // OFFLINE 기본 채점 엔진 등급
  response_mode: ResponseMode,
  n_options: S({ min: z.number().int().min(0), max: z.number().int().min(0) }),
  credit_eligible: z.boolean(),
  runner: z.boolean(),
  tiers: z.array(Tier).min(1),
}); // DCP-01 §6.5.1 표의 열
export type FormatPolicy = z.infer<typeof FormatPolicy>;
export const MethodFormats = z
  .record(FormatId, FormatPolicy)
  .refine((m) => FormatId.options.every((f) => f in m), 'formats must cover every FormatId');
export type MethodFormats = z.infer<typeof MethodFormats>;

// [Brief 결정 §4.6 — CR-43 T1 저작] 아래는 formats 외 키(router_25·taboo·level_mix)의 상세 zod. 값 출처 = PED §4.3·§4.5·conv §6.3.
export const BloomLevel = z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']);
export type BloomLevel = z.infer<typeof BloomLevel>;
export const RouterRow = z.enum(['D', 'C', 'P', 'S', 'M']); // KnowledgeType 4 + M(메타인지) 행 = PED §4.3 "25칸"
export type RouterRow = z.infer<typeof RouterRow>;
export const RouterCell = S({
  formats: z.array(FormatId).max(12),
  bloom: z.record(BloomLevel, P).nullable(),
  scaffolding: z.enum(['full', 'faded', 'minimal', 'none']),
  digging_depth_max: z.number().int().min(1).max(7).nullable(),
})
  .refine((c) => new Set(c.formats).size === c.formats.length, 'formats must not repeat')
  .refine(
    (c) => c.bloom === null || Math.abs(Object.values(c.bloom).reduce((a, b) => a + b, 0) - 1) <= 1e-9,
    'bloom distribution must sum to 1',
  );
export type RouterCell = z.infer<typeof RouterCell>;
export const Router25 = z.record(RouterRow, z.record(LevelKey, RouterCell));
export type Router25 = z.infer<typeof Router25>;
export const TabooRule = S({
  id: z.string().regex(/^TB-\d{2}$/),
  levels: z.array(Level).min(1).max(5),
  knowledge_types: z.array(KnowledgeType).max(4), // [] = 전 유형
  effect: z.discriminatedUnion('kind', [
    S({ kind: z.literal('exclude_formats'), formats: z.array(FormatId).min(1).max(33) }),
    S({ kind: z.literal('max_share'), formats: z.array(FormatId).min(1).max(33), share_max: P }),
    S({ kind: z.literal('digging_depth_max'), depth: z.number().int().min(1).max(7) }),
    S({ kind: z.literal('evidence_weight'), formats: z.array(FormatId).min(1).max(33), w: P }),
  ]),
  reason_ko: z.string().min(1).max(200),
});
export type TabooRule = z.infer<typeof TabooRule>;
export const ActivityGroup = z.enum(['code', 'retrieval', 'implement', 'blank_note', 'digging', 'case']); // conv §6.3 6활동군
export type ActivityGroup = z.infer<typeof ActivityGroup>;
export const LevelMix = S({
  groups: z.record(ActivityGroup, z.array(ModeId).min(1).max(8)),
  shares: z.record(LevelKey, z.record(ActivityGroup, P)),
  tolerance: P,
}).refine(
  (m) => Object.values(m.shares).every((row) => Math.abs(Object.values(row).reduce((a, b) => a + b, 0) - 1) <= 1e-9),
  'level_mix shares must sum to 1 per level',
);
export type LevelMix = z.infer<typeof LevelMix>;
// 칸 값의 FR-STD-007 "형식 후보 ≥ 2"는 값(T-00-15) 검사라 스키마에 넣지 않는다.
export const MethodPolicyV1 = S({
  version: z.literal('method_policy@v1'),
  router_25: Router25,
  taboo: z.array(TabooRule).max(40),
  level_mix: LevelMix,
  formats: MethodFormats,
}).refine((p) => new Set(p.taboo.map((t) => t.id)).size === p.taboo.length, 'taboo ids must be unique');
export type MethodPolicyV1 = z.infer<typeof MethodPolicyV1>;
