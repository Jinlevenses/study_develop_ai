import type { BundleRecord } from '@fathom/contracts/pack/records';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort, Stmt } from '@fathom/shared-kernel/sqlite/sqlite';
import {
  INSERT_ALIAS,
  INSERT_CONCEPT,
  INSERT_EDGE,
  INSERT_KU,
  INSERT_MISCONCEPTION,
  INSERT_RUBRIC,
  INSERT_SOURCE,
  INSERT_TRACK,
} from './catalog-ingest.sql.js';

// PGM-CT-002 catalog 직접 적재 8종의 레코드 → 행 매핑 — Brief T-01-07 §4.5-3, records.ts 번역 규칙 ①②③.
// `<f>` ↔ `<f>_json`(canonicalJson), `edge_kind`·`source_type` ↔ `kind` 열, ext = canonicalJson(record.ext)·ext_v = 1(SQL 리터럴), boolean → 0/1(이 8종에는 없음).

export const CATALOG_KINDS = [
  'track',
  'source',
  'rubric',
  'concept',
  'edge',
  'alias',
  'ku',
  'misconception',
] as const satisfies readonly BundleRecord['kind'][];
export type CatalogKind = (typeof CATALOG_KINDS)[number];

const CATALOG_KIND_SET: ReadonlySet<string> = new Set(CATALOG_KINDS);

export function isCatalogKind(kind: string): kind is CatalogKind {
  return CATALOG_KIND_SET.has(kind);
}

export type CatalogInserts = {
  readonly track: Stmt;
  readonly source: Stmt;
  readonly rubric: Stmt;
  readonly concept: Stmt;
  readonly edge: Stmt;
  readonly alias: Stmt;
  readonly ku: Stmt;
  readonly misconception: Stmt;
};

/** 연결 하나에서 한 번만 준비한다(배치마다 재사용). */
export function prepareCatalogInserts(db: SqlitePort): CatalogInserts {
  return {
    track: db.prepare(INSERT_TRACK),
    source: db.prepare(INSERT_SOURCE),
    rubric: db.prepare(INSERT_RUBRIC),
    concept: db.prepare(INSERT_CONCEPT),
    edge: db.prepare(INSERT_EDGE),
    alias: db.prepare(INSERT_ALIAS),
    ku: db.prepare(INSERT_KU),
    misconception: db.prepare(INSERT_MISCONCEPTION),
  };
}

/** catalog 8종이면 INSERT 1회 후 true, 아니면 false(호출자가 핸들러로 보낸다). 중복 = 제약 위반 예외. */
export function insertCatalogRecord(inserts: CatalogInserts, installId: string, r: BundleRecord): boolean {
  switch (r.kind) {
    case 'track':
      inserts.track.run({
        install_id: installId,
        track_id: r.track_id,
        name_ko: r.name_ko,
        name_en: r.name_en,
        track_group: r.track_group,
        sort_order: r.sort_order,
        offline_cap_level: r.offline_cap_level,
        oracle_cap_level: r.oracle_cap_level,
        summary_ko: r.summary_ko,
        content_hash: r.content_hash,
        ext: canonicalJson(r.ext),
      });
      return true;
    case 'source':
      inserts.source.run({
        install_id: installId,
        source_id: r.source_id,
        kind: r.source_type,
        title: r.title,
        url: r.url,
        ref_text: r.ref_text,
        license_grade: r.license_grade,
        fetched_at: r.fetched_at,
        content_hash: r.content_hash,
        ext: canonicalJson(r.ext),
      });
      return true;
    case 'rubric':
      inserts.rubric.run({
        install_id: installId,
        rubric_id: r.rubric_id,
        dims_json: canonicalJson(r.dims),
        content_hash: r.content_hash,
        ext: canonicalJson(r.ext),
      });
      return true;
    case 'concept':
      inserts.concept.run({
        install_id: installId,
        concept_id: r.concept_id,
        track_id: r.track_id,
        level: r.level,
        knowledge_type: r.knowledge_type,
        tier: r.tier,
        title_ko: r.title_ko,
        title_en: r.title_en,
        summary_ko: r.summary_ko,
        aliases_json: canonicalJson(r.aliases),
        tags_json: canonicalJson(r.tags),
        volatility: r.volatility,
        required_for_level: r.required_for_level,
        deprecated_by: r.deprecated_by,
        theory_md: r.theory_md,
        code_md: r.code_md,
        core_md: r.core_md,
        diagrams_json: canonicalJson(r.diagrams),
        sources_json: canonicalJson(r.sources),
        content_hash: r.content_hash,
        ext: canonicalJson(r.ext),
      });
      return true;
    case 'edge':
      inserts.edge.run({
        install_id: installId,
        from_concept_id: r.from_concept_id,
        to_concept_id: r.to_concept_id,
        kind: r.edge_kind,
        weight: r.weight,
      });
      return true;
    case 'alias':
      inserts.alias.run({
        install_id: installId,
        entity_kind: r.entity_kind,
        alias_id: r.alias_id,
        target_id: r.target_id,
      });
      return true;
    case 'ku':
      inserts.ku.run({
        install_id: installId,
        ku_id: r.ku_id,
        concept_id: r.concept_id,
        statement: r.statement,
        facet: r.facet,
        scope: r.scope,
        vol: r.vol,
        valid_as_of: r.valid_as_of,
        deprecated_by: r.deprecated_by,
        source_refs_json: canonicalJson(r.source_refs),
        trust: r.trust,
        origin: r.origin,
        status: r.status,
        content_hash: r.content_hash,
        ext: canonicalJson(r.ext),
      });
      return true;
    case 'misconception':
      inserts.misconception.run({
        install_id: installId,
        mc_id: r.mc_id,
        concept_id: r.concept_id,
        statement: r.statement,
        correction: r.correction,
        meta_family: r.meta_family,
        related_ku_ids_json: canonicalJson(r.related_ku_ids),
        status: r.status,
        content_hash: r.content_hash,
        ext: canonicalJson(r.ext),
      });
      return true;
    default:
      return false;
  }
}
