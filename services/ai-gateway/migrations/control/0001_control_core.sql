-- @fathom:module=control version=1 kind=additive
-- services/ai-gateway/migrations/control/0001_control_core.sql
-- 제공자·동의·probe·모드. ai.db에는 키 문자열 0(키는 OS 키체인·secrets/ai-keys.enc·env, 메모리만). DR-018

-- @table 제공자 등록(API·CLI·Ollama·Jev·범용 CLI). 비밀 값·키 일부(last4)도 저장하지 않음. FR-AI-001·022·024, FR-SET-008
CREATE TABLE ai_provider(
  provider_id   TEXT    NOT NULL PRIMARY KEY CHECK (provider_id GLOB 'gcli-*' OR provider_id IN ('jev','anthropic-api','openai-api','gemini-api','ollama','claude-cli','codex-cli','gemini-cli')), -- IF-01 ProviderId(범용 CLI = 'gcli-<slug>', CR-39)
  kind          TEXT    NOT NULL CHECK (kind IN ('jev','anthropic_api','openai_api','gemini_api','ollama','claude_cli','codex_cli','gemini_cli','generic_cli')), -- 어댑터 종류
  display_name  TEXT    NOT NULL,                                              -- 표시 이름
  billing       TEXT    NOT NULL CHECK (billing IN ('metered','subscription','free','local')), -- 과금 모드(= IF-01 billing_mode, 저장 매핑 없음, FR-AI-022, CR-39)
  trust         TEXT    NOT NULL CHECK (trust IN ('verified','unverified')),   -- canary 통과 여부(unverified → C0만, 수동 토글 불가)
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),           -- 사용자 활성화
  secret_source TEXT    NOT NULL CHECK (secret_source IN ('none','keychain','enc_file','env')), -- 키 저장 위치(값 아님)
  config_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)), -- 어댑터 설정(범용 CLI: bin·args 템플릿·extract·probe·isolation) — 비밀 금지
  created_at    INTEGER NOT NULL,                                              -- 등록 시각
  updated_at    INTEGER NOT NULL,                                              -- 갱신 시각
  ext           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장
  ext_v         INTEGER NOT NULL DEFAULT 1                                     -- ext 스키마 버전
) STRICT;

-- @table 동의 기록(append-only, 최신 행이 유효). 첫 기동 = 0행 = OFFLINE. FR-AI-003
CREATE TABLE ai_consent(
  consent_id     TEXT    NOT NULL PRIMARY KEY CHECK (length(consent_id) = 26), -- ULID
  provider_id    TEXT    NOT NULL REFERENCES ai_provider(provider_id),         -- 제공자
  scope          TEXT    NOT NULL CHECK (scope IN ('judge','generate','batch')), -- 동의 범위(= ConsentBody.scopes 1개당 1행, CR-39)
  granted        INTEGER NOT NULL CHECK (granted IN (0,1)),                    -- 1 = 동의, 0 = 철회
  data_class_max TEXT    NOT NULL CHECK (data_class_max IN ('C0','C1','C2')),  -- 송출 허용 최대 등급(C3는 외부 불가)
  decided_at     INTEGER NOT NULL                                              -- 결정 시각
) STRICT;
CREATE INDEX ix_ai_consent_provider ON ai_consent(provider_id, decided_at);
CREATE TRIGGER ai_consent_no_update BEFORE UPDATE ON ai_consent BEGIN SELECT RAISE(ABORT, 'ai_consent is append-only'); END;
CREATE TRIGGER ai_consent_no_delete BEFORE DELETE ON ai_consent BEGIN SELECT RAISE(ABORT, 'ai_consent is append-only'); END;

-- @table 최신 probe·canary 결과(제공자별 1행). FR-AI-001·015
CREATE TABLE ai_probe(
  provider_id   TEXT    NOT NULL PRIMARY KEY REFERENCES ai_provider(provider_id), -- 제공자
  status        TEXT    NOT NULL CHECK (status IN ('ok','degraded','down','unconsented','disabled')), -- 상태(ai.provider.status_changed와 동일 enum)
  version       TEXT,                                                          -- CLI·SDK 버전 문자열
  flags_ok      INTEGER NOT NULL DEFAULT 0 CHECK (flags_ok IN (0,1)),          -- 필수 격리 플래그 확인
  canary_ok     INTEGER CHECK (canary_ok IS NULL OR canary_ok IN (0,1)),       -- 오늘 canary 결과
  reason_code   TEXT,                                                          -- 사유 코드
  probed_at     INTEGER NOT NULL,                                              -- probe 시각
  canary_day    TEXT                                                           -- canary 실행 학습일(매일 첫 기동)
) STRICT;

-- @table 현재 AI 모드(1행). 첫 기동 = OFFLINE. FR-AI-002
CREATE TABLE ai_mode_state(
  id            INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),                   -- 단일 행
  mode          TEXT    NOT NULL CHECK (mode IN ('FULL','JUDGE_ONLY','LLM_ONLY','OFFLINE')), -- 현재 모드
  reasons_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json)), -- 산정 사유
  changed_at    INTEGER NOT NULL                                               -- 마지막 변경
) STRICT;

-- @table 모드 변경 이력(append-only). ai.mode.changed와 같은 tx
CREATE TABLE ai_mode_history(
  change_id     TEXT    NOT NULL PRIMARY KEY CHECK (length(change_id) = 26),   -- ULID(= outbox correlation)
  mode          TEXT    NOT NULL CHECK (mode IN ('FULL','JUDGE_ONLY','LLM_ONLY','OFFLINE')), -- 새 모드
  previous_mode TEXT    NOT NULL CHECK (previous_mode IN ('FULL','JUDGE_ONLY','LLM_ONLY','OFFLINE')), -- 이전 모드
  reasons_json  TEXT    NOT NULL CHECK (json_valid(reasons_json)),             -- 사유
  changed_at    INTEGER NOT NULL                                               -- 변경 시각
) STRICT;
CREATE TRIGGER ai_mode_history_no_update BEFORE UPDATE ON ai_mode_history BEGIN SELECT RAISE(ABORT, 'ai_mode_history is append-only'); END;
CREATE TRIGGER ai_mode_history_no_delete BEFORE DELETE ON ai_mode_history BEGIN SELECT RAISE(ABORT, 'ai_mode_history is append-only'); END;

-- @table 관측된 모델 버전(드리프트 탐지 → ai.judge.drift_detected). D-14
CREATE TABLE ai_model_seen(
  provider_id   TEXT    NOT NULL,                                              -- 제공자
  task_id       TEXT    NOT NULL,                                              -- 과업
  model_version TEXT    NOT NULL,                                              -- 응답 model_version
  first_seen_at INTEGER NOT NULL,                                              -- 최초 관측
  last_seen_at  INTEGER NOT NULL,                                              -- 최근 관측
  PRIMARY KEY (provider_id, task_id, model_version)
) STRICT, WITHOUT ROWID;

-- @table AI 사용자 설정(예산 재정의·과업별 선호 제공자·로컬 강제·캐시 고지 확인). 정책 기본값은 ai_policy@v1 파일
CREATE TABLE ai_setting(
  key        TEXT    NOT NULL PRIMARY KEY,                                     -- 'budget.monthly_krw'|'task.<id>.prefer'|'task.<id>.local_only'|…
  value_json TEXT    NOT NULL CHECK (json_valid(value_json)),                  -- 값
  updated_at INTEGER NOT NULL                                                  -- 갱신 시각
) STRICT, WITHOUT ROWID;
