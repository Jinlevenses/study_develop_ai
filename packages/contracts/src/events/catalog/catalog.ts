import { z } from 'zod';
import { KnowledgeType, Level, Tag, Tier, Volatility } from '../../common/domain.js';
import { ConceptId, KuId, PackId, SemVer, Sha256Hex, TrackId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { EpochMs } from '../../common/time.js';
import { PackChannel } from '../../http/content/v1/catalog.js';
import { OverlayTargetKind } from '../../http/content/v1/overlays.js';

export const ConceptRef = S({                                   // learning lr_curriculum_ref 한 행 = catalog Published Language (§15 D-13: title·tags 추가)
  concept_id: ConceptId, track: TrackId, level: Level, tier: Tier, knowledge_type: KnowledgeType,
  title_ko: z.string().max(120), title_en: z.string().max(120), summary_ko: z.string().max(300),
  prereq_ids: z.array(ConceptId).max(30), required_for_level: Level.nullable(), aliases: z.array(z.string().max(80)).max(20),
  deprecated_by: ConceptId.nullable(), volatility: Volatility, tags: z.array(Tag).max(20),
  version: z.number().int().min(0),                             // catalog 단조 버전(이 개념이 마지막으로 바뀐 버전)
  content_hash: Sha256Hex,
});
export type ConceptRef = z.infer<typeof ConceptRef>;
export const CatalogPackActivatedV1 = S({                       // IF-EV-01
  pack_id: PackId, track: TrackId, version: SemVer, channel: PackChannel, manifest_hash: Sha256Hex, merkle_root: Sha256Hex,
  previous_version: SemVer.nullable(), changed_concept_ids: z.array(ConceptId).max(2000), changed_ku_ids: z.array(KuId).max(20_000),
  offline_cap_level: Level, catalog_version: z.number().int().min(0), activated_at: EpochMs,
});
export type CatalogPackActivatedV1 = z.infer<typeof CatalogPackActivatedV1>;
export const CatalogConceptChangedV1 = S({                      // IF-EV-02 (event-carried state transfer)
  change: z.enum(['published', 'revised', 'deprecated', 'tier_promoted']), concept: ConceptRef, pack_id: PackId, version: SemVer,
});
export type CatalogConceptChangedV1 = z.infer<typeof CatalogConceptChangedV1>;
export const CatalogOverlayConflictedV1 = S({                   // IF-EV-03
  conflict_id: Ulid, patch_id: Ulid, target_kind: OverlayTargetKind, target_id: z.string().max(160), field: z.string().max(80),
  base_version: Sha256Hex, new_base_version: Sha256Hex,
});
export type CatalogOverlayConflictedV1 = z.infer<typeof CatalogOverlayConflictedV1>;
