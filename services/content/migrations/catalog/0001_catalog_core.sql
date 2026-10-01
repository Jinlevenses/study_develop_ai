-- @fathom:module=catalog version=1 kind=additive
-- services/content/migrations/catalog/0001_catalog_core.sql
-- 팩 계층(설치 범위, blue/green) + 활성 포인터 + PackDelta 기록 + 오버레이. 교차 모듈 FK 0.

-- @table 설치된 팩 버전(설치 1건 = 행 1개). blue/green의 단위. state 전이: loading → ready → active → retired | loading → failed. DR-006, DR-020(pack.channel)
CREATE TABLE ct_pack(
  install_id        TEXT    NOT NULL PRIMARY KEY CHECK (length(install_id) = 26), -- 설치 ULID
  pack_id           TEXT    NOT NULL CHECK (length(pack_id) BETWEEN 1 AND 64),     -- 'k8s' · 'x.blueprints' · 'u.local'
  version           TEXT    NOT NULL CHECK (length(version) BETWEEN 5 AND 64),     -- semver(예: '1.2.0', '1.2.0-local.3')
  channel           TEXT    NOT NULL CHECK (channel IN ('seed','local','user')),   -- DR-020 이름 훅. seed=동봉, local=pack refresh, user=사용자 팩·가져오기
  track_id          TEXT,                                                          -- 팩의 트랙(블루프린트 팩·사용자 팩은 NULL)
  schema_v          INTEGER NOT NULL CHECK (schema_v >= 1),                        -- .fpack 스키마 버전(@fathom/contracts/pack/manifest)
  packc_version     TEXT    NOT NULL,                                              -- 컴파일한 packc 버전
  manifest_hash     TEXT    NOT NULL CHECK (length(manifest_hash) = 64),           -- sha256(manifest.json)
  merkle_root       TEXT    NOT NULL CHECK (length(merkle_root) = 64),             -- files[].sha256의 merkle root
  source_sha256     TEXT    CHECK (source_sha256 IS NULL OR length(source_sha256) = 64), -- .fpack 파일 sha256(런타임 생성 사용자 팩은 NULL)
  manifest_json     TEXT    NOT NULL CHECK (json_valid(manifest_json)),            -- manifest.json 원문(정준 JSON)
  report_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(report_json)),  -- report.json(V1~V10, KPI, cap blocker)
  offline_cap_level INTEGER CHECK (offline_cap_level BETWEEN 0 AND 5),             -- 팩 매니페스트의 OFFLINE 상한(트랙 팩만)
  state             TEXT    NOT NULL CHECK (state IN ('loading','ready','active','retired','failed')), -- 설치 상태
  state_reason      TEXT,                                                          -- failed·retired 사유 코드
  created_at        INTEGER NOT NULL,                                              -- 설치 시작(epoch ms)
  ready_at          INTEGER,                                                       -- pack-load job 완료
  activated_at      INTEGER,                                                       -- 활성 포인터 전환
  retired_at        INTEGER,                                                       -- 다음 버전 활성으로 은퇴
  ext               TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장(DR-020 ext: pack.signature, pack.direction)
  ext_v             INTEGER NOT NULL DEFAULT 1                                     -- ext 스키마 버전
) STRICT;
CREATE UNIQUE INDEX ux_ct_pack_version ON ct_pack(pack_id, version) WHERE state <> 'failed';
CREATE INDEX ix_ct_pack_state ON ct_pack(pack_id, state);

-- @table 팩별 활성 포인터. blue/green 전환 = 이 행 UPDATE 1회(1 tx). 조회는 항상 이 포인터를 통해 설치 범위 행을 읽는다
CREATE TABLE ct_pack_active(
  pack_id             TEXT    NOT NULL PRIMARY KEY,                                -- ct_pack.pack_id
  install_id          TEXT    NOT NULL UNIQUE REFERENCES ct_pack(install_id),      -- 현재 활성 설치
  previous_install_id TEXT    REFERENCES ct_pack(install_id),                      -- 직전 활성 설치(롤백·변경 요약용)
  switched_at         INTEGER NOT NULL                                             -- 전환 시각(epoch ms)
) STRICT;

