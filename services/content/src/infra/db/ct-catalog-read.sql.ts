// catalog 읽기 SQL 상수 — 서빙 테이블 쓰기는 `application/catalog/ingest/catalog-ingest.sql.ts`에만 둔다(check:content-ingest).
// 조회 표준 경로 = 활성 뷰 `ct_*_active`. 설치 범위 직접 조회는 설치·활성화 단계(활성 전 설치)에서만 쓴다.

export const SELECT_PACK_ROWS_OF_PACK = `SELECT install_id, version, manifest_hash, state FROM ct_pack WHERE pack_id = :pack_id ORDER BY created_at, install_id`;

export const SELECT_PACK_ROW = `SELECT install_id, pack_id, version, channel, track_id, manifest_hash, merkle_root, offline_cap_level, state FROM ct_pack WHERE install_id = :install_id`;

export const SELECT_FAILED_INSTALLS_OF_PACK = `SELECT install_id FROM ct_pack WHERE pack_id = :pack_id AND state = 'failed' AND install_id <> :install_id ORDER BY install_id`;

export const SELECT_ACTIVE_POINTER = `SELECT install_id FROM ct_pack_active WHERE pack_id = :pack_id`;

export const SELECT_MAX_CATALOG_VERSION = `SELECT max(json_extract(ext, '$."catalog.version"')) AS v FROM ct_pack`;

export const SELECT_CONCEPT_DIGESTS = `SELECT concept_id, content_hash, tier, deprecated_by, json_extract(ext, '$."catalog.version"') AS version
FROM ct_concept WHERE install_id = :install_id ORDER BY concept_id`;

export const SELECT_KU_HASHES = `SELECT ku_id, content_hash FROM ct_ku WHERE install_id = :install_id ORDER BY ku_id`;

export const SELECT_ACTIVE_CONCEPT_IDS_OF_PACK = `SELECT c.concept_id AS concept_id FROM ct_concept c JOIN ct_pack_active a ON a.install_id = c.install_id WHERE a.pack_id = :pack_id ORDER BY c.concept_id`;

export const SELECT_REQUEST_ROWS = `SELECT pack_id, track_id, version, state, state_reason, created_at, activated_at,
  json_extract(ext, '$."catalog.previous_version"') AS previous_version,
  json_extract(ext, '$."catalog.error_id"') AS error_id,
  json_extract(ext, '$."catalog.finished_at"') AS finished_at
FROM ct_pack WHERE json_extract(ext, '$."catalog.request_id"') = :request_id ORDER BY pack_id`;

export const SELECT_UNFINISHED_INSTALLS = `SELECT install_id FROM ct_pack WHERE state IN ('loading', 'ready') ORDER BY install_id`;

export const SELECT_APPLIED_DELTA_COUNT = `SELECT count(*) AS n FROM ct_pack_delta WHERE pack_id = :pack_id AND status = 'applied'`;

export const SELECT_OVERLAY_EVENT_COUNT = `SELECT count(*) AS n FROM ct_overlay_event`;

// ConceptRef 원천 — 설치 직접(활성화 시점)·활성 뷰(export) 두 벌.
export const SELECT_CONCEPT_REF_ROWS = `SELECT concept_id, track_id, level, tier, knowledge_type, title_ko, title_en, summary_ko, aliases_json, tags_json, required_for_level, deprecated_by, volatility, content_hash,
  json_extract(ext, '$."catalog.version"') AS version
FROM ct_concept WHERE install_id = :install_id ORDER BY concept_id`;

export const SELECT_PREREQ_EDGES = `SELECT from_concept_id, to_concept_id FROM ct_concept_edge WHERE install_id = :install_id AND kind = 'prereq'`;

export const SELECT_ACTIVE_CONCEPT_REF_ROWS = `SELECT concept_id, track_id, level, tier, knowledge_type, title_ko, title_en, summary_ko, aliases_json, tags_json, required_for_level, deprecated_by, volatility, content_hash,
  json_extract(ext, '$."catalog.version"') AS version
FROM ct_concept_active ORDER BY concept_id`;

export const SELECT_ACTIVE_PREREQ_EDGES = `SELECT from_concept_id, to_concept_id FROM ct_concept_edge_active WHERE kind = 'prereq'`;

// 조회(IF-CT-003~005)
export const SELECT_ACTIVE_PACKS = `SELECT p.pack_id AS pack_id, p.track_id AS track_id, p.version AS version, p.channel AS channel, p.manifest_hash AS manifest_hash, p.merkle_root AS merkle_root,
  p.activated_at AS activated_at, p.manifest_json AS manifest_json, p.report_json AS report_json,
  json_extract(p.ext, '$."catalog.version"') AS catalog_version
FROM ct_pack p JOIN ct_pack_active a ON a.install_id = p.install_id
WHERE p.state = 'active' AND p.track_id IS NOT NULL ORDER BY p.pack_id`;

export const SELECT_ACTIVE_TRACKS = `SELECT t.install_id AS install_id, t.track_id AS track_id, t.name_ko AS name_ko, t.name_en AS name_en, t.sort_order AS sort_order,
  t.offline_cap_level AS offline_cap_level, t.oracle_cap_level AS oracle_cap_level,
  p.pack_id AS pack_id, p.version AS version, p.channel AS channel, p.report_json AS report_json
FROM ct_track_active t JOIN ct_pack p ON p.install_id = t.install_id
ORDER BY t.sort_order, t.track_id`;

export const SELECT_ACTIVE_LEVEL_COUNTS = `SELECT install_id, track_id, level, count(*) AS n FROM ct_concept_active GROUP BY install_id, track_id, level`;

export const SELECT_ACTIVE_TRACK_PRESENT = `SELECT 1 AS present FROM ct_track_active WHERE track_id = :track_id LIMIT 1`;

export const SELECT_TRACK_CONCEPTS_PAGE = `SELECT concept_id, track_id, level, tier, knowledge_type, title_ko, title_en, summary_ko, aliases_json, tags_json, required_for_level, deprecated_by, volatility
FROM ct_concept_active
WHERE track_id = :track_id AND (:level IS NULL OR level = :level) AND (level > :cursor_level OR (level = :cursor_level AND concept_id > :cursor_id))
ORDER BY level, concept_id LIMIT :limit`;

export const SELECT_ACTIVE_INSTALLS = `SELECT p.pack_id AS pack_id, p.install_id AS install_id, p.version AS version, p.track_id AS track_id
FROM ct_pack p JOIN ct_pack_active a ON a.install_id = p.install_id ORDER BY p.pack_id`;

export const SELECT_ACTIVE_CONCEPT_INSTALL = `SELECT install_id FROM ct_concept_active WHERE concept_id = :concept_id`;

export const SELECT_ACTIVE_KU_IDS = `SELECT ku_id FROM ct_ku_active WHERE install_id = :install_id AND concept_id = :concept_id ORDER BY ku_id`;

export const SELECT_ACTIVE_MC_IDS = `SELECT mc_id FROM ct_misconception_active WHERE install_id = :install_id AND concept_id = :concept_id ORDER BY mc_id`;
