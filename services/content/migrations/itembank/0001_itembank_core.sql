-- @fathom:module=itembank version=1 kind=additive
-- services/content/migrations/itembank/0001_itembank_core.sql
-- 문항·ItemModel은 내용 주소(item_id, content_hash) 행. 팩 출신 행의 가시성 = ib_install_member ⋈ ib_active_install.
-- 출제 가능 = gate_status IN ('seed_reviewed','jev_verified','gated_pass') (이중 방어, FR-QST-011). DR-007~009, DR-020

-- @table itembank 측 활성 설치 사본(catalog 활성 포인터 전환 tx 안에서 IngestPort가 함께 갱신). 교차 모듈 SQL JOIN 회피용
CREATE TABLE ib_active_install(
  pack_id     TEXT    NOT NULL PRIMARY KEY,                                        -- 팩 ID
  install_id  TEXT    NOT NULL CHECK (length(install_id) = 26),                    -- 활성 설치(= ct_pack_active.install_id)
  switched_at INTEGER NOT NULL                                                     -- 전환 시각
) STRICT;

-- @table 설치 ↔ 팩 출신 문항·ItemModel 멤버십(설치별 사본, 트랙당 수백 행). 런타임 출신 행은 멤버십 없이 항상 가시
CREATE TABLE ib_install_member(
  install_id   TEXT NOT NULL CHECK (length(install_id) = 26),                      -- 설치
  kind         TEXT NOT NULL CHECK (kind IN ('item','item_model')),                -- 멤버 종류
  ref_id       TEXT NOT NULL,                                                      -- item_id 또는 model_id
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),                    -- 해당 설치가 가리키는 리비전
  PRIMARY KEY (install_id, kind, ref_id)
) STRICT;
CREATE INDEX ix_ib_install_member_ref ON ib_install_member(kind, ref_id, content_hash);

-- @table ItemModel(선언적 문항 템플릿, T2). status 전이 draft → active → retired만. DR-007, FR-QST-002·005
CREATE TABLE ib_item_model(
  model_id          TEXT    NOT NULL,                                              -- '<concept_id>.im<nn>' · LLM 저작 ULID
  content_hash      TEXT    NOT NULL CHECK (length(content_hash) = 64),            -- 정준 레코드 sha256(리비전 키)
  origin            TEXT    NOT NULL CHECK (origin IN ('pack','runtime')),         -- 팩 출신 | 런타임 저작
  concept_id        TEXT    NOT NULL,                                              -- 대상 개념
  format            TEXT    NOT NULL,                                              -- contracts FormatId
  ku_ids_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(ku_ids_json)), -- 근거 KU
  slots_json        TEXT    NOT NULL CHECK (json_valid(slots_json)),               -- 슬롯 정의(객체 키)
  constraints_json  TEXT    NOT NULL CHECK (json_valid(constraints_json)),         -- 제약
  metamorphic_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metamorphic_json)), -- preserve·flip 선언(FR-QST-010)
  stem_family       TEXT    NOT NULL,                                              -- 문형 계열(로테이션 단위)
  status            TEXT    NOT NULL CHECK (status IN ('draft','active','retired')), -- 상태
  author            TEXT    NOT NULL CHECK (author IN ('seed','llm','user')),      -- 저작 주체
  prompt_version    TEXT,                                                          -- LLM 저작 시 프롬프트 버전(계보)
  sample_gate_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(sample_gate_json)), -- 표본 8개 게이트 결과 요약
  created_at        INTEGER NOT NULL,                                              -- 생성 시각
  status_at         INTEGER NOT NULL,                                              -- 상태 변경 시각
  ext               TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장
  ext_v             INTEGER NOT NULL DEFAULT 1,                                    -- ext 스키마 버전
  PRIMARY KEY (model_id, content_hash)
) STRICT;
CREATE INDEX ix_ib_item_model_concept ON ib_item_model(concept_id, status);