-- @table 트랙(팩 1개 = 트랙 1개). DR-020(track.offline_cap_level)
CREATE TABLE ct_track(
  install_id        TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  track_id          TEXT    NOT NULL,                                              -- 'k8s' · 'db' · 'data' …
  name_ko           TEXT    NOT NULL,                                              -- 표시 이름(한국어)
  name_en           TEXT    NOT NULL,                                              -- 표시 이름(영문)
  track_group       TEXT    NOT NULL,                                              -- 트랙군(6종, 하한 판정용)
  sort_order        INTEGER NOT NULL DEFAULT 0,                                    -- 지도 표시 순서
  offline_cap_level INTEGER NOT NULL CHECK (offline_cap_level BETWEEN 0 AND 5),    -- DR-020 이름 훅. 깊이 자산 인벤토리로 packc가 계산
  oracle_cap_level  INTEGER NOT NULL CHECK (oracle_cap_level BETWEEN 0 AND 5),     -- structuralFeasibility() 오라클 cap(제품 지도 표시값, SP-6 감사)
  summary_ko        TEXT    NOT NULL DEFAULT '',                                   -- 트랙 소개
  content_hash      TEXT    NOT NULL CHECK (length(content_hash) = 64),            -- 정준 레코드 sha256
  ext               TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장
  ext_v             INTEGER NOT NULL DEFAULT 1,                                    -- ext 스키마 버전
  PRIMARY KEY (install_id, track_id)
) STRICT;

-- @table 개념(지도 노드). 3단 본문(이론·코드·핵심) 포함. DR-001, DR-020(concept.volatility·required_for_level), NG-G6(영상 본문 열 없음)
CREATE TABLE ct_concept(
  install_id         TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  concept_id         TEXT    NOT NULL CHECK (length(concept_id) BETWEEN 3 AND 128), -- '<track>.<slug>' · 'u.<ns>.<slug>'(불변)
  track_id           TEXT    NOT NULL,                                             -- 소속 트랙
  level              INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),               -- L1~L5
  knowledge_type     TEXT    NOT NULL CHECK (knowledge_type IN ('D','C','P','S')), -- 선언·개념·절차·전략
  tier               TEXT    NOT NULL CHECK (tier IN ('A','B','C')),               -- 콘텐츠 티어
  title_ko           TEXT    NOT NULL,                                             -- 개념명(한국어)
  title_en           TEXT    NOT NULL DEFAULT '',                                  -- 개념명(영문)
  summary_ko         TEXT    NOT NULL,                                             -- 한 줄 요약
  aliases_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)), -- 동의어·영문 정식명·약어(R-ALIAS: 한글 개념은 영문 ≥ 1)
  tags_json          TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),  -- 'ctx:si' · 'cert:<id>' …
  volatility         TEXT    NOT NULL CHECK (volatility IN ('stable','evolving','volatile')), -- DR-020 이름 훅
  required_for_level INTEGER CHECK (required_for_level BETWEEN 1 AND 5),           -- DR-020 이름 훅. Lk 승급 필수(Tier A/B만)
  deprecated_by      TEXT,                                                         -- 후속 concept_id(폐기 시)
  theory_md          TEXT    NOT NULL,                                             -- 3단 ① 이론(Markdown)
  code_md            TEXT    NOT NULL,                                             -- 3단 ② 코드/사례(Tier C는 자리표시자)
  core_md            TEXT    NOT NULL,                                             -- 3단 ③ 핵심
  diagrams_json      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(diagrams_json)), -- Mermaid 원문 + 텍스트 대체(alt·요약) 목록
  sources_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(sources_json)), -- 본문 출처 span 참조(source_id, span)
  content_hash       TEXT    NOT NULL CHECK (length(content_hash) = 64),           -- 정준 레코드 sha256(변경 감지·base_version)
  ext                TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),        -- 확장(DR-020 ext: concept.epa_refs, stimulus.ladder)
  ext_v              INTEGER NOT NULL DEFAULT 1,                                   -- ext 스키마 버전
  PRIMARY KEY (install_id, concept_id),
  CHECK (required_for_level IS NULL OR tier IN ('A','B'))
) STRICT;
CREATE INDEX ix_ct_concept_id    ON ct_concept(concept_id);
CREATE INDEX ix_ct_concept_track ON ct_concept(install_id, track_id, level);

