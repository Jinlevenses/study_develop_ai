import { z } from 'zod';
import {
  Facet,
  FormatId,
  KnowledgeType,
  Level,
  ResponseMode,
  Stakes,
  Tag,
  Tier,
  Volatility,
} from '../common/domain.js';
import {
  ArtifactId,
  BlueprintId,
  CaseId,
  ConceptId,
  ItemId,
  ItemModelId,
  KuId,
  LabId,
  MisconceptionId,
  ObjKey,
  PathId,
  ProviderId,
  RubricId,
  SemVer,
  Sha256Hex,
  SourceId,
  TrackId,
  Ulid,
} from '../common/ids.js';
import { ArtifactTemplateKind } from '../common/practice.js';
import { S } from '../common/schema.js';
import { EpochMs, StudyDay } from '../common/time.js';
import { GateStatus } from '../http/content/v1/itembank.js';

// 번역 규칙(코드 = 이 블록, DB = DB-01 §5.5, 원천 = DCP-01 §5.3):
//  ① 필드 이름 = DB 열 이름. 단 DB `<f>_json` 열 ↔ 레코드 필드 `<f>`(타입 있는 객체·배열), DB INTEGER 0/1 ↔ boolean.
//  ② DB `kind` 열 ↔ 필드 `<record>_kind`(edge_kind·case_kind·artifact_kind·lab_kind), ct_source.kind ↔ `source_type` — 줄의 `kind`는 레코드 판별자.
//  ③ install_id·ext_v·적재 시각 열(created_at·status_at·gate_status_at)은 레코드에 없다(pack-load가 채움). `ext` 키 = 'pack.<field>'(DCP DN-13).
//  ④ content_hash = sha256(canonicalJson(레코드 − content_hash)). 예외: GateResultRecord.content_hash = 검사 대상 리비전(ib_gate_result 열 의미 그대로).
const Ext = z.record(z.string().regex(/^pack\.[a-z_]+$/), z.json());
const Md = (max: number) => z.string().max(max);
const H = { content_hash: Sha256Hex };
export const PackSourceRef = S({
  source_id: SourceId,
  locator: z.string().min(1).max(300),
  section: z.string().min(1).max(200),
  usage: z.enum(['link_only', 'paraphrase', 'short_quote', 'code_adapted']),
  retrieved_at: StudyDay,
  product_version: z.string().max(40).nullable(),
  quote: z.string().max(200).nullable(),
}); // DCP §6.0 SourceRef(선택 키는 null로 정규화)
export type PackSourceRef = z.infer<typeof PackSourceRef>;
export const TrackRecord = S({
  kind: z.literal('track'),
  track_id: TrackId,
  name_ko: z.string().max(30),
  name_en: z.string().max(40),
  track_group: z.enum(['foundation', 'app', 'infra', 'security', 'ai', 'design_lead']),
  sort_order: z.number().int().min(1).max(99),
  offline_cap_level: z.number().int().min(0).max(5),
  oracle_cap_level: z.number().int().min(0).max(5),
  summary_ko: z.string().max(300),
  ext: Ext,
  ...H,
});
export type TrackRecord = z.infer<typeof TrackRecord>;
export const ConceptRecord = S({
  kind: z.literal('concept'),
  concept_id: ConceptId,
  track_id: TrackId,
  level: Level,
  knowledge_type: KnowledgeType,
  tier: Tier,
  title_ko: z.string().max(60),
  title_en: z.string().max(80),
  summary_ko: z.string().max(160),
  aliases: z.array(z.string().max(60)).max(12),
  tags: z.array(Tag).max(16),
  volatility: Volatility,
  required_for_level: Level.nullable(),
  deprecated_by: ConceptId.nullable(),
  theory_md: Md(40_000),
  code_md: Md(40_000),
  core_md: Md(20_000),
  diagrams: z.record(
    ObjKey,
    S({ mermaid: z.string().max(20_000), alt: z.string().min(5).max(120), summary: z.string().min(40).max(400) }),
  ),
  sources: z.array(PackSourceRef).max(12),
  ext: Ext,
  ...H,
});
export type ConceptRecord = z.infer<typeof ConceptRecord>;
export const EdgeRecord = S({
  kind: z.literal('edge'),
  from_concept_id: ConceptId,
  to_concept_id: ConceptId,
  edge_kind: z.enum(['prereq', 'sibling', 'extends']),
  weight: z.number(),
}); // prereq: from = 선수
export type EdgeRecord = z.infer<typeof EdgeRecord>;
export const AliasRecord = S({
  kind: z.literal('alias'),
  entity_kind: z.enum(['concept', 'ku', 'misconception', 'item']),
  alias_id: z.string().max(140),
  target_id: z.string().max(140),
});
export type AliasRecord = z.infer<typeof AliasRecord>;
export const KuRecord = S({
  kind: z.literal('ku'),
  ku_id: KuId,
  concept_id: ConceptId,
  statement: z.string().min(10).max(200),
  facet: Facet,
  scope: z.string().max(80),
  vol: Volatility,
  valid_as_of: StudyDay.nullable(),
  deprecated_by: KuId.nullable(),
  source_refs: z.array(PackSourceRef).min(1).max(10),
  trust: z.enum(['authored', 'verified', 'user', 'llm_unverified']),
  origin: z.string().regex(/^(authored|import:[0-9A-HJKMNP-TV-Z]{26}|tier_promotion:[0-9A-HJKMNP-TV-Z]{26})$/),
  status: z.enum(['published', 'needs_review', 'deprecated']),
  ext: Ext,
  ...H,
});
export type KuRecord = z.infer<typeof KuRecord>;
export const MisconceptionRecord = S({
  kind: z.literal('misconception'),
  mc_id: MisconceptionId,
  concept_id: ConceptId,
  statement: z.string().min(10).max(200),
  correction: z.string().min(10).max(240),
  meta_family: z.string().regex(/^mf_[a-z_]{3,30}$/),
  related_ku_ids: z.array(KuId).min(1).max(10),
  status: z.enum(['active', 'deprecated']),
  ext: Ext,
  ...H,
});
export type MisconceptionRecord = z.infer<typeof MisconceptionRecord>;
export const SourceRecord = S({
  kind: z.literal('source'),
  source_id: SourceId,
  source_type: z.enum(['web', 'doc', 'book', 'rfc', 'paper', 'repo', 'user']),
  title: z.string().max(200),
  url: z.string().url().nullable(),
  ref_text: z.string().max(300).nullable(),
  license_grade: z.enum(['A', 'B', 'C', 'D', 'P']),
  fetched_at: EpochMs.nullable(),
  ext: Ext,
  ...H,
}); // ext["pack.license"] = 라이선스 상세
export type SourceRecord = z.infer<typeof SourceRecord>;
export const RubricRecord = S({
  kind: z.literal('rubric'),
  rubric_id: RubricId,
  dims: S({
    dims: z.record(
      ObjKey,
      S({
        name: z.string().max(60),
        weight: z.number().min(0).max(1),
        levels: z.record(z.string().regex(/^l[0-5]$/), z.string().max(300)),
      }),
    ),
  }),
  ext: Ext,
  ...H,
});
export type RubricRecord = z.infer<typeof RubricRecord>;
export const CaseRecord = S({
  kind: z.literal('case'),
  case_id: CaseId,
  track_id: TrackId,
  level: z.number().int().min(3).max(5),
  case_kind: z.enum(['incident', 'design', 'review', 'migration', 'tradeoff']),
  title_ko: z.string().max(120),
  spec: z.record(z.string(), z.json()), // concepts·related_tracks·situation_md·constraints·evidence·decision_points(best_if 제외)·replay
  variant_params: z.record(ObjKey, z.json()),
  root_cause_pool: z.record(ObjKey, z.json()),
  best_if: z.record(ObjKey, S({ rules: z.record(ObjKey, z.json()), default_best: ObjKey })),
  contested: z.boolean(),
  rubric_id: RubricId,
  debrief_md: Md(20_000),
  inspired_by: z.string().max(300).nullable(),
  primary_sources: z.array(PackSourceRef).max(12),
  ext: Ext,
  ...H,
});
export type CaseRecord = z.infer<typeof CaseRecord>;
export const ArtifactRecord = S({
  kind: z.literal('artifact'),
  artifact_id: ArtifactId,
  track_id: TrackId,
  level: z.number().int().min(2).max(5),
  artifact_kind: ArtifactTemplateKind,
  title_ko: z.string().max(120),
  template_md: Md(20_000),
  rubric_id: RubricId,
  rebuttal_bank: z.record(ObjKey, z.json()),
  model_answer_md: Md(40_000),
  primary_sources: z.array(PackSourceRef).max(12),
  ext: Ext,
  ...H,
});
export type ArtifactRecord = z.infer<typeof ArtifactRecord>;
export const LabRecord = S({
  kind: z.literal('lab'),
  lab_id: LabId,
  track_id: TrackId,
  level: Level,
  lab_kind: z.enum(['code', 'kata', 'algorithm', 'security_patch', 'infra', 'sql', 'predict']),
  language: z.enum(['js', 'ts', 'sql', 'yaml', 'dockerfile', 'python_view']),
  task_md: Md(40_000),
  starter_code: Md(65_536),
  public_tests: Md(65_536),
  hidden_tests: Md(262_144),
  complexity: z.json().nullable(),
  oracle_log_sha256: Sha256Hex.nullable(),
  ext: Ext,
  ...H,
});
export type LabRecord = z.infer<typeof LabRecord>;
export const BlueprintRecord = S({
  kind: z.literal('blueprint'),
  blueprint_id: BlueprintId,
  exam: z.string().max(120),
  edition: z.string().max(40),
  source_url: z.string().max(1024),
  source_edition: z.string().max(80),
  title_ko: z.string().max(120),
  ext: Ext,
  ...H,
});
export type BlueprintRecord = z.infer<typeof BlueprintRecord>;
export const BlueprintItemRecord = S({
  kind: z.literal('blueprint_item'),
  blueprint_id: BlueprintId,
  section_key: z.string().regex(/^s\d{1,2}(_\d{1,2})?$/),
  parent_key: z
    .string()
    .regex(/^s\d{1,2}(_\d{1,2})?$/)
    .nullable(),
  title_ko: z.string().max(200),
  weight: z.number().min(0).max(1),
});
export type BlueprintItemRecord = z.infer<typeof BlueprintItemRecord>;
export const BlueprintMapRecord = S({
  kind: z.literal('blueprint_map'),
  blueprint_id: BlueprintId,
  section_key: z.string().regex(/^s\d{1,2}(_\d{1,2})?$/),
  concept_id: ConceptId,
  weight: z.number().min(0),
});
export type BlueprintMapRecord = z.infer<typeof BlueprintMapRecord>;
export const PathRecord = S({
  kind: z.literal('path'),
  path_id: PathId,
  title_ko: z.string().max(120),
  description_ko: z.string().max(500),
  tracks: z.array(TrackId).max(20),
  concept_ids: z.array(ConceptId).min(1).max(300),
  ...H,
}); // → ct_path(CR-52)
export type PathRecord = z.infer<typeof PathRecord>;
export const ItemModelRecord = S({
  kind: z.literal('item_model'),
  model_id: ItemModelId.or(Ulid),
  origin: z.enum(['pack', 'runtime']),
  concept_id: ConceptId,
  format: FormatId,
  ku_ids: z.array(KuId).max(20),
  slots: z.record(ObjKey, z.json()),
  constraints: z.json(),
  metamorphic: z.json(),
  stem_family: z.string().regex(/^sf_[a-z0-9_]{2,28}$/),
  status: z.enum(['draft', 'active', 'retired']),
  author: z.enum(['seed', 'llm', 'user']),
  prompt_version: SemVer.nullable(),
  sample_gate: z.json(),
  ext: Ext,
  ...H,
});
export type ItemModelRecord = z.infer<typeof ItemModelRecord>;
export const ItemRecord = S({
  kind: z.literal('item'),
  item_id: ItemId,
  origin: z.enum(['pack', 'runtime']),
  model_id: ItemModelId.or(Ulid).nullable(),
  family_id: z.string().max(120),
  concept_id: ConceptId,
  ku_ids: z.array(KuId).max(20),
  mc_ids: z.array(MisconceptionId).max(20),
  facet: Facet,
  format: FormatId,
  response_mode: ResponseMode,
  level: Level,
  bloom: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  stakes: Stakes,
  tier: Tier,
  n_options: z.number().int().min(0),
  beta_prior: z.number(),
  stem: z.json(),
  options: z.record(ObjKey, z.json()),
  answer_key: z.json(),
  explanation_md: Md(20_000),
  distractor_mc: z.record(ObjKey, MisconceptionId),
  lab_id: LabId.nullable(),
  source_kind: z.enum([
    'seed',
    't1',
    't2',
    't3',
    't4',
    'gap',
    'user_error',
    'past_self',
    'user_authored',
    'repo',
    'imported',
  ]),
  stem_family: z.string().regex(/^sf_[a-z0-9_]{2,28}$/),
  gate_status: GateStatus,
  defect_manifest: z.json().nullable(),
  s2_mode: z.enum(['cross_family', 'same_family', 'v7_review']).nullable(),
  lineage: z.json(),
  snapshot: z.json(),
  ext: Ext,
  ...H,
});
export type ItemRecord = z.infer<typeof ItemRecord>;
export const GateResultRecord = S({
  kind: z.literal('gate_result'),
  gate_result_id: Ulid,
  subject_kind: z.enum(['item', 'item_model']),
  subject_id: z.string().max(140),
  content_hash: Sha256Hex,
  gate: z.string().regex(/^(G\d{1,2}|V7|S2_APPROVAL|META)$/),
  engine: z.enum(['D', 'J', 'LJ', 'H', 'S', 'USER', 'ORACLE']),
  provider_id: ProviderId.nullable(),
  run_context: z.literal('seed_build'),
  pass: z.boolean(),
  score: z.number().nullable(),
  probabilities: z.record(ObjKey, z.number()).nullable(),
  detail: z.json(),
});
export type GateResultRecord = z.infer<typeof GateResultRecord>;
export const BundleRecord = z.discriminatedUnion('kind', [
  TrackRecord,
  ConceptRecord,
  EdgeRecord,
  AliasRecord,
  KuRecord,
  MisconceptionRecord,
  SourceRecord,
  RubricRecord,
  CaseRecord,
  ArtifactRecord,
  LabRecord,
  BlueprintRecord,
  BlueprintItemRecord,
  BlueprintMapRecord,
  PathRecord,
  ItemModelRecord,
  ItemRecord,
  GateResultRecord,
]); // 18종 = DB-01 §14.1 표 + path
export type BundleRecord = z.infer<typeof BundleRecord>;