-- @table 문항 인스턴스(정답·해설 포함 — 제출 전 응답 금지 필드). 자급형 계측기: snapshot_json에 KU·오개념 스냅샷. DR-008, DR-020(item.source_kind·stem_family·gate_status·defect_manifest)
CREATE TABLE ib_item(
  item_id           TEXT    NOT NULL,                                              -- 시드 '<concept_id>.i<nn>' · 런타임 ULID(불변 논리 ID)
  content_hash      TEXT    NOT NULL CHECK (length(content_hash) = 64),            -- 정준 문항 sha256(= Verdict.item_content_hash)
  origin            TEXT    NOT NULL CHECK (origin IN ('pack','runtime')),         -- 팩 출신(멤버십 가시성) | 런타임(항상 가시)
  model_id          TEXT,                                                          -- 전개 원 ItemModel
  family_id         TEXT    NOT NULL,                                              -- 격리 단위(ItemModel·생성 배치·프롬프트 버전)
  concept_id        TEXT    NOT NULL,                                              -- 대상 개념
  ku_ids_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(ku_ids_json)), -- 근거 KU(cited_ku_ids)
  mc_ids_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(mc_ids_json)), -- 연결 오개념
  facet             TEXT    NOT NULL,                                              -- 카드 facet
  format            TEXT    NOT NULL,                                              -- contracts FormatId 33종('ox','mcq','mcq_multi','cloze','short','order','matching','parsons','code_predict','error_find','config_review','log_read','code_task','sql_task','infra_lite','cond_reversal','digging_d4_mcq','audit' …, IF-01 §2.4, CR-36)
  response_mode     TEXT    NOT NULL CHECK (response_mode IN ('recognition','production')), -- 인출 방식
  level             INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),                -- 대상 레벨
  bloom             TEXT    NOT NULL,                                              -- Bloom 단계
  stakes            TEXT    NOT NULL CHECK (stakes IN ('S0','S1','S2')),           -- 위험 등급
  tier              TEXT    NOT NULL CHECK (tier IN ('A','B','C')),                -- 개념 티어(발행 시점)
  n_options         INTEGER NOT NULL DEFAULT 0 CHECK (n_options >= 0),             -- 선택지 수(0 = 열린 형식, SP-6 F0 추측 보정 c = 1/n)
  beta_prior        REAL    NOT NULL DEFAULT 0,                                    -- 난이도 prior(V9)
  stem_json         TEXT    NOT NULL CHECK (json_valid(stem_json)),                -- 문두(렌더 블록)
  options_json      TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(options_json)), -- 선택지(객체 키 'opt_a'… — 배열 금지)
  answer_key_json   TEXT    NOT NULL CHECK (json_valid(answer_key_json)),          -- 정답 키(제출 전 응답 금지)
  explanation_md    TEXT    NOT NULL DEFAULT '',                                   -- 해설(응답 후 공개)
  distractor_mc_json TEXT   NOT NULL DEFAULT '{}' CHECK (json_valid(distractor_mc_json)), -- 오답지 키 → mc_id
  lab_id            TEXT,                                                          -- 실행 형식의 ct_lab.lab_id
  source_kind       TEXT    NOT NULL CHECK (source_kind IN ('seed','t1','t2','t3','t4','gap','user_error','past_self','user_authored','repo','imported')), -- DR-020 이름 훅(러너 출처 정책 입력)
  stem_family       TEXT    NOT NULL,                                              -- DR-020 이름 훅. 문형 계열(30일 로테이션)
  gate_status       TEXT    NOT NULL CHECK (gate_status IN ('authored','seed_reviewed','jev_verified','flagged','demoted','quarantined','retired','draft','deferred','gated_pass','gated_fail')), -- DR-020 이름 훅. FR-QST-011 상태기계
  gate_status_at    INTEGER NOT NULL,                                              -- gate_status 변경 시각
  defect_manifest   TEXT    CHECK (defect_manifest IS NULL OR json_valid(defect_manifest)), -- DR-020 이름 훅. 주입 결함 정답 키(M-16·보안 패치)
  s2_mode           TEXT    CHECK (s2_mode IS NULL OR s2_mode IN ('cross_family','same_family','v7_review')), -- S2 승인 방식(FR-QST-004)
  lineage_json      TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(lineage_json)), -- 계보(prompt_version·ai job·import job·generator seed)
  snapshot_json     TEXT    NOT NULL CHECK (json_valid(snapshot_json)),            -- 발행 시점 KU·오개념 스냅샷(채점 전용, catalog 무조회)
  overlay_json      TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(overlay_json)), -- 오버레이 유효 패치(필드 → 값). ItemReader가 합성
  created_at        INTEGER NOT NULL,                                              -- 행 생성 시각
  ext               TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장(DR-020 ext: item.mutants, item.panel_distribution)
  ext_v             INTEGER NOT NULL DEFAULT 1,                                    -- ext 스키마 버전
  PRIMARY KEY (item_id, content_hash)
) STRICT;
CREATE INDEX ix_ib_item_select   ON ib_item(concept_id, facet, response_mode, format);
CREATE INDEX ix_ib_item_servable ON ib_item(concept_id, format, level) WHERE gate_status IN ('seed_reviewed','jev_verified','gated_pass');
CREATE INDEX ix_ib_item_family   ON ib_item(family_id);
CREATE INDEX ix_ib_item_model    ON ib_item(model_id);
CREATE INDEX ix_ib_item_gate     ON ib_item(gate_status, gate_status_at);

