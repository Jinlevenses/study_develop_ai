import { z } from 'zod';
import { Facet, KnowledgeType, Level, Tag, Tier, Volatility } from '../../../common/domain.js';
import { BlueprintId, CaseId, ConceptId, KuId, MisconceptionId, ObjKey, PackId, PathId, SemVer, Sha256Hex, SourceId, TrackId, Ulid } from '../../../common/ids.js';
import { NdjsonEnd } from '../../../common/ndjson.js';
import { Cursor } from '../../../common/pagination.js';
import { FeasibilityBlocker } from '../../../common/practice.js';
import { Problem } from '../../../common/problem.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs, StudyDay } from '../../../common/time.js';
import { ConceptRef } from '../../../events/catalog/catalog.js';
import { AssessmentInventory } from '../../../pack/feasibility.js';

export const PackChannel = z.enum(['seed', 'local', 'user']);
export type PackChannel = z.infer<typeof PackChannel>;
export const PackSource = z.discriminatedUnion('kind', [
  S({ kind: z.literal('bundled'), track: TrackId.nullable() }),                        // 번들 동봉 dist/packs/*.fpack (null = 전부)
  S({ kind: z.literal('file'), path: z.string().min(1).max(1024) }),                   // .fpack 절대 경로
  S({ kind: z.literal('user_dir'), dir: z.string().min(1).max(1024) }),                // R3: 원천 디렉터리 → packc 자식 컴파일
]);
export type PackSource = z.infer<typeof PackSource>;
export const InstallPackRequest = S({ install_id: Ulid, source: PackSource, channel: PackChannel, allow_downgrade: z.boolean() });
export type InstallPackRequest = z.infer<typeof InstallPackRequest>;
export const PackInstallView = S({
  install_id: Ulid, state: z.enum(['verifying', 'compiling', 'loading', 'reapplying_overlays', 'activating', 'activated', 'failed', 'awaiting_work_order']),
  packs: z.array(S({ pack_id: PackId, track: TrackId, version: SemVer, previous_version: SemVer.nullable(), conflicts: z.number().int().min(0) })).max(25),
  problem: Problem.nullable(), started_at: EpochMs, finished_at: EpochMs.nullable(),
});
export type PackInstallView = z.infer<typeof PackInstallView>;
export const TrackCap = S({ declared: Level, offline: Level, oracle: Level, display: Level });
export type TrackCap = z.infer<typeof TrackCap>;
export const PackKpi = S({                                                         // FR-CUR-026, D-11 — packc report.json `kpi`와 같은 모양(CR-51)
  three_stage: S({ full: z.number().min(0).max(1), lite: z.number().min(0).max(1), skeleton: z.number().min(0).max(1) }),   // A·B·C 3단 충족 비율(트랙 개념 수 분모)
  offline_learnable: z.number().int().min(0) });                                   // AI 없이 3단 + 결정적 문항 ≥ 1인 개념 수   // display = Brief 전까지 oracle(SP-6 감사, CR-22)
export type PackKpi = z.infer<typeof PackKpi>;
export const InstalledPack = S({
  pack_id: PackId, track: TrackId, version: SemVer, channel: PackChannel, manifest_hash: Sha256Hex, merkle_root: Sha256Hex, activated_at: EpochMs,
  counts: S({ concepts: z.number().int(), kus: z.number().int(), misconceptions: z.number().int(), items: z.number().int(), cases: z.number().int() }),
  report: S({ kpi: PackKpi, tier_counts: S({ A: z.number().int(), B: z.number().int(), C: z.number().int() }),
    cap_blockers: z.array(FeasibilityBlocker).max(100) }),
});
export type InstalledPack = z.infer<typeof InstalledPack>;
export const InstalledPackList = S({ packs: z.array(InstalledPack).max(100) });
export type InstalledPackList = z.infer<typeof InstalledPackList>;
export const TrackCatalog = S({ tracks: z.array(S({
  track: TrackId, title_ko: z.string().max(60), title_en: z.string().max(60),
  concept_counts: z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()]),
  cap: TrackCap, kpi: PackKpi, pack: S({ pack_id: PackId, version: SemVer, channel: PackChannel }) })).max(40) });
