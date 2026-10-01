-- @fathom:module=acquisition version=1 kind=additive
-- services/content/migrations/acquisition/0001_acquisition_core.sql
-- 가져오기 파이프라인 I1~I9, 스테이징(승인 전 = 출제 0), Inbox, 후보 큐. 원문은 저장 전에 ingress 마스킹(ADR-016 §4). DR-019

-- @table 가져오기 작업(입력 1건 = 작업 1건). 단계 상태기계 I1 → I1_5 → I2 … I9, 실패 단계부터 재개. FR-IMP-001·003
CREATE TABLE aq_import_job(
  job_id         TEXT    NOT NULL PRIMARY KEY CHECK (length(job_id) = 26),         -- ULID(= correlation_id)
  source_kind    TEXT    NOT NULL CHECK (source_kind IN ('url','paste','file','inbox','folder','blueprint','pack_refresh','case_foundry')), -- 입력 종류(= IF-01 ImportJobView.source_kind, CR-38)
  input_ref      TEXT    NOT NULL,                                                 -- 마스킹된 표시용 참조(URL·파일명). 비밀 0
  input_sha256   TEXT    NOT NULL CHECK (length(input_sha256) = 64),               -- 정규화(I1) 전 원 입력 sha256
  input_bytes    INTEGER NOT NULL CHECK (input_bytes BETWEEN 0 AND 2097152),       -- 입력 크기(≤ 2MB, FR-IMP-001)
  sensitive      INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),            -- 민감 자료 표시(FR-IMP-010)
  local_only     INTEGER NOT NULL DEFAULT 0 CHECK (local_only IN (0,1)),           -- 로컬 LLM 강제(FR-AI-023)
  masking        TEXT    NOT NULL CHECK (masking IN ('full','partial')),           -- partial = ai-gateway 다운으로 내장 규칙만 적용(재스캔 대상)
  stage          TEXT    NOT NULL CHECK (stage IN ('I1','I1_5','I2','I3','I4','I5','I6','I7','COPY_GUARD','I8','I9')), -- 현재(또는 실패) 단계. 저장 철자 'I1_5' ↔ wire 'I1.5'(IF-01 ImportStage, 리포지토리 매퍼가 변환), 'COPY_GUARD' = wire 동일(CR-38)
  status         TEXT    NOT NULL CHECK (status IN ('queued','running','awaiting_work_order','awaiting_approval','published','rejected','failed','cancelled')), -- 작업 상태(= IF-01 ImportJobView.state, CR-38)
  stage_state_json TEXT  NOT NULL DEFAULT '{}' CHECK (json_valid(stage_state_json)), -- 단계별 산출 요약·재개 지점
  trust          TEXT    NOT NULL CHECK (trust IN ('user','llm_unverified','verified')), -- 결과 기본 신뢰 등급
  target_pack_id TEXT    NOT NULL DEFAULT 'u.local',                               -- 발행 대상 팩
  work_order_id  TEXT    CHECK (work_order_id IS NULL OR length(work_order_id) = 26), -- ai-gateway 작업 주문
  error_code     TEXT,                                                             -- 실패 코드
  created_at     INTEGER NOT NULL,                                                 -- 생성 시각
  updated_at     INTEGER NOT NULL,                                                 -- 갱신 시각
  completed_at   INTEGER,                                                          -- 완료(발행 또는 취소) 시각
  ext            TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),            -- 확장
  ext_v          INTEGER NOT NULL DEFAULT 1                                        -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_aq_import_job_status ON aq_import_job(status, updated_at);

-- @table I1 정규화·I2 청크 결과(마스킹 후 원문). 주입 의심 청크는 quarantined. 데이터 등급 C2/C3
CREATE TABLE aq_import_chunk(
  job_id              TEXT    NOT NULL REFERENCES aq_import_job(job_id) ON DELETE CASCADE, -- 소속 작업
  chunk_no            INTEGER NOT NULL CHECK (chunk_no >= 1),                       -- 청크 순번
  heading_path        TEXT    NOT NULL DEFAULT '',                                  -- 헤딩 경로('MVCC > 스냅샷')
  text_masked         TEXT    NOT NULL,                                             -- 마스킹된 본문(비밀 0, NFR-DATA-010)
  data_class          TEXT    NOT NULL CHECK (data_class IN ('C2','C3')),           -- 데이터 등급
  injection_flags_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(injection_flags_json)), -- 주입 탐지 규칙 ID(H·AI-J16)
  quarantined         INTEGER NOT NULL DEFAULT 0 CHECK (quarantined IN (0,1)),      -- 주입 의심 격리
  user_confirmed      INTEGER NOT NULL DEFAULT 0 CHECK (user_confirmed IN (0,1)),   -- 격리 해제 사용자 확인
  PRIMARY KEY (job_id, chunk_no)
) STRICT;

-- @table 스테이징 항목(추출 결과·승인 대기). 승인 시 PackDelta로만 서빙 테이블 반영. 미승인 30일 후 삭제. FR-IMP-009
CREATE TABLE aq_staging_item(
  staging_id    TEXT    NOT NULL PRIMARY KEY CHECK (length(staging_id) = 26),      -- ULID
  job_id        TEXT    NOT NULL REFERENCES aq_import_job(job_id) ON DELETE CASCADE, -- 소속 작업
  kind          TEXT    NOT NULL CHECK (kind IN ('concept','ku','misconception','relation','case','source','blueprint')), -- 항목 종류
  proposed_id   TEXT    NOT NULL,                                                  -- 제안 ID('u.local.<slug>' 등)
  payload_json  TEXT    NOT NULL CHECK (json_valid(payload_json)),                 -- 팩 레코드 문법의 제안 레코드
  trust         TEXT    NOT NULL CHECK (trust IN ('user','llm_unverified','verified')), -- 신뢰 등급
  evidence_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_json)),   -- 원문 span·근거 검증(AI-J14 p) 결과
  merge_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(merge_json)),      -- 중복·동형 후보(유사도, FR-IMP-008)
  decision      TEXT    NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','rejected','edited')), -- 승인 결정
  decided_at    INTEGER,                                                           -- 결정 시각
  delta_id      TEXT    CHECK (delta_id IS NULL OR length(delta_id) = 26),         -- 발행한 PackDelta
  created_at    INTEGER NOT NULL,                                                  -- 생성 시각
  expires_at    INTEGER NOT NULL,                                                  -- created_at + 30일(pending만 만료 삭제)
  ext           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),             -- 확장
  ext_v         INTEGER NOT NULL DEFAULT 1                                         -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_aq_staging_item_job     ON aq_staging_item(job_id, decision);