-- @table 생성 문항 스테이징(draft → deferred → gated_pass/gated_fail). gated_pass만 PackDelta publish_items로 ib_item에 발행
CREATE TABLE ib_staging_item(
  staging_id     TEXT    NOT NULL PRIMARY KEY CHECK (length(staging_id) = 26),     -- ULID(발행 시 runtime item_id로 재사용)
  origin         TEXT    NOT NULL CHECK (origin IN ('t1','t2','t3','t4','user_authored','model_sample','gap')), -- 생성 경로
  concept_id     TEXT    NOT NULL,                                                 -- 대상 개념
  model_id       TEXT,                                                             -- ItemModel(전개·표본)
  job_ref        TEXT,                                                             -- ai-gateway job_id 또는 import job_id
  work_order_id  TEXT,                                                             -- 작업 주문
  payload_json   TEXT    NOT NULL CHECK (json_valid(payload_json)),                -- 문항 후보 전체(ib_item 문법)
  cited_ku_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(cited_ku_ids_json)), -- 근거 KU(누락 = 저장 거부)
  status         TEXT    NOT NULL CHECK (status IN ('draft','deferred','gated_pass','gated_fail','discarded','review')), -- 게이트 진행 상태
  s2_mode        TEXT    CHECK (s2_mode IS NULL OR s2_mode IN ('cross_family','same_family')), -- S2 승인 방식
  created_at     INTEGER NOT NULL,                                                 -- 생성 시각
  updated_at     INTEGER NOT NULL,                                                 -- 갱신 시각
  expires_at     INTEGER,                                                          -- gated_fail·discarded 정리 시각(+30일). deferred는 NULL(보존)
  ext            TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),            -- 확장
  ext_v          INTEGER NOT NULL DEFAULT 1                                        -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_ib_staging_item_status ON ib_staging_item(status, updated_at);

-- @table 게이트 결과(문항·스테이징·ItemModel별, append-only). DR-009, FR-QST-008
CREATE TABLE ib_gate_result(
  gate_result_id    TEXT    NOT NULL PRIMARY KEY CHECK (length(gate_result_id) = 26), -- ULID(Verdict.gate_result_id)
  subject_kind      TEXT    NOT NULL CHECK (subject_kind IN ('item','staging','item_model')), -- 검사 대상 종류
  subject_id        TEXT    NOT NULL,                                              -- item_id · staging_id · model_id
  content_hash      TEXT    CHECK (content_hash IS NULL OR length(content_hash) = 64), -- 대상 리비전(staging은 NULL)
  gate              TEXT    NOT NULL,                                              -- 'G0'~'G13' · 'V7' · 'S2_APPROVAL' · 'META'
  engine            TEXT    NOT NULL CHECK (engine IN ('D','J','LJ','H','S','USER','ORACLE')), -- 판정 엔진
  provider_id       TEXT,                                                          -- J·LJ 제공자
  run_context       TEXT    NOT NULL CHECK (run_context IN ('seed_build','generate','regate','import','appeal','health')), -- 실행 맥락
  pass              INTEGER NOT NULL CHECK (pass IN (0,1)),                         -- 통과 여부
  score             REAL,                                                          -- 지표값(예: G3 키 확률)
  probabilities_json TEXT   CHECK (probabilities_json IS NULL OR json_valid(probabilities_json)), -- 객체 키 확률 분포
  judge_log_ref     TEXT,                                                          -- ai_judge_log.judge_log_id(ai.db, 논리 참조)
  detail_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)), -- 상세(규칙 ID·실행 결과)
  created_at        INTEGER NOT NULL                                               -- 판정 시각
) STRICT;
CREATE INDEX ix_ib_gate_result_subject ON ib_gate_result(subject_kind, subject_id, gate);
CREATE TRIGGER ib_gate_result_no_update BEFORE UPDATE ON ib_gate_result BEGIN SELECT RAISE(ABORT, 'ib_gate_result is append-only'); END;
CREATE TRIGGER ib_gate_result_no_delete BEFORE DELETE ON ib_gate_result BEGIN SELECT RAISE(ABORT, 'ib_gate_result is append-only'); END;

