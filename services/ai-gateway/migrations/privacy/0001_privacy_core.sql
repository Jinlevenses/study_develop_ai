-- @fathom:module=privacy version=1 kind=additive
-- services/ai-gateway/migrations/privacy/0001_privacy_core.sql
-- Privacy Firewall(로컬 판정 전용). 판정 로그에 매칭 원문 0(규칙 ID·개수만). ADR-016

-- @table Firewall 판정 로그(append-only, 영구). 외부 호출마다 decision_id 존재(우회 0 증명). FR-AI-019
CREATE TABLE ai_firewall_log(
  decision_id  TEXT    NOT NULL PRIMARY KEY CHECK (length(decision_id) = 26),  -- ULID(FirewalledPayload.decision_id)
  task_id      TEXT    NOT NULL,                                               -- 과업
  provider_id  TEXT    NOT NULL,                                               -- 라우팅 후보 제공자
  route        TEXT    NOT NULL CHECK (route IN ('external','local_only')),    -- 경로
  data_class   TEXT    NOT NULL CHECK (data_class IN ('C0','C1','C2','C3')),   -- 판정 등급
  action       TEXT    NOT NULL CHECK (action IN ('pass','masked','force_local','block')), -- 조치
  rule_hits_json TEXT  NOT NULL DEFAULT '[]' CHECK (json_valid(rule_hits_json)), -- 적중 규칙 ID 목록(원문 금지)
  mask_count   INTEGER NOT NULL DEFAULT 0,                                     -- 마스킹 토큰 수
  exception_id TEXT,                                                           -- 일회 허용 사용 시
  created_at   INTEGER NOT NULL                                                -- 판정 시각
) STRICT;
CREATE INDEX ix_ai_firewall_log_created ON ai_firewall_log(created_at);
CREATE TRIGGER ai_firewall_log_no_update BEFORE UPDATE ON ai_firewall_log BEGIN SELECT RAISE(ABORT, 'ai_firewall_log is append-only'); END;
CREATE TRIGGER ai_firewall_log_no_delete BEFORE DELETE ON ai_firewall_log BEGIN SELECT RAISE(ABORT, 'ai_firewall_log is append-only'); END;

-- @table 사용자 사내 패턴(도메인·사번·프로젝트 코드). content ingress가 GET /firewall/patterns로 읽음
CREATE TABLE ai_firewall_pattern(
  pattern_id TEXT    NOT NULL PRIMARY KEY CHECK (length(pattern_id) = 26),     -- ULID
  kind       TEXT    NOT NULL CHECK (kind IN ('domain','employee_id','project_code','regex','literal')), -- 패턴 종류
  pattern    TEXT    NOT NULL,                                                 -- 패턴(정규식은 RE2 호환 부분집합 검증)
  data_class TEXT    NOT NULL DEFAULT 'C3' CHECK (data_class IN ('C2','C3')),  -- 적중 시 등급
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),              -- 활성
  created_at INTEGER NOT NULL,                                                 -- 생성 시각
  updated_at INTEGER NOT NULL,                                                 -- 갱신 시각
  ext        TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),            -- 확장
  ext_v      INTEGER NOT NULL DEFAULT 1                                        -- ext 스키마 버전
) STRICT;

-- @table 과업 단위 일회 허용(과잉 마스킹 예외, 사용 시 로그). ADR-016 결과
CREATE TABLE ai_firewall_exception(
  exception_id TEXT    NOT NULL PRIMARY KEY CHECK (length(exception_id) = 26), -- ULID
  task_id      TEXT    NOT NULL,                                               -- 과업
  scope_ref    TEXT    NOT NULL,                                               -- 대상(요청 input_hash)
  rule_ids_json TEXT   NOT NULL CHECK (json_valid(rule_ids_json)),             -- 예외 규칙 ID(C3 규칙은 불가)
  granted_at   INTEGER NOT NULL,                                               -- 허용 시각
  expires_at   INTEGER NOT NULL,                                               -- 만료(기본 +10분)
  consumed_at  INTEGER                                                         -- 사용 시각(1회)
) STRICT;