-- @table 개념 간선(선수·형제·확장). DR-002. R-DAG는 packc가 검사
CREATE TABLE ct_concept_edge(
  install_id      TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  from_concept_id TEXT    NOT NULL,                                                -- 출발 개념(prereq: 선수 개념)
  to_concept_id   TEXT    NOT NULL,                                                -- 도착 개념(prereq: 후속 개념)
  kind            TEXT    NOT NULL CHECK (kind IN ('prereq','sibling','extends')), -- 간선 종류
  weight          REAL    NOT NULL DEFAULT 1.0,                                    -- 가중치
  PRIMARY KEY (install_id, from_concept_id, to_concept_id, kind)
) STRICT;
CREATE INDEX ix_ct_concept_edge_to ON ct_concept_edge(install_id, to_concept_id, kind);

-- @table 안정 ID 별칭(ID 개명·폐기 후 과거 참조 해석, FR-CUR-004). 검색 동의어는 ct_concept.aliases_json
CREATE TABLE ct_id_alias(
  install_id  TEXT NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE,      -- 설치 범위
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('concept','ku','misconception','item')), -- 대상 종류
  alias_id    TEXT NOT NULL,                                                       -- 옛 ID
  target_id   TEXT NOT NULL,                                                       -- 새 ID
  PRIMARY KEY (install_id, entity_kind, alias_id)
) STRICT;

-- @table KU(원자 지식 단위). 개정 = 새 설치 행(구 행은 은퇴 설치에 보존) 또는 ct_record_history. DR-003, DR-020(ku.valid_as_of·deprecated_by·scope)
CREATE TABLE ct_ku(
  install_id       TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  ku_id            TEXT    NOT NULL CHECK (length(ku_id) BETWEEN 3 AND 160),      -- '<concept_id>.k<nn>' · 사용자 ULID 기반(불변)
  concept_id       TEXT    NOT NULL,                                               -- 소속 개념
  statement        TEXT    NOT NULL,                                               -- 한 문장 진술
  facet            TEXT    NOT NULL,                                               -- 'definition'|'mechanism'|'code'|'tradeoff'|'contrast' …(contracts FacetId)
  scope            TEXT    NOT NULL DEFAULT '',                                    -- DR-020 이름 훅. 적용 범위(버전·환경 등)
  vol              TEXT    NOT NULL CHECK (vol IN ('stable','evolving','volatile')), -- 신선도 등급(vol:*)
  valid_as_of      TEXT    CHECK (valid_as_of IS NULL OR (length(valid_as_of) = 10 AND valid_as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')), -- DR-020 이름 훅. 'YYYY-MM-DD'
  deprecated_by    TEXT,                                                           -- DR-020 이름 훅. 후속 ku_id
  source_refs_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(source_refs_json)), -- 근거 출처 span 목록(V6)
  trust            TEXT    NOT NULL CHECK (trust IN ('authored','verified','user','llm_unverified')), -- 신뢰 등급(llm_unverified는 승인 전 출제 0)
  origin           TEXT    NOT NULL,                                               -- 'authored' | 'import:<job_id>' | 'tier_promotion:<delta_id>'
  status           TEXT    NOT NULL CHECK (status IN ('published','needs_review','deprecated')), -- outdated 신고 시 needs_review
  content_hash     TEXT    NOT NULL CHECK (length(content_hash) = 64),             -- 정준 레코드 sha256
  ext              TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),          -- 확장
  ext_v            INTEGER NOT NULL DEFAULT 1,                                     -- ext 스키마 버전
  PRIMARY KEY (install_id, ku_id)
) STRICT;
CREATE INDEX ix_ct_ku_concept ON ct_ku(install_id, concept_id);
CREATE INDEX ix_ct_ku_id      ON ct_ku(ku_id);