export type TrackCatalog = z.infer<typeof TrackCatalog>;
// Volatility·Tag = common/domain.ts(CR-35 — pack/records.ts·ledger와 공유)
export const ConceptSummary = S({
  concept_id: ConceptId, track: TrackId, level: Level, tier: Tier, knowledge_type: KnowledgeType,
  title_ko: z.string().max(120), title_en: z.string().max(120), summary_ko: z.string().max(300),
  aliases: z.array(z.string().max(80)).max(20), required_for_level: Level.nullable(), deprecated_by: ConceptId.nullable(),
  volatility: Volatility, tags: z.array(Tag).max(20),
});
export type ConceptSummary = z.infer<typeof ConceptSummary>;
export const TrackConceptsQuery = S({ level: z.coerce.number().int().min(1).max(5).optional(), cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200) });
export type TrackConceptsQuery = z.infer<typeof TrackConceptsQuery>;
export const KnowledgeUnitView = S({
  ku_id: KuId, statement_ko: z.string().max(1000), facet: Facet, scope: z.string().max(300).nullable(), volatility: Volatility,
  valid_as_of: StudyDay.nullable(), deprecated_by: KuId.nullable(),
  source_refs: z.array(S({ source_id: SourceId, locator: z.string().max(200).nullable(), span: S({ start: z.number().int(), end: z.number().int() }).nullable() })).max(10),
});
export type KnowledgeUnitView = z.infer<typeof KnowledgeUnitView>;
export const MisconceptionView = S({ mc_id: MisconceptionId, wrong_belief_ko: z.string().max(500), correction_ko: z.string().max(1000),
  meta_family: z.string().max(60), refutes: z.array(KuId).max(10), status: z.enum(['active', 'retired']) });
export type MisconceptionView = z.infer<typeof MisconceptionView>;
export const SourceRef = S({ source_id: SourceId, title: z.string().max(200), grade: z.enum(['A', 'B', 'C', 'D', 'P']),
  url: z.string().url().nullable(), edition: z.string().max(60).nullable(), license: z.string().max(60), retrieved_at: StudyDay.nullable() });
export type SourceRef = z.infer<typeof SourceRef>;
export const NeighborGraph = S({ center: ConceptId,
  nodes: z.array(S({ concept_id: ConceptId, title_ko: z.string(), track: TrackId, level: Level })).max(50),
  edges: z.array(S({ from: ConceptId, to: ConceptId, kind: z.enum(['prereq', 'related', 'contrast', 'part_of']) })).max(200) });
export type NeighborGraph = z.infer<typeof NeighborGraph>;
export const SourceDrawer = S({ concept_id: ConceptId, sources: z.array(SourceRef).max(30),
  ku_spans: z.array(S({ ku_id: KuId, source_id: SourceId, locator: z.string().max(200).nullable(), quote_ko: z.string().max(500).nullable() })).max(100),
  disagreements: z.array(S({ ku_id: KuId, note_md: z.string().max(2000) })).max(20) });                    // FR-CUR-021
export type SourceDrawer = z.infer<typeof SourceDrawer>;
export const PathListView = S({ paths: z.array(S({ path_id: PathId, title_ko: z.string(), description_ko: z.string().max(500),   // 원천 = ct_path(팩 x.paths·트랙 팩 paths/, CR-52)
  tracks: z.array(TrackId), concept_ids: z.array(ConceptId).max(300) })).max(50) });
export type PathListView = z.infer<typeof PathListView>;
export const LayoutView = S({ track: z.union([TrackId, z.literal('all')]), version: Sha256Hex, width: z.number(), height: z.number(),
  nodes: z.record(ConceptId, S({ x: z.number(), y: z.number() })), edges: z.array(S({ from: ConceptId, to: ConceptId })).max(5000) });
export type LayoutView = z.infer<typeof LayoutView>;
export const SearchQuery = S({ q: z.string().min(1).max(200),
  kinds: z.string().regex(/^(concept|ku|misconception|case|path)(,(concept|ku|misconception|case|path)){0,4}$/).optional(),   // = ct_search_doc.kind 집합(CR-52)
  track: TrackId.optional(), limit: z.coerce.number().int().min(1).max(50).default(10) });
