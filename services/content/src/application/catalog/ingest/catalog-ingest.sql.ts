// 서빙 테이블(ct_*) 쓰기 SQL 상수 — `check:content-ingest` 허용 위치(application/catalog/ingest/**). 정적 리터럴 + 이름 바인딩(STD-SQL-06).
// `INSERT OR REPLACE`는 쓰지 않는다: 설치 범위(install_id)가 새것이라 중복 = 번들 결함 → 제약 위반으로 실패한다.

/** 설치 행 생성(state = loading). ext = {"catalog.request_id", "catalog.previous_version"}. */
export const INSERT_PACK = `INSERT INTO ct_pack(install_id, pack_id, version, channel, track_id, schema_v, packc_version, manifest_hash, merkle_root, source_sha256, manifest_json, report_json, offline_cap_level, state, created_at, ext, ext_v)
VALUES (:install_id, :pack_id, :version, :channel, :track_id, :schema_v, :packc_version, :manifest_hash, :merkle_root, :source_sha256, :manifest_json, :report_json, :offline_cap_level, 'loading', :created_at, :ext, 1)`;

export const MARK_PACK_READY = `UPDATE ct_pack SET state = 'ready', ready_at = :now WHERE install_id = :install_id AND state = 'loading'`;

/** loading·ready → failed. 이미 active·retired인 행은 건드리지 않는다. */
export const MARK_PACK_FAILED = `UPDATE ct_pack SET state = 'failed', state_reason = :reason, ext = json_set(ext, '$."catalog.error_id"', :error_id, '$."catalog.finished_at"', :finished_at)
WHERE install_id = :install_id AND state IN ('loading', 'ready')`;

/** failed 설치 정리 — 설치 범위 행은 ON DELETE CASCADE. */
export const DELETE_PACK = `DELETE FROM ct_pack WHERE install_id = :install_id`;

export const INSERT_TRACK = `INSERT INTO ct_track(install_id, track_id, name_ko, name_en, track_group, sort_order, offline_cap_level, oracle_cap_level, summary_ko, content_hash, ext, ext_v)
VALUES (:install_id, :track_id, :name_ko, :name_en, :track_group, :sort_order, :offline_cap_level, :oracle_cap_level, :summary_ko, :content_hash, :ext, 1)`;

export const INSERT_SOURCE = `INSERT INTO ct_source(install_id, source_id, kind, title, url, ref_text, license_grade, fetched_at, content_hash, ext, ext_v)
VALUES (:install_id, :source_id, :kind, :title, :url, :ref_text, :license_grade, :fetched_at, :content_hash, :ext, 1)`;

export const INSERT_RUBRIC = `INSERT INTO ct_rubric(install_id, rubric_id, dims_json, content_hash, ext, ext_v)
VALUES (:install_id, :rubric_id, :dims_json, :content_hash, :ext, 1)`;

export const INSERT_CONCEPT = `INSERT INTO ct_concept(install_id, concept_id, track_id, level, knowledge_type, tier, title_ko, title_en, summary_ko, aliases_json, tags_json, volatility, required_for_level, deprecated_by, theory_md, code_md, core_md, diagrams_json, sources_json, content_hash, ext, ext_v)
VALUES (:install_id, :concept_id, :track_id, :level, :knowledge_type, :tier, :title_ko, :title_en, :summary_ko, :aliases_json, :tags_json, :volatility, :required_for_level, :deprecated_by, :theory_md, :code_md, :core_md, :diagrams_json, :sources_json, :content_hash, :ext, 1)`;

export const INSERT_EDGE = `INSERT INTO ct_concept_edge(install_id, from_concept_id, to_concept_id, kind, weight)
VALUES (:install_id, :from_concept_id, :to_concept_id, :kind, :weight)`;

export const INSERT_ALIAS = `INSERT INTO ct_id_alias(install_id, entity_kind, alias_id, target_id)
VALUES (:install_id, :entity_kind, :alias_id, :target_id)`;

export const INSERT_KU = `INSERT INTO ct_ku(install_id, ku_id, concept_id, statement, facet, scope, vol, valid_as_of, deprecated_by, source_refs_json, trust, origin, status, content_hash, ext, ext_v)
VALUES (:install_id, :ku_id, :concept_id, :statement, :facet, :scope, :vol, :valid_as_of, :deprecated_by, :source_refs_json, :trust, :origin, :status, :content_hash, :ext, 1)`;

export const INSERT_MISCONCEPTION = `INSERT INTO ct_misconception(install_id, mc_id, concept_id, statement, correction, meta_family, related_ku_ids_json, status, content_hash, ext, ext_v)
VALUES (:install_id, :mc_id, :concept_id, :statement, :correction, :meta_family, :related_ku_ids_json, :status, :content_hash, :ext, 1)`;

// ───────── 활성화(부모 1 tx) ─────────

export const RETIRE_PACK = `UPDATE ct_pack SET state = 'retired', retired_at = :now WHERE install_id = :install_id AND state = 'active'`;

export const ACTIVATE_PACK = `UPDATE ct_pack SET state = 'active', activated_at = :now, retired_at = NULL, ext = json_set(ext, '$."catalog.version"', :version)
WHERE install_id = :install_id AND state IN ('ready', 'retired')`;

export const UPSERT_PACK_ACTIVE = `INSERT INTO ct_pack_active(pack_id, install_id, previous_install_id, switched_at)
VALUES (:pack_id, :install_id, :previous_install_id, :switched_at)
ON CONFLICT(pack_id) DO UPDATE SET install_id = excluded.install_id, previous_install_id = excluded.previous_install_id, switched_at = excluded.switched_at`;

export const SET_CONCEPT_VERSION = `UPDATE ct_concept SET ext = json_set(ext, '$."catalog.version"', :version) WHERE install_id = :install_id AND concept_id = :concept_id`;