-- @table 오개념. 오답지·거짓 OX의 원천. DR-004, DR-020(misconception.meta_family·status)
CREATE TABLE ct_misconception(
  install_id          TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  mc_id               TEXT    NOT NULL CHECK (length(mc_id) BETWEEN 3 AND 160),    -- '<concept_id>.m<nn>'(불변)
  concept_id          TEXT    NOT NULL,                                            -- 소속 개념
  statement           TEXT    NOT NULL,                                            -- 잘못된 믿음(거짓 진술)
  correction          TEXT    NOT NULL,                                            -- 교정 문장
  meta_family         TEXT    NOT NULL,                                            -- DR-020 이름 훅. 약 12개 계열
  related_ku_ids_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(related_ku_ids_json)), -- 관련 KU
  status              TEXT    NOT NULL CHECK (status IN ('active','deprecated')),  -- DR-020 이름 훅(콘텐츠 상태. 학습자 소거 상태는 learning lr_mc_state)
  content_hash        TEXT    NOT NULL CHECK (length(content_hash) = 64),          -- 정준 레코드 sha256
  ext                 TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),       -- 확장
  ext_v               INTEGER NOT NULL DEFAULT 1,                                  -- ext 스키마 버전
  PRIMARY KEY (install_id, mc_id)
) STRICT;
CREATE INDEX ix_ct_misconception_concept ON ct_misconception(install_id, concept_id);

-- @table 출처 레지스트리. DR-005(fetch 훅은 ext)
CREATE TABLE ct_source(
  install_id    TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  source_id     TEXT    NOT NULL,                                                  -- 'src.<slug>' · 사용자 ULID
  kind          TEXT    NOT NULL CHECK (kind IN ('web','doc','book','rfc','paper','repo','user')), -- 출처 종류
  title         TEXT    NOT NULL,                                                  -- 제목
  url           TEXT,                                                              -- URL(https)
  ref_text      TEXT,                                                              -- 서지 정보(책·RFC 번호 등)
  license_grade TEXT    NOT NULL CHECK (license_grade IN ('A','B','C','D','P')),   -- 라이선스 등급(D = 발행 차단)
  fetched_at    INTEGER,                                                           -- 원문 수집 시각
  content_hash  TEXT    CHECK (content_hash IS NULL OR length(content_hash) = 64), -- 캐시 원문 sha256
  ext           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),             -- 확장(DR-020 ext: fetch)
  ext_v         INTEGER NOT NULL DEFAULT 1,                                        -- ext 스키마 버전
  PRIMARY KEY (install_id, source_id)
) STRICT;

-- @table 루브릭(차원별 4단계). Case·산출물·Feynman 채점 기준(객체 키)
CREATE TABLE ct_rubric(
  install_id   TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE,  -- 설치 범위
  rubric_id    TEXT    NOT NULL,                                                   -- 'rb.<slug>'
  dims_json    TEXT    NOT NULL CHECK (json_valid(dims_json)),                     -- {dims: {d_diag: {name, levels: {l1..l4}}}} — 객체 키만(배열 금지)
  content_hash TEXT    NOT NULL CHECK (length(content_hash) = 64),                 -- 정준 레코드 sha256
  ext          TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),              -- 확장
  ext_v        INTEGER NOT NULL DEFAULT 1,                                         -- ext 스키마 버전
  PRIMARY KEY (install_id, rubric_id)
) STRICT;

