-- @fathom:module=cache version=1 kind=additive
-- services/ai-gateway/migrations-cache/0001_cache.sql
-- ai-cache.db = 재생성 가능(백업 제외). TTL 판단 30일·생성 7일·상한 90일(CR-15). 파일 삭제 = 전체 무효화(안전).

-- @table AI 결과 캐시. 키 = sha256(task, prompt_version, provider, model, 정준 입력, schema_hash). FR-AI-009
CREATE TABLE ac_entry(
  cache_key      TEXT    NOT NULL PRIMARY KEY CHECK (length(cache_key) = 64), -- sha256 hex
  task_id        TEXT    NOT NULL,                                            -- 과업
  kind           TEXT    NOT NULL CHECK (kind IN ('judge','generate')),       -- 종류(TTL 30일 | 7일)
  prompt_version TEXT    NOT NULL,                                            -- 프롬프트 버전
  provider_id    TEXT    NOT NULL,                                            -- 제공자
  model          TEXT    NOT NULL,                                            -- 모델
  schema_hash    TEXT    NOT NULL,                                            -- 출력 스키마 해시
  value_json     TEXT    NOT NULL CHECK (json_valid(value_json)),             -- 결과(zod strict 통과본)
  judge_log_id   TEXT,                                                        -- 원 판정 로그(judge 캐시)
  created_at     INTEGER NOT NULL,                                            -- 생성 시각
  expires_at     INTEGER NOT NULL,                                            -- min(created_at + TTL, created_at + 90일)
  hit_count      INTEGER NOT NULL DEFAULT 0,                                  -- 적중 수
  last_hit_at    INTEGER                                                      -- 마지막 적중
) STRICT;
CREATE INDEX ix_ac_entry_expires ON ac_entry(expires_at);
