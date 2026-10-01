-- @fathom:module=runner version=1 kind=additive
-- services/content/migrations/runner/0001_runner_core.sql

-- @table 러너 실행 기록(실행 1회 = 1행, 30일 보존). 코드 원문은 저장하지 않음(답안은 gr_attempt). FR-LAB-013, ADR-007
CREATE TABLE rn_run(
  run_id       TEXT    NOT NULL PRIMARY KEY CHECK (length(run_id) = 26),           -- ULID
  purpose      TEXT    NOT NULL CHECK (purpose IN ('grade','try_run','t1_answer','complexity')), -- 실행 목적
  attempt_id   TEXT,                                                               -- 채점 실행의 응답
  item_id      TEXT,                                                               -- 문항
  lab_id       TEXT,                                                               -- 과제
  source_kind  TEXT    NOT NULL CHECK (source_kind IN ('learner','seed','t1')),    -- 출처 정책 통과 출처(그 외 403, 행 미기록)
  language     TEXT    NOT NULL CHECK (language IN ('js','ts','sql')),             -- 실행 언어
  code_sha256  TEXT    NOT NULL CHECK (length(code_sha256) = 64),                  -- 실행 코드 sha256
  exit_reason  TEXT    NOT NULL CHECK (exit_reason IN ('ok','test_fail','timeout','rss','output','crash','denied','tokenizer_reject','platform_disabled')), -- 종료 사유
  tests_passed INTEGER CHECK (tests_passed IS NULL OR tests_passed >= 0),          -- 통과 테스트 수(부모 판정)
  tests_total  INTEGER CHECK (tests_total IS NULL OR tests_total >= 0),            -- 전체 테스트 수
  duration_ms  INTEGER NOT NULL CHECK (duration_ms >= 0),                          -- 벽시계 소요
  peak_rss_mb  INTEGER,                                                            -- 감시자 관측 최대 RSS
  complexity_json TEXT  CHECK (complexity_json IS NULL OR json_valid(complexity_json)), -- 복잡도 계측(기울기·n 집합)
  stdout_head  TEXT    NOT NULL DEFAULT '' CHECK (length(CAST(stdout_head AS BLOB)) <= 2048), -- stdout 요약(≤ 2KB, 경로 치환 후)
  stderr_head  TEXT    NOT NULL DEFAULT '' CHECK (length(CAST(stderr_head AS BLOB)) <= 2048), -- stderr 요약(≤ 2KB)
  platform     TEXT    NOT NULL,                                                   -- '<os>-<arch>-node<ver>'
  created_at   INTEGER NOT NULL                                                    -- 실행 시각
) STRICT;
CREATE INDEX ix_rn_run_created ON rn_run(created_at);
CREATE INDEX ix_rn_run_attempt ON rn_run(attempt_id) WHERE attempt_id IS NOT NULL;