-- @table Case(파라미터화 판단 과제 상태기계). FR-CUR-016, DR-020(case.variant_params·root_cause_pool·best_if·contested)
CREATE TABLE ct_case(
  install_id      TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  case_id         TEXT    NOT NULL,                                                -- '<track>.case.<slug>'
  track_id        TEXT    NOT NULL,                                                -- 주 트랙
  level           INTEGER NOT NULL CHECK (level BETWEEN 3 AND 5),                  -- L3~L5
  kind            TEXT    NOT NULL CHECK (kind IN ('incident','design','review','migration','tradeoff')), -- Case 유형
  title_ko        TEXT    NOT NULL,                                                -- 제목
  spec_json       TEXT    NOT NULL CHECK (json_valid(spec_json)),                  -- 상태기계: 증거 노드·공개 조건·요청 비용·결정점(options 객체 키)
  variant_params  TEXT    NOT NULL CHECK (json_valid(variant_params)),             -- DR-020 이름 훅. 파라미터 공간
  root_cause_pool TEXT    NOT NULL CHECK (json_valid(root_cause_pool)),            -- DR-020 이름 훅. 근본 원인 풀(≥ 2)
  best_if         TEXT    NOT NULL CHECK (json_valid(best_if)),                    -- DR-020 이름 훅. 결정점별 조건 → 선택지
  contested       INTEGER NOT NULL DEFAULT 0 CHECK (contested IN (0,1)),           -- DR-020 이름 훅. 전문가 이견(복수 best)
  rubric_id       TEXT    NOT NULL,                                                -- ct_rubric.rubric_id
  debrief_md      TEXT    NOT NULL,                                                -- 전문가 디브리프
  inspired_by     TEXT,                                                            -- 공개 포스트모템 등 출처 요약
  primary_sources_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(primary_sources_json)), -- L4+ 1차 출처 span
  content_hash    TEXT    NOT NULL CHECK (length(content_hash) = 64),              -- 정준 레코드 sha256
  ext             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),           -- 확장(DR-020 ext: case.world_id·episode_seq·expert_path)
  ext_v           INTEGER NOT NULL DEFAULT 1,                                      -- ext 스키마 버전
  PRIMARY KEY (install_id, case_id)
) STRICT;
CREATE INDEX ix_ct_case_track ON ct_case(install_id, track_id, level);

-- @table 산출물 과제(ADR·런북·포스트모템·설계 리뷰·표준 조항) + 반론 은행. FR-STD-026
CREATE TABLE ct_artifact_task(
  install_id          TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  artifact_id         TEXT    NOT NULL,                                            -- '<track>.art.<slug>'
  track_id            TEXT    NOT NULL,                                            -- 주 트랙
  level               INTEGER NOT NULL CHECK (level BETWEEN 2 AND 5),              -- 대상 레벨
  kind                TEXT    NOT NULL CHECK (kind IN ('adr','runbook','postmortem','design_review','standard_clause')), -- 산출물 종류(= IF-01 ArtifactTemplateKind, CR-38)
  title_ko            TEXT    NOT NULL,                                            -- 제목
  template_md         TEXT    NOT NULL,                                            -- 작성 템플릿
  rubric_id           TEXT    NOT NULL,                                            -- ct_rubric.rubric_id
  rebuttal_bank_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(rebuttal_bank_json)), -- 반론 은행(객체 키)
  model_answer_md     TEXT    NOT NULL DEFAULT '',                                 -- 모범 답(제출 후 공개)
  primary_sources_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(primary_sources_json)), -- 1차 출처 span
  content_hash        TEXT    NOT NULL CHECK (length(content_hash) = 64),          -- 정준 레코드 sha256
  ext                 TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),       -- 확장
  ext_v               INTEGER NOT NULL DEFAULT 1,                                  -- ext 스키마 버전
  PRIMARY KEY (install_id, artifact_id)
) STRICT;

-- @table 실습 과제(코드·카타·알고리즘·보안 패치·인프라·SQL). 숨은 테스트는 클라이언트에 내려가지 않음. FR-LAB-*
CREATE TABLE ct_lab(
  install_id        TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  lab_id            TEXT    NOT NULL,                                              -- '<track>.lab.<slug>'
  track_id          TEXT    NOT NULL,                                              -- 주 트랙
  level             INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),                -- 대상 레벨
  kind              TEXT    NOT NULL CHECK (kind IN ('code','kata','algorithm','security_patch','infra','sql','predict')), -- 과제 종류
  language          TEXT    NOT NULL CHECK (language IN ('js','ts','sql','yaml','dockerfile','python_view')), -- python_view = ml·llm 예측형(실행 0, FR-LAB-017)
  task_md           TEXT    NOT NULL,                                              -- 과제 설명
  starter_code      TEXT    NOT NULL DEFAULT '',                                   -- 시작 코드
  public_tests      TEXT    NOT NULL DEFAULT '',                                   -- 공개 테스트 코드
  hidden_tests      TEXT    NOT NULL DEFAULT '',                                   -- 숨은 테스트 코드(응답 금지 필드)
  complexity_json   TEXT    CHECK (complexity_json IS NULL OR json_valid(complexity_json)), -- 복잡도 테스트 정의(AQ-17: n 집합·목표 차수)
  oracle_log_sha256 TEXT    CHECK (oracle_log_sha256 IS NULL OR length(oracle_log_sha256) = 64), -- 빌드타임 오라클 실행 로그 해시(ml·llm)
  content_hash      TEXT    NOT NULL CHECK (length(content_hash) = 64),            -- 정준 레코드 sha256
  ext               TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장
  ext_v             INTEGER NOT NULL DEFAULT 1,                                    -- ext 스키마 버전
  PRIMARY KEY (install_id, lab_id)
) STRICT;