export type SearchQuery = z.infer<typeof SearchQuery>;
export const SearchResultView = S({
  items: z.array(S({ kind: z.enum(['concept', 'ku', 'misconception', 'case', 'path']), id: z.string().max(160), concept_id: ConceptId.nullable(),
    title_ko: z.string(), snippet_ko: z.string().max(300), track: TrackId.nullable(), level: Level.nullable(), score: z.number() })).max(50),
  engine: z.enum(['v2', 'v3']), took_ms: DurationMs,                   // v3 = 문서 수 > search_params@v1.v3_switch_docs(20,000)
});
export type SearchResultView = z.infer<typeof SearchResultView>;
export const CurriculumExportQuery = S({ since: z.coerce.number().int().min(0).optional() });   // catalog version, 없으면 전체
export type CurriculumExportQuery = z.infer<typeof CurriculumExportQuery>;
export const CurriculumExportHeader = S({ kind: z.literal('header'), v: z.literal(1), version: z.number().int().min(0), full: z.boolean(),
  pack_set_hash: Sha256Hex, packs: z.array(S({ pack_id: PackId, track: TrackId, version: SemVer, manifest_hash: Sha256Hex })), generated_at: EpochMs });
export type CurriculumExportHeader = z.infer<typeof CurriculumExportHeader>;
export const CurriculumExportLine = z.discriminatedUnion('kind', [
  CurriculumExportHeader,
  S({ kind: z.literal('concept'), concept: ConceptRef }),                                         // = IF-EV-02 ConceptRef
  S({ kind: z.literal('case'), case: S({ case_id: CaseId, tracks: z.array(TrackId).min(1), level: Level, floor: z.boolean() }) }),
  S({ kind: z.literal('inventory'), track: TrackId, inventory: AssessmentInventory }),            // structuralFeasibility 입력(§13.3) → lr_curriculum_inventory
  S({ kind: z.literal('path'), path: S({ path_id: PathId, title_ko: z.string().max(120), tracks: z.array(TrackId).max(20),
    concept_ids: z.array(ConceptId).max(300) }) }),                                               // SessionScope{kind:'path'} 해석(content 정지 중, D-9, CR-52)
  NdjsonEnd,
]);
export type CurriculumExportLine = z.infer<typeof CurriculumExportLine>;
export const BlueprintView = S({ blueprint_id: BlueprintId, title_ko: z.string(), edition: z.string().max(40),
  source_edition: S({ kind: z.enum(['git', 'user_file', 'manual']), commit_sha: z.string().regex(/^[0-9a-f]{40}$/).nullable(), sha256: Sha256Hex }),
  domains: z.array(S({ key: ObjKey, title_ko: z.string(), weight: z.number().min(0).max(1), concept_ids: z.array(ConceptId).max(200) })).max(40) });
export type BlueprintView = z.infer<typeof BlueprintView>;
export const BlueprintList = S({ blueprints: z.array(BlueprintView).max(20) });
export type BlueprintList = z.infer<typeof BlueprintList>;
export const ImportBlueprintBody = S({ blueprint_id: BlueprintId, file_path: z.string().min(1).max(1024), edition: z.string().max(40) });
export type ImportBlueprintBody = z.infer<typeof ImportBlueprintBody>;
export const OutdatedReportBody = S({ report_id: Ulid, ku_ids: z.array(KuId).max(20), note_ko: z.string().max(1000) });
export type OutdatedReportBody = z.infer<typeof OutdatedReportBody>;
export const OutdatedReportView = S({ report_id: Ulid, concept_id: ConceptId, state: z.enum(['received', 'revalidating', 'resolved']), cl_x: z.boolean(), created_at: EpochMs });
export type OutdatedReportView = z.infer<typeof OutdatedReportView>;
export const PackRefreshBody = S({ install_id: Ulid, track: TrackId, work_order_id: Ulid.nullable() });
export type PackRefreshBody = z.infer<typeof PackRefreshBody>;
export const CaseCatalogView = S({ cases: z.array(S({ case_id: CaseId, title_ko: z.string(), tracks: z.array(TrackId), level: Level,
  variants: z.number().int().min(1), floor: z.boolean() })).max(200) });
export type CaseCatalogView = z.infer<typeof CaseCatalogView>;