-- @table gate_status 전이 이력(append-only). GateStateMachine의 감사 기록
CREATE TABLE ib_gate_transition(
  transition_id  TEXT    NOT NULL PRIMARY KEY CHECK (length(transition_id) = 26),  -- ULID
  item_id        TEXT    NOT NULL,                                                 -- 문항
  content_hash   TEXT    NOT NULL CHECK (length(content_hash) = 64),               -- 리비전
  from_status    TEXT    NOT NULL,                                                 -- 이전 상태
  to_status      TEXT    NOT NULL,                                                 -- 새 상태
  basis          TEXT    NOT NULL,                                                 -- 'v7'|'regate_g3'|'regate_g5'|'report'|'health'|'overlay'|'family'|'pack_load'
  gate_result_id TEXT,                                                             -- 근거 게이트 결과
  created_at     INTEGER NOT NULL                                                  -- 전이 시각
) STRICT;
CREATE INDEX ix_ib_gate_transition_item ON ib_gate_transition(item_id, created_at);
CREATE TRIGGER ib_gate_transition_no_update BEFORE UPDATE ON ib_gate_transition BEGIN SELECT RAISE(ABORT, 'ib_gate_transition is append-only'); END;
CREATE TRIGGER ib_gate_transition_no_delete BEFORE DELETE ON ib_gate_transition BEGIN SELECT RAISE(ABORT, 'ib_gate_transition is append-only'); END;

-- @table 계보 간선 KU → ItemModel → 인스턴스 → 게이트 → 노출(append-only). FR-QST-015
CREATE TABLE ib_lineage_edge(
  from_kind  TEXT    NOT NULL CHECK (from_kind IN ('ku','item_model','item','gate_result','import_job','ai_job','prompt','staging')), -- 출발 종류
  from_id    TEXT    NOT NULL,                                                     -- 출발 ID
  to_kind    TEXT    NOT NULL CHECK (to_kind IN ('item_model','item','gate_result','staging')), -- 도착 종류
  to_id      TEXT    NOT NULL,                                                     -- 도착 ID
  rel        TEXT    NOT NULL,                                                     -- 'derived_from'|'expanded_to'|'gated_by'|'generated_by'|'published_as'
  created_at INTEGER NOT NULL,                                                     -- 기록 시각
  PRIMARY KEY (from_kind, from_id, to_kind, to_id, rel)
) STRICT;
CREATE INDEX ix_ib_lineage_edge_to ON ib_lineage_edge(to_kind, to_id);
CREATE TRIGGER ib_lineage_edge_no_update BEFORE UPDATE ON ib_lineage_edge BEGIN SELECT RAISE(ABORT, 'ib_lineage_edge is append-only'); END;
CREATE TRIGGER ib_lineage_edge_no_delete BEFORE DELETE ON ib_lineage_edge BEGIN SELECT RAISE(ABORT, 'ib_lineage_edge is append-only'); END;

-- @table 격리·동결 단위(ItemModel·생성 배치·프롬프트 버전 패밀리). FR-QST-014·015, GR-05
CREATE TABLE ib_family(
  family_id   TEXT    NOT NULL PRIMARY KEY,                                        -- 'im:<model_id>' | 'batch:<job_id>' | 'prompt:<task>@<ver>' | 'pack:<pack_id>'
  kind        TEXT    NOT NULL CHECK (kind IN ('item_model','batch','prompt_version','seed_pack')), -- 패밀리 종류
  state       TEXT    NOT NULL DEFAULT 'active' CHECK (state IN ('active','frozen','quarantined','retired')), -- 출제 상태
  reason      TEXT,                                                                -- 상태 사유
  error_budget_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(error_budget_json)), -- 7일 신고율·에러 버짓
  updated_at  INTEGER NOT NULL,                                                    -- 갱신 시각
  ext         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),               -- 확장
  ext_v       INTEGER NOT NULL DEFAULT 1                                           -- ext 스키마 버전
) STRICT;

