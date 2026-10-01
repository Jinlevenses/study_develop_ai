import { z } from 'zod';
import { KnowledgeType, Level, Tag, Tier, Volatility } from '../../common/domain.js';
import { ConceptId, KuId, PackId, SemVer, type ServiceName, Sha256Hex, TrackId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { EpochMs } from '../../common/time.js';
// biome-ignore lint/suspicious/noImportCycles: [Brief 결정 D1] 순환 import는 getter로 TDZ를 피한다(IF-01 §6 스키마 상호 참조)
import { PackChannel } from '../../http/content/v1/catalog.js';
import { OverlayTargetKind } from '../../http/content/v1/overlays.js';

export const ConceptRef = S({
  // learning lr_curriculum_ref 한 행 = catalog Published Language (§15 D-13: title·tags 추가)
  concept_id: ConceptId,
  track: TrackId,
  level: Level,
  tier: Tier,
  knowledge_type: KnowledgeType,
  title_ko: z.string().max(120),
  title_en: z.string().max(120),
  summary_ko: z.string().max(300),
  prereq_ids: z.array(ConceptId).max(30),
  required_for_level: Level.nullable(),
  aliases: z.array(z.string().max(80)).max(20),
  deprecated_by: ConceptId.nullable(),
  volatility: Volatility,
  tags: z.array(Tag).max(20),
  version: z.number().int().min(0), // catalog 단조 버전(이 개념이 마지막으로 바뀐 버전)
  content_hash: Sha256Hex,
});
export type ConceptRef = z.infer<typeof ConceptRef>;
export const CatalogPackActivatedV1 = S({
  // IF-EV-01
  pack_id: PackId,
  track: TrackId,
  version: SemVer,
  get channel() {
    return PackChannel;
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  manifest_hash: Sha256Hex,
  merkle_root: Sha256Hex,
  previous_version: SemVer.nullable(),
  changed_concept_ids: z.array(ConceptId).max(2000),
  changed_ku_ids: z.array(KuId).max(20_000),
  offline_cap_level: Level,
  catalog_version: z.number().int().min(0),
  activated_at: EpochMs,
});
export type CatalogPackActivatedV1 = z.infer<typeof CatalogPackActivatedV1>;
export const CatalogConceptChangedV1 = S({
  // IF-EV-02 (event-carried state transfer)
  change: z.enum(['published', 'revised', 'deprecated', 'tier_promoted']),
  concept: ConceptRef,
  pack_id: PackId,
  version: SemVer,
});
export type CatalogConceptChangedV1 = z.infer<typeof CatalogConceptChangedV1>;
export const CatalogOverlayConflictedV1 = S({
  // IF-EV-03
  conflict_id: Ulid,
  patch_id: Ulid,
  target_kind: OverlayTargetKind,
  target_id: z.string().max(160),
  field: z.string().max(80),
  base_version: Sha256Hex,
  new_base_version: Sha256Hex,
});
export type CatalogOverlayConflictedV1 = z.infer<typeof CatalogOverlayConflictedV1>;
type EventCatalog = Readonly<
  Record<
    string,
    {
      readonly ifId: string;
      readonly producer: z.infer<typeof ServiceName>;
      readonly freeze: 'D' | 'O';
      readonly slice: 'R0' | 'R1' | 'R2' | 'R3';
      readonly versions: Readonly<Record<number, z.ZodType>>;
    }
  >
>; // 파일 비공개
// IF-01 §9.3 카탈로그 표(v·생산·동결·슬라이스) 전사 — T-00-10 contracts:gen이 이 맵을 import해 registry.gen.ts를 만든다.
export const CATALOG_EVENTS = {
  'catalog.pack.activated': {
    ifId: 'IF-EV-01',
    producer: 'content',
    freeze: 'D',
    slice: 'R0',
    versions: { 1: CatalogPackActivatedV1 },
  },
  'catalog.concept.changed': {
    ifId: 'IF-EV-02',
    producer: 'content',
    freeze: 'D',
    slice: 'R0',
    versions: { 1: CatalogConceptChangedV1 },
  },
  'catalog.overlay.conflicted': {
    ifId: 'IF-EV-03',
    producer: 'content',
    freeze: 'O',
    slice: 'R2',
    versions: { 1: CatalogOverlayConflictedV1 },
  },
} as const satisfies EventCatalog;
