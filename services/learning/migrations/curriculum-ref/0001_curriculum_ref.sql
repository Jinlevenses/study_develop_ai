-- @fathom:module=curriculum-ref version=1 kind=additive
-- services/learning/migrations/curriculum-ref/0001_curriculum_ref.sql
-- catalog Published Language(ConceptRef)의 계약된 사본. catalog.* 이벤트로 갱신, manifest_hash 불일치 시 export로 재구성.

-- @table ConceptRef 사본(세션 조립·승급 판정이 content 없이 동작). ARC §7.1 필드 그대로
CREATE TABLE lr_curriculum_ref(
  concept_id         TEXT    NOT NULL PRIMARY KEY,                             -- 개념(정본 ID)
  pack_id            TEXT    NOT NULL,                                         -- 출처 팩(이벤트 pack_id 또는 concept_id에서 도출: 'u.<ns>.*' → 'u.<ns>', 그 밖 → 첫 마디 = 트랙 팩)
  track              TEXT    NOT NULL,                                         -- 트랙
  level              INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),           -- 레벨
  tier               TEXT    NOT NULL CHECK (tier IN ('A','B','C')),           -- 티어
  knowledge_type     TEXT    NOT NULL CHECK (knowledge_type IN ('D','C','P','S')), -- 지식유형
  title_ko           TEXT    NOT NULL,                                         -- 개념명(ConceptRef.title_ko, IF D-13)
  title_en           TEXT    NOT NULL,                                         -- 영문명(ConceptRef.title_en)
  tags               TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),   -- 태그(ConceptRef.tags — D-day cert: 범위)
  prereq_ids         TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(prereq_ids)), -- 선수 개념 ID 목록
  required_for_level INTEGER CHECK (required_for_level BETWEEN 1 AND 5),       -- 승급 필수 레벨
  aliases            TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(aliases)), -- 동의어(표시·팔레트)
  deprecated_by      TEXT,                                                     -- 후속 개념
  summary_ko         TEXT    NOT NULL,                                         -- 한 줄 요약
  volatility         TEXT    NOT NULL CHECK (volatility IN ('stable','evolving','volatile')), -- 신선도
  pack_version       TEXT    NOT NULL,                                         -- 팩 SemVer(이벤트 version · export header packs[])
  catalog_version    INTEGER NOT NULL CHECK (catalog_version >= 0),            -- ConceptRef.version(catalog 단조 버전, CR-41)
  content_hash       TEXT    NOT NULL CHECK (length(content_hash) = 64),       -- catalog 레코드 해시(오버레이 반영 후)
  ext                TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),    -- 확장
  ext_v              INTEGER NOT NULL DEFAULT 1                                -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_lr_curriculum_ref_track ON lr_curriculum_ref(track, level);

-- @table 사본 동기화 헤더(1행). 마지막으로 반영한 CurriculumExportHeader.version·pack_set_hash — 증분 export since 기준(CR-41)
CREATE TABLE lr_curriculum_sync(
  id              INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),                 -- 단일 행
  catalog_version INTEGER NOT NULL CHECK (catalog_version >= 0),               -- 반영한 catalog 버전(IF-CT-007 ?since=)
  pack_set_hash   TEXT    NOT NULL CHECK (length(pack_set_hash) = 64),         -- 반영한 활성 팩 집합 해시
  synced_at       INTEGER NOT NULL                                             -- 동기화 시각
) STRICT;

-- @table 트랙별 평가 인벤토리 사본(IF-CT-007 'inventory' 줄 = AssessmentInventory). content 정지 중 structuralFeasibility 입력(D-21, FR-PRG-013·032, CR-41)
CREATE TABLE lr_curriculum_inventory(
  track           TEXT    NOT NULL PRIMARY KEY,                                -- 트랙
  inventory_json  TEXT    NOT NULL CHECK (json_valid(inventory_json)),         -- AssessmentInventory 정준 JSON
  catalog_version INTEGER NOT NULL CHECK (catalog_version >= 0),               -- 반영 catalog 버전
  synced_at       INTEGER NOT NULL                                             -- 동기화 시각
) STRICT;

-- @table Case 사본(IF-CT-007 'case' 줄). 승급 T3 Case 게이트·세션 조립이 content 없이 동작(CR-41)
CREATE TABLE lr_curriculum_case(
  case_id    TEXT    NOT NULL PRIMARY KEY,                                     -- Case ID
  tracks_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(tracks_json)),    -- 관련 트랙
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),                   -- 레벨
  floor      INTEGER NOT NULL DEFAULT 0 CHECK (floor IN (0,1))                 -- 하한 Case 여부
) STRICT;

-- @table 학습 경로 사본(IF-CT-007 'path' 줄). SessionScope{kind:'path'}를 content 정지 중에도 해석(D-9, CR-52)
CREATE TABLE lr_curriculum_path(
  path_id          TEXT    NOT NULL PRIMARY KEY,                               -- 'path.<slug>'
  title_ko         TEXT    NOT NULL,                                           -- 경로 이름
  tracks_json      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tracks_json)), -- 관련 트랙
  concept_ids_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(concept_ids_json)), -- 순서 있는 개념 목록
  catalog_version  INTEGER NOT NULL CHECK (catalog_version >= 0)               -- 반영 catalog 버전
) STRICT;

-- @table 팩별 사본 메타(해시 대조 → 불일치 시 curriculum/export로 전체 재구성)
CREATE TABLE lr_curriculum_meta(
  pack_id       TEXT    NOT NULL PRIMARY KEY,                                  -- 팩
  version       TEXT    NOT NULL,                                              -- 반영 버전
  manifest_hash TEXT    NOT NULL CHECK (length(manifest_hash) = 64),           -- 반영 매니페스트 해시
  synced_at     INTEGER NOT NULL                                               -- 동기화 시각
) STRICT;

-- @table 개념 ID 별칭(단조 증가·append-only). 투영이 card_id·concept_id를 정본 ID로 해석하는 유일한 입력(설계 결정 D-12)
CREATE TABLE lr_concept_id_alias(
  alias_id  TEXT    NOT NULL PRIMARY KEY,                                      -- 옛 concept_id
  target_id TEXT    NOT NULL,                                                  -- 새 concept_id
  pack_id   TEXT    NOT NULL,                                                  -- 발행 팩
  added_at  INTEGER NOT NULL                                                   -- 수신 시각
) STRICT;
CREATE TRIGGER lr_concept_id_alias_no_update BEFORE UPDATE ON lr_concept_id_alias BEGIN SELECT RAISE(ABORT, 'alias map is append-only'); END;
CREATE TRIGGER lr_concept_id_alias_no_delete BEFORE DELETE ON lr_concept_id_alias BEGIN SELECT RAISE(ABORT, 'alias map is append-only'); END;