-- @table 문항 통계(β 추정·노출·로테이션). learning.evidence.recorded로 갱신(파생)
CREATE TABLE ib_item_stat(
  item_id         TEXT    NOT NULL,                                                -- 문항
  content_hash    TEXT    NOT NULL CHECK (length(content_hash) = 64),              -- 리비전
  beta_est        REAL    NOT NULL,                                                -- 현재 β 추정(Verdict.item_beta_snapshot 원천)
  n_responses     INTEGER NOT NULL DEFAULT 0,                                      -- 응답 수
  n_correct       INTEGER NOT NULL DEFAULT 0,                                      -- 정답 수
  n_rapid         INTEGER NOT NULL DEFAULT 0,                                      -- rapid 응답 수
  latency_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(latency_json)),  -- 응답시간 요약(평균·분산, z 이상치)
  last_exposed_at INTEGER,                                                         -- 마지막 노출(30일 재노출 금지)
  last_ledger_event_id TEXT,                                                       -- 마지막 반영 원장 이벤트
  updated_at      INTEGER NOT NULL,                                                -- 갱신 시각
  PRIMARY KEY (item_id, content_hash)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_ib_item_stat_exposed ON ib_item_stat(last_exposed_at);

-- @table 선택지별 선택 수(선택률 0% 오답지 탐지)
CREATE TABLE ib_option_pick(
  item_id      TEXT    NOT NULL,                                                   -- 문항
  content_hash TEXT    NOT NULL CHECK (length(content_hash) = 64),                 -- 리비전
  option_key   TEXT    NOT NULL,                                                   -- 선택지 객체 키
  picks        INTEGER NOT NULL DEFAULT 0,                                         -- 선택 수
  PRIMARY KEY (item_id, content_hash, option_key)
) STRICT, WITHOUT ROWID;

-- @table 문형 로테이션(개념 × stem_family 마지막 노출). FR-QST-006
CREATE TABLE ib_stem_rotation(
  concept_id      TEXT    NOT NULL,                                                -- 개념
  stem_family     TEXT    NOT NULL,                                                -- 문형 계열
  last_exposed_at INTEGER NOT NULL,                                                -- 마지막 노출
  exposures       INTEGER NOT NULL DEFAULT 1,                                      -- 노출 수
  PRIMARY KEY (concept_id, stem_family)
) STRICT, WITHOUT ROWID;

-- @table 문항 건강 플래그(drift·선택률 0%·응답시간 z·신고율·문형 암기). FR-QST-014
CREATE TABLE ib_item_health(
  item_id      TEXT    NOT NULL,                                                   -- 문항
  content_hash TEXT    NOT NULL CHECK (length(content_hash) = 64),                 -- 리비전
  flags_json   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(flags_json)),       -- 활성 플래그 목록
  metrics_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(metrics_json)),     -- 계산 지표
  checked_at   INTEGER NOT NULL,                                                   -- 계산 시각
  PRIMARY KEY (item_id, content_hash)
) STRICT, WITHOUT ROWID;