CREATE INDEX ix_aq_staging_item_expires ON aq_staging_item(expires_at) WHERE decision = 'pending';

-- @table 스테이징 diff·충돌 큐(가져오기 diff, 오버레이 재적용 충돌, refresh diff, 모순 탐지). 항목별 승인·거절
CREATE TABLE aq_staging_diff(
  diff_id             TEXT    NOT NULL PRIMARY KEY CHECK (length(diff_id) = 26),   -- ULID
  origin              TEXT    NOT NULL CHECK (origin IN ('import','overlay_conflict','refresh','contradiction','merge_candidate')), -- 발생 경로
  job_id              TEXT,                                                        -- 관련 가져오기 작업
  overlay_id          TEXT,                                                        -- 충돌한 overlay_id
  install_id          TEXT,                                                        -- 충돌을 낸 새 설치
  target_kind         TEXT    NOT NULL,                                            -- 대상 종류
  target_id           TEXT    NOT NULL,                                            -- 대상 ID
  field               TEXT,                                                        -- 대상 필드(레코드 단위 diff면 NULL)
  base_version        TEXT,                                                        -- 패치 작성 기준
  new_base_version    TEXT,                                                        -- 새 팩의 기준
  current_value_json  TEXT    CHECK (current_value_json IS NULL OR json_valid(current_value_json)),   -- 현재(새 팩) 값
  proposed_value_json TEXT    CHECK (proposed_value_json IS NULL OR json_valid(proposed_value_json)), -- 제안(오버레이·가져오기) 값
  status              TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','superseded')), -- 처리 상태
  created_at          INTEGER NOT NULL,                                            -- 생성 시각
  resolved_at         INTEGER,                                                     -- 처리 시각
  ext                 TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),       -- 확장
  ext_v               INTEGER NOT NULL DEFAULT 1                                   -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_aq_staging_diff_open ON aq_staging_diff(status, created_at);

-- @table Encounter Inbox(업무 중 캡처). 저장 전 마스킹, 외부 전송 0. FR-IMP-013·014, DR-020(inbox.source_kind)
CREATE TABLE aq_inbox_item(
  inbox_id               TEXT    NOT NULL PRIMARY KEY CHECK (length(inbox_id) = 26), -- ULID(inbox-queue 파일명과 같음 → 흡수 멱등)
  source_kind            TEXT    NOT NULL CHECK (source_kind IN ('capture','palette','cli_queue','repo','ai_log','jit')), -- DR-020 이름 훅(repo·ai_log·jit은 v1.x 예약)
  text_masked            TEXT    NOT NULL,                                          -- 마스킹된 본문
  masking                TEXT    NOT NULL CHECK (masking IN ('full','partial')),    -- partial이면 rescan 대상
  captured_at            INTEGER NOT NULL,                                          -- 캡처 시각(CLI·브라우저 시계)
  received_at            INTEGER NOT NULL,                                          -- content 기록 시각
  status                 TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','linked','imported','discarded')), -- 트리아지 상태(= IF-01 InboxItemView.state). 내부 세부 단계 matched·probing은 ext."inbox.sub_state"(CR-38)
  match_candidates_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(match_candidates_json)), -- FTS 상위 10(concept_id, score)
  matched_concept_id     TEXT,                                                      -- 확정 개념
  candidate_id           TEXT,                                                      -- 후보 큐로 보낸 경우
  triaged_at             INTEGER,                                                   -- 트리아지 시각
  ext                    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),     -- 확장
  ext_v                  INTEGER NOT NULL DEFAULT 1                                 -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_aq_inbox_item_status ON aq_inbox_item(status, received_at);

-- @table 가져오기 후보 큐(디깅 발견·백지노트 확장·Inbox 미매칭·Tier C 유도). dedupe_key로 병합. FR-IMP-012
CREATE TABLE aq_candidate(
  candidate_id  TEXT    NOT NULL PRIMARY KEY CHECK (length(candidate_id) = 26),    -- ULID
  origin        TEXT    NOT NULL CHECK (origin IN ('digging','blank_note','inbox_unmatched','tier_c','critique')), -- 발생 경로
  label         TEXT    NOT NULL,                                                  -- 후보 이름
  dedupe_key    TEXT    NOT NULL UNIQUE,                                           -- lower(NFC(label)) 정규화 키
  context_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(context_json)),    -- 발생 맥락(개념·세션 참조)
  occurrences   INTEGER NOT NULL DEFAULT 1,                                        -- 중복 병합 횟수
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','imported','deferred','ignored')), -- 트리아지 결과
  created_at    INTEGER NOT NULL,                                                  -- 생성 시각
  updated_at    INTEGER NOT NULL,                                                  -- 갱신 시각
  ext           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),             -- 확장
  ext_v         INTEGER NOT NULL DEFAULT 1                                         -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_aq_candidate_status ON aq_candidate(status, updated_at);
