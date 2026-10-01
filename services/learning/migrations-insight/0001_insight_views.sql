-- @fathom:module=insight version=1 kind=additive
-- services/learning/migrations-insight/0001_insight_views.sql
-- insight.db = 재구성 가능한 읽기 모델(백업 제외). 원천 = learning.db 원장·투영·curriculum_ref. 언제든 DROP 후 job rebuild로 재생성.
-- LDI 수치는 여기에 캐시하지 않는다(표시 시 전체 재계산). 주간 리포트는 "발행된 리포트" 기록이며 계산 입력이 아니다.

-- @table 투영 커서·버전 메타(key-value). last_event_rowid = 마지막으로 반영한 lr_event.rowid(도착 순서 커서 — 리플레이 순서 아님)
CREATE TABLE iv_meta(
  key        TEXT    NOT NULL PRIMARY KEY,                                     -- 'last_event_rowid'|'source_projection_hash'|'built_at'|'view_version'
  value_json TEXT    NOT NULL CHECK (json_valid(value_json)),                  -- 값
  updated_at INTEGER NOT NULL                                                  -- 갱신 시각
) STRICT, WITHOUT ROWID;

-- @table Home Cockpit 뷰(오늘의 기본 행동·경보 슬롯 입력, 1행)
CREATE TABLE iv_home(
  id         INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),                      -- 단일 행
  view_json  TEXT    NOT NULL CHECK (json_valid(view_json)),                   -- {primary_action, minutes_suggested, alerts[], weekly_goal{…}}
  updated_at INTEGER NOT NULL                                                  -- 갱신 시각
) STRICT;

-- @table Depth Map 셀(개념 노드 상태·레이어). FR-DSH-003·004
CREATE TABLE iv_depth_cell(
  concept_id TEXT    NOT NULL PRIMARY KEY,                                     -- 개념
  track_id   TEXT    NOT NULL,                                                 -- 트랙
  level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),                   -- 레벨 층
  cell_json  TEXT    NOT NULL CHECK (json_valid(cell_json)),                   -- {lifecycle, mastered, retained_ratio, deepened, transferred, taught, provisional, layers{illusion, crack, stale, rusty}}
  updated_at INTEGER NOT NULL                                                  -- 갱신 시각
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_iv_depth_cell_track ON iv_depth_cell(track_id, level);

-- @table 트랙 요약(레벨·cap·진행 바)
CREATE TABLE iv_track_summary(
  track_id     TEXT    NOT NULL PRIMARY KEY,                                   -- 트랙
  summary_json TEXT    NOT NULL CHECK (json_valid(summary_json)),              -- {level, provisional, cap, required{n, mastered}, next_gate{…}}
  updated_at   INTEGER NOT NULL                                                -- 갱신 시각
) STRICT, WITHOUT ROWID;

-- @table 보정 지표 창(Brier·ECE·과신, 응답 ≥ 30일 때만 수치 표시). FR-PRG-023·024
CREATE TABLE iv_calibration(
  scope        TEXT    NOT NULL CHECK (scope IN ('all','track','concept')),    -- 범위
  scope_id     TEXT    NOT NULL,                                               -- 범위 ID('*'|track_id|concept_id)
  window_key   TEXT    NOT NULL CHECK (window_key IN ('7d','28d','all')),      -- 이동 창
  n            INTEGER NOT NULL,                                               -- 확신도 응답 수
  brier        REAL,                                                           -- Brier(n < 30이면 NULL)
  ece          REAL,                                                           -- ECE 10 bins(n < 30이면 NULL)
  overconfidence REAL,                                                         -- 평균 확신 − 정답률
  updated_at   INTEGER NOT NULL,                                               -- 갱신 시각
  PRIMARY KEY (scope, scope_id, window_key)
) STRICT, WITHOUT ROWID;

-- @table 개인 혼동 행렬(X 문항에 Y 답 선택 빈도 → 헷갈림 쌍). FR-STD-015
CREATE TABLE iv_confusion(
  concept_a  TEXT    NOT NULL,                                                 -- 출제 개념
  concept_b  TEXT    NOT NULL,                                                 -- 혼동 개념
  count      INTEGER NOT NULL,                                                 -- 빈도
  last_ts    INTEGER NOT NULL,                                                 -- 마지막 발생
  PRIMARY KEY (concept_a, concept_b)
) STRICT, WITHOUT ROWID;

-- @table 발행된 주간 리뷰 리포트(발행 시점 값의 기록, 계산 캐시 아님). FR-DSH-009
CREATE TABLE iv_weekly_report(
  week_start_day TEXT    NOT NULL PRIMARY KEY CHECK (length(week_start_day) = 10), -- 주 시작 학습일
  report_json    TEXT    NOT NULL CHECK (json_valid(report_json)),             -- ΔLDI·약점 Top 5·모드 편중·WVD·편향 …(발행 시 계산값)
  policy_version TEXT    NOT NULL,                                             -- 계산 정책 세트
  computed_at    INTEGER NOT NULL                                              -- 계산 시각
) STRICT, WITHOUT ROWID;

-- @table 시즌 플래너·회고 뷰(선언은 원장 declaration.sealed). FR-DSH-012
CREATE TABLE iv_season(
  season_id  TEXT    NOT NULL PRIMARY KEY,                                     -- 시즌(= CreateSeasonBody.season_id = declaration_id)
  view_json  TEXT    NOT NULL CHECK (json_valid(view_json)),                   -- 목표·확률·주간 체크·거시 Brier
  updated_at INTEGER NOT NULL                                                  -- 갱신 시각
) STRICT, WITHOUT ROWID;

-- @table Retention Radar 신호 뷰(TW-01~13 학습 신호). FR-DSH-013
CREATE TABLE iv_radar(
  tw_id      TEXT    NOT NULL PRIMARY KEY,                                     -- 'TW-01'…'TW-13'
  view_json  TEXT    NOT NULL CHECK (json_valid(view_json)),                   -- 값·개인 기준선·상태·제안
  updated_at INTEGER NOT NULL                                                  -- 갱신 시각
) STRICT, WITHOUT ROWID;