-- @table 힌트 열람 기록(서버 측 hints_used = max(클라이언트 값, 이 표의 step 수), IF-CT-056·IF-01 D-19). 30일 보존. FR-LAB-005, FR-QST-025, CR-40
CREATE TABLE ib_hint_open(
  session_id TEXT    NOT NULL CHECK (length(session_id) = 26),                       -- learning 세션(논리 참조)
  block_id   TEXT    CHECK (block_id IS NULL OR length(block_id) = 26),              -- learning 블록
  item_id    TEXT    NOT NULL,                                                       -- 문항
  step       INTEGER NOT NULL CHECK (step BETWEEN 1 AND 4),                          -- 힌트 단계(h1~h4)
  opened_at  INTEGER NOT NULL,                                                       -- 열람 시각
  PRIMARY KEY (session_id, item_id, step)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_ib_hint_open_opened ON ib_hint_open(opened_at);

-- @table 문항 신고(R 키). 신고 즉시 본인 큐 제외 + 증거 무효화 보정. FR-QST-016
CREATE TABLE ib_report(
  report_id           TEXT    NOT NULL PRIMARY KEY CHECK (length(report_id) = 26), -- ULID
  item_id             TEXT    NOT NULL,                                            -- 문항
  content_hash        TEXT    NOT NULL CHECK (length(content_hash) = 64),          -- 리비전
  attempt_id          TEXT,                                                        -- 신고한 응답
  reason              TEXT    NOT NULL CHECK (reason IN ('key_wrong','ambiguous','outdated','other')), -- 사유(= IF-01 ReportReason, CR-38)
  note                TEXT    NOT NULL DEFAULT '',                                 -- 사용자 메모(C1)
  classification_json TEXT    CHECK (classification_json IS NULL OR json_valid(classification_json)), -- AI-J19 분류 결과
  status              TEXT    NOT NULL DEFAULT 'received' CHECK (status IN ('received','classified','resolved')), -- 처리 상태(= IF-01 ReportView.state)
  resolution          TEXT    CHECK (resolution IS NULL OR resolution IN ('fixed_overlay','retired','kept')), -- 처리 결과(resolved일 때, = ReportView.resolution.kind, CR-38)
  resolution_note     TEXT,                                                        -- 처리 사유(사용자 표시)
  overlay_id          TEXT,                                                        -- 수정에 쓴 오버레이
  created_at          INTEGER NOT NULL,                                            -- 신고 시각
  resolved_at         INTEGER,                                                     -- 처리 시각
  ext                 TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),       -- 확장
  ext_v               INTEGER NOT NULL DEFAULT 1                                   -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_ib_report_status ON ib_report(status, created_at);
CREATE INDEX ix_ib_report_item   ON ib_report(item_id);

-- @table 증거 보정 발행 기록(itembank.item.corrected의 원천, append-only). FR-QST-011·015
CREATE TABLE ib_correction(
  correction_id   TEXT    NOT NULL PRIMARY KEY CHECK (length(correction_id) = 26), -- ULID
  item_id         TEXT    NOT NULL,                                                -- 문항
  content_hash    TEXT    NOT NULL CHECK (length(content_hash) = 64),              -- 리비전
  correction      TEXT    NOT NULL CHECK (correction IN ('quarantined','demoted','key_fixed','retired')), -- 보정 종류
  evidence_policy TEXT    NOT NULL CHECK (evidence_policy IN ('void','halve','keep')), -- 증거 정책
  basis           TEXT    NOT NULL CHECK (basis IN ('regate_g3','regate_g5','report','health','overlay','pack_upgrade')), -- 근거(pack_upgrade = 팩 개정으로 정답 키 변경, CR-33·CR-42)
  gate_result_id  TEXT,                                                            -- 근거 게이트 결과
  effective_from  INTEGER NOT NULL,                                                -- 적용 시작 시각
  outbox_event_id TEXT    NOT NULL,                                                -- 발행한 outbox.event_id
  created_at      INTEGER NOT NULL                                                 -- 기록 시각
) STRICT;
CREATE INDEX ix_ib_correction_item ON ib_correction(item_id);
CREATE TRIGGER ib_correction_no_update BEFORE UPDATE ON ib_correction BEGIN SELECT RAISE(ABORT, 'ib_correction is append-only'); END;
CREATE TRIGGER ib_correction_no_delete BEFORE DELETE ON ib_correction BEGIN SELECT RAISE(ABORT, 'ib_correction is append-only'); END;

-- @table 워밍 풀 수요(learning.demand.forecasted 최신 스냅샷, 14일). FR-QST-013
CREATE TABLE ib_warming_demand(
  concept_id  TEXT    NOT NULL,                                                    -- 개념
  facet       TEXT    NOT NULL,                                                    -- facet
  format      TEXT    NOT NULL,                                                    -- 형식
  level       INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),                      -- 레벨
  n           INTEGER NOT NULL CHECK (n >= 0),                                     -- 14일 수요
  computed_at INTEGER NOT NULL,                                                    -- 예측 시각(이벤트 payload)
  PRIMARY KEY (concept_id, facet, format, level)
) STRICT, WITHOUT ROWID;