-- @table 자격증 블루프린트(공식 출제기준만 출처). DR-027, AQ-13
CREATE TABLE ct_blueprint(
  install_id     TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위(시드 = 팩 'x.blueprints', 사용자 = 'u.local')
  blueprint_id   TEXT    NOT NULL,                                                 -- 'cert-cka@2026' · 'cert-jeongbo-pilgi@2026'
  exam           TEXT    NOT NULL,                                                 -- 시험 이름
  edition        TEXT    NOT NULL,                                                 -- 판본(연도 필수)
  source_url     TEXT    NOT NULL,                                                 -- 공식 출제기준 URL 또는 'user-file:<sha256>'
  source_edition TEXT    NOT NULL,                                                 -- 커밋 SHA·파일 sha256(AQ-13)
  title_ko       TEXT    NOT NULL,                                                 -- 표시 이름
  content_hash   TEXT    NOT NULL CHECK (length(content_hash) = 64),               -- 정준 레코드 sha256
  ext            TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),            -- 확장
  ext_v          INTEGER NOT NULL DEFAULT 1,                                       -- ext 스키마 버전
  PRIMARY KEY (install_id, blueprint_id)
) STRICT;

-- @table 블루프린트 세부 항목(과목·도메인 트리, 가중치)
CREATE TABLE ct_blueprint_item(
  install_id   TEXT NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE,     -- 설치 범위
  blueprint_id TEXT NOT NULL,                                                      -- 소속 블루프린트
  section_key  TEXT NOT NULL,                                                      -- 항목 객체 키('s1', 's1_3')
  parent_key   TEXT,                                                               -- 상위 항목 키
  title_ko     TEXT NOT NULL,                                                      -- 항목 이름
  weight       REAL NOT NULL DEFAULT 0,                                            -- 공식 가중치(0~1)
  PRIMARY KEY (install_id, blueprint_id, section_key)
) STRICT;

-- @table 블루프린트 항목 → 개념 매핑(가중 커버리지 계산)
CREATE TABLE ct_blueprint_map(
  install_id   TEXT NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE,     -- 설치 범위
  blueprint_id TEXT NOT NULL,                                                      -- 소속 블루프린트
  section_key  TEXT NOT NULL,                                                      -- 항목 키
  concept_id   TEXT NOT NULL,                                                      -- 매핑 개념
  weight       REAL NOT NULL DEFAULT 1.0,                                          -- 항목 내 가중
  PRIMARY KEY (install_id, blueprint_id, section_key, concept_id)
) STRICT;

-- @table 학습 경로(경로 = 카탈로그 콘텐츠, 팩 x.paths 또는 트랙 팩 paths/). SessionScope{kind:'path'}·IF-CT-010 원천. FR-CUR-019, CR-52
CREATE TABLE ct_path(
  install_id       TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE, -- 설치 범위
  path_id          TEXT    NOT NULL CHECK (length(path_id) BETWEEN 6 AND 128),     -- 'path.<slug>'(IF-01 PathId)
  title_ko         TEXT    NOT NULL,                                               -- 경로 이름
  description_ko   TEXT    NOT NULL DEFAULT '',                                    -- 설명(≤ 500자)
  tracks_json      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tracks_json)),  -- 관련 트랙 목록
  concept_ids_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(concept_ids_json)), -- 순서 있는 개념 ID 목록(≤ 300)
  content_hash     TEXT    NOT NULL CHECK (length(content_hash) = 64),             -- 정준 레코드 sha256
  PRIMARY KEY (install_id, path_id)
) STRICT;

-- @table Depth Map 사전 계산 좌표(packc layout.json, d3-force 고정 시드)
CREATE TABLE ct_layout(
  install_id TEXT    NOT NULL REFERENCES ct_pack(install_id) ON DELETE CASCADE,    -- 설치 범위
  concept_id TEXT    NOT NULL,                                                     -- 노드
  x          REAL    NOT NULL,                                                     -- 좌표 x
  y          REAL    NOT NULL,                                                     -- 좌표 y
  layer      INTEGER NOT NULL DEFAULT 0,                                           -- 레벨 층
  PRIMARY KEY (install_id, concept_id)
) STRICT;

-- @table 적용된 PackDelta(단일 수입 포트 ②). 팩 업그레이드 시 새 설치 위에 applied_at 순으로 재적용. delta_id 멱등
CREATE TABLE ct_pack_delta(
  delta_id           TEXT    NOT NULL PRIMARY KEY CHECK (length(delta_id) = 26),  -- PackDelta ULID(멱등 키)
  pack_id            TEXT    NOT NULL,                                             -- 대상 팩
  origin             TEXT    NOT NULL CHECK (origin IN ('import','gate','regate','tier_promotion','refresh','blueprint_import','case_foundry','report')), -- 발생 경로
  source_ref         TEXT,                                                         -- import job_id · ai job_id · report_id
  ops_json           TEXT    NOT NULL CHECK (json_valid(ops_json)),                -- op 목록(@fathom/contracts/pack/delta), op마다 base_version
  base_install_id    TEXT    NOT NULL REFERENCES ct_pack(install_id),              -- 작성 기준 설치
  applied_install_id TEXT    REFERENCES ct_pack(install_id),                       -- 마지막으로 적용된 설치
  status             TEXT    NOT NULL CHECK (status IN ('applied','conflicted','rejected')), -- 적용 결과
  created_at         INTEGER NOT NULL,                                             -- 접수 시각
  applied_at         INTEGER,                                                      -- 최초 적용 시각(재적용 순서 키)
  ext                TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),        -- 확장
  ext_v              INTEGER NOT NULL DEFAULT 1                                    -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_ct_pack_delta_pack ON ct_pack_delta(pack_id, applied_at);

-- @table PackDelta가 활성 설치 행을 덮어쓰기 전의 레코드 보존(append-only). DR-003 "구 버전 보존"
CREATE TABLE ct_record_history(
  history_id   TEXT    NOT NULL PRIMARY KEY CHECK (length(history_id) = 26),       -- ULID
  install_id   TEXT    NOT NULL,                                                   -- 원 레코드 설치
  record_kind  TEXT    NOT NULL,                                                   -- 'concept'|'ku'|'misconception'|'case'|'source'|'blueprint'…
  record_id    TEXT    NOT NULL,                                                   -- 원 레코드 ID
  content_hash TEXT    NOT NULL CHECK (length(content_hash) = 64),                 -- 원 레코드 해시
  record_json  TEXT    NOT NULL CHECK (json_valid(record_json)),                   -- 원 레코드 정준 JSON
  delta_id     TEXT    NOT NULL,                                                   -- 덮어쓴 PackDelta
  created_at   INTEGER NOT NULL                                                    -- 보존 시각
) STRICT;
CREATE INDEX ix_ct_record_history_record ON ct_record_history(record_kind, record_id);
CREATE TRIGGER ct_record_history_no_update BEFORE UPDATE ON ct_record_history BEGIN SELECT RAISE(ABORT, 'ct_record_history is append-only'); END;
CREATE TRIGGER ct_record_history_no_delete BEFORE DELETE ON ct_record_history BEGIN SELECT RAISE(ABORT, 'ct_record_history is append-only'); END;

-- @table 사용자 오버레이 패치 이벤트(append-only, 되돌리기 = 역패치). 조회 = 팩 ⊕ 오버레이. export·병합 대상. DR-026, DR-020(overlay.base_version)
CREATE TABLE ct_overlay_event(
  overlay_id    TEXT    NOT NULL PRIMARY KEY CHECK (length(overlay_id) = 26),       -- ULID(병합 import 멱등 키)
  target_kind   TEXT    NOT NULL CHECK (target_kind IN ('concept','ku','misconception','item','case','source')), -- 대상 종류
  target_id     TEXT    NOT NULL,                                                  -- 대상 ID(설치 무관 논리 ID)
  field         TEXT    NOT NULL,                                                  -- 대상 필드('statement','answer_key','explanation_md','options.opt_b',  'status' …)
  base_version  TEXT    NOT NULL,                                                  -- DR-020 이름 훅. '<pack version>@<sha256(정준 기준 필드값) 앞 16자>'
  new_value     TEXT    NOT NULL CHECK (json_valid(new_value)),                    -- 새 값(JSON)
  reason        TEXT    NOT NULL,                                                  -- 사유(신고 처리·사용자 수정 …)
  device_id     TEXT    NOT NULL CHECK (length(device_id) = 26),                   -- 작성 기기(ULID)
  ts            INTEGER NOT NULL,                                                  -- 작성 기기 시각(epoch ms) — 합성 순서 (ts, device_id, overlay_id)
  revert_of     TEXT    CHECK (revert_of IS NULL OR length(revert_of) = 26),       -- 되돌리는 overlay_id(역패치)
  recorded_at   INTEGER NOT NULL,                                                  -- 이 DB 기록 시각(export since 기준)
  ext           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),             -- 확장
  ext_v         INTEGER NOT NULL DEFAULT 1                                         -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_ct_overlay_event_target   ON ct_overlay_event(target_kind, target_id, field, ts, device_id);
CREATE INDEX ix_ct_overlay_event_recorded ON ct_overlay_event(recorded_at);
CREATE TRIGGER ct_overlay_event_no_update BEFORE UPDATE ON ct_overlay_event BEGIN SELECT RAISE(ABORT, 'ct_overlay_event is append-only'); END;
CREATE TRIGGER ct_overlay_event_no_delete BEFORE DELETE ON ct_overlay_event BEGIN SELECT RAISE(ABORT, 'ct_overlay_event is append-only'); END;

-- @table 오버레이 합성 결과(필드별 현재 유효 패치). ct_overlay_event에서 언제든 재구성(파생)
CREATE TABLE ct_overlay_head(
  target_kind  TEXT    NOT NULL,                                                   -- 대상 종류
  target_id    TEXT    NOT NULL,                                                   -- 대상 ID
  field        TEXT    NOT NULL,                                                   -- 대상 필드
  overlay_id   TEXT    NOT NULL,                                                   -- 현재 유효 overlay_id
  value        TEXT    NOT NULL CHECK (json_valid(value)),                         -- 유효 값
  base_version TEXT    NOT NULL,                                                   -- 유효 패치의 base_version
  status       TEXT    NOT NULL CHECK (status IN ('applied','conflicted','reverted')), -- 재적용 결과(conflicted면 aq_staging_diff 존재)
  updated_at   INTEGER NOT NULL,                                                   -- 갱신 시각
  PRIMARY KEY (target_kind, target_id, field)
) STRICT, WITHOUT ROWID;

-- 활성 설치 뷰(조회 표준 경로). 뷰는 읽기 전용이며 쓰기는 application/catalog/ingest/만
CREATE VIEW ct_track_active   AS SELECT t.* FROM ct_track t   JOIN ct_pack_active a ON a.install_id = t.install_id;
CREATE VIEW ct_concept_active AS SELECT c.* FROM ct_concept c JOIN ct_pack_active a ON a.install_id = c.install_id;
CREATE VIEW ct_concept_edge_active AS SELECT e.* FROM ct_concept_edge e JOIN ct_pack_active a ON a.install_id = e.install_id;
CREATE VIEW ct_ku_active      AS SELECT k.* FROM ct_ku k      JOIN ct_pack_active a ON a.install_id = k.install_id;
CREATE VIEW ct_misconception_active AS SELECT m.* FROM ct_misconception m JOIN ct_pack_active a ON a.install_id = m.install_id;
CREATE VIEW ct_case_active    AS SELECT c.* FROM ct_case c    JOIN ct_pack_active a ON a.install_id = c.install_id;
CREATE VIEW ct_lab_active     AS SELECT l.* FROM ct_lab l     JOIN ct_pack_active a ON a.install_id = l.install_id;
