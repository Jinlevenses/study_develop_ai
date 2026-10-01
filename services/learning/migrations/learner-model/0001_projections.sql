-- @fathom:module=learner-model version=1 kind=additive
-- services/learning/migrations/learner-model/0001_projections.sql
-- 인라인 투영(원장 append와 같은 tx). 전부 원장 + 이벤트가 참조하는 정책 세트로 재구성 가능(파생).
-- 정본 상태 = state_json(정준 JSON: 정렬 키·최단 왕복 숫자). 인덱스용 열은 state_json의 STORED 생성 열.
-- merge·rebuild job은 같은 DDL로 <name>__shadow를 만들어 전체 리플레이 후 1 tx로 교체한다(§8.4). 이 테이블에는 뷰·트리거를 두지 않는다.
-- LDI 전용 항·스냅샷 테이블은 두지 않는다(표시 시 전체 재계산, SP-3 감사).

-- @table FSRS 카드 투영(개념 × facet × response_mode). DR-011, DR-020(card.response_mode)
CREATE TABLE lr_card_state(
  card_id       TEXT    NOT NULL PRIMARY KEY,                                 -- '<concept_id>:<facet>:r|p'(결정적, IF-01 CardId, CR-35)
  concept_id    TEXT    NOT NULL,                                             -- 개념(별칭 해석 후 정본 ID)
  facet         TEXT    NOT NULL,                                             -- facet
  response_mode TEXT    NOT NULL CHECK (response_mode IN ('recognition','production')), -- DR-020 이름 훅
  tier          TEXT    NOT NULL CHECK (tier IN ('A','B','C')),               -- 보존율 계층 결정 입력(card.enrolled payload)
  status        TEXT    NOT NULL CHECK (status IN ('active','suspended','retired')), -- card.status_changed 투영
  last_ts       INTEGER NOT NULL,                                             -- 마지막 적용 이벤트 client_ts(fast path 엄격 비교)
  state_json    TEXT    NOT NULL CHECK (json_valid(state_json)),              -- {due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, last_fsrs_at, leech}
  due_at        INTEGER GENERATED ALWAYS AS (json_extract(state_json, '$.due')) STORED, -- 다음 due(epoch ms)
  lapses        INTEGER GENERATED ALWAYS AS (json_extract(state_json, '$.lapses')) STORED -- leech 판정(FR-PRG-030)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_lr_card_state_due     ON lr_card_state(status, due_at);
CREATE INDEX ix_lr_card_state_concept ON lr_card_state(concept_id);

-- @table 개념 투영: Elo θ/θ_q·수축 θ̃ 입력·숙달·4중 역량. DR-012
CREATE TABLE lr_concept_state(
  concept_id  TEXT    NOT NULL PRIMARY KEY,                                   -- 개념
  track_id    TEXT    NOT NULL,                                               -- 트랙(curriculum_ref, 첫 적용 시 고정 → 이벤트 payload)
  last_ts     INTEGER NOT NULL,                                               -- 마지막 적용 이벤트 client_ts
  state_json  TEXT    NOT NULL CHECK (json_valid(state_json)),                -- {theta, theta_q, n, n_graded, credited_formats{}, study_days[], mastery{p, mastered, provisional}, competency{retained, deepened, transferred, taught}, d_max, solo_max, case_best, teach_best, conf{…}}
  n_graded    INTEGER GENERATED ALWAYS AS (json_extract(state_json, '$.n_graded')) STORED,        -- 채점 이벤트 수(θ 표시 임계 30)
  mastered    INTEGER GENERATED ALWAYS AS (json_extract(state_json, '$.mastery.mastered')) STORED -- 0/1
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_lr_concept_state_track ON lr_concept_state(track_id, mastered);

-- @table Concept Lifecycle CL-0~CL-8·CL-X(강등 없음, rusty 표시). FR-PRG-011
CREATE TABLE lr_lifecycle(
  concept_id TEXT    NOT NULL PRIMARY KEY,                                    -- 개념
  last_ts    INTEGER NOT NULL,                                                -- 마지막 적용 이벤트 client_ts
  state_json TEXT    NOT NULL CHECK (json_valid(state_json)),                 -- {state, entered_ts, rusty, nba[], history_tail[]}
  state      TEXT    GENERATED ALWAYS AS (json_extract(state_json, '$.state')) STORED -- 'CL-0'…'CL-8' | 'CL-X'
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_lr_lifecycle_state ON lr_lifecycle(state);

-- @table 트랙 레벨(끈적한 사실: level.promoted 이후 강등 없음). provisional·needs_reconfirmation 배지
CREATE TABLE lr_track_level(
  track_id   TEXT    NOT NULL PRIMARY KEY,                                    -- 트랙
  last_ts    INTEGER NOT NULL,                                                -- 마지막 적용 이벤트 client_ts
  state_json TEXT    NOT NULL CHECK (json_valid(state_json)),                 -- {level, provisional, needs_reconfirmation, promoted_event_id, profile{policy_version, ai_mode, sp1_state}, last_exam{…}, retry_after_day}
  level      INTEGER GENERATED ALWAYS AS (json_extract(state_json, '$.level')) STORED -- 현재 레벨 0~5
) STRICT, WITHOUT ROWID;

-- @table 오개념 소거 원장 투영(active → suppressed → extinguished). FR-PRG-016
CREATE TABLE lr_mc_state(
  mc_id      TEXT    NOT NULL PRIMARY KEY,                                    -- 오개념
  concept_id TEXT    NOT NULL,                                                -- 개념
  last_ts    INTEGER NOT NULL,                                                -- 마지막 적용 이벤트 client_ts
  state_json TEXT    NOT NULL CHECK (json_valid(state_json)),                 -- {state, rejections, format_groups[], last_seen_ts, retry_due_ts}
  state      TEXT    GENERATED ALWAYS AS (json_extract(state_json, '$.state')) STORED -- 'active'|'suppressed'|'extinguished'
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_lr_mc_state_concept ON lr_mc_state(concept_id, state);

-- @table 현재 설정(profile.setting_changed 투영 — (client_ts, device_id) 최신 우선). 리플레이는 이 표를 읽지 않음(이벤트 내장 값만). DR-024
CREATE TABLE lr_setting(
  key             TEXT    NOT NULL PRIMARY KEY,                               -- 'day_boundary'|'retention.core'|'daily_cap.reviews'|'weekly_goal_days'|…(contracts SettingKey)
  value_json      TEXT    NOT NULL CHECK (json_valid(value_json)),            -- 현재 값
  last_ts         INTEGER NOT NULL,                                           -- 반영 이벤트 client_ts
  source_event_id TEXT    NOT NULL                                            -- 반영 원장 event_id
) STRICT, WITHOUT ROWID;

-- @table 투영 메타. projection_hash = 정준 투영 해시(§8.3), fsrs_impl 기록. 체크포인트·epoch 매니페스트 원천
CREATE TABLE lr_projection_meta(
  name            TEXT    NOT NULL PRIMARY KEY CHECK (name IN ('live')),      -- 투영 이름(v1: 'live' 1행)
  projection_hash TEXT    NOT NULL CHECK (length(projection_hash) = 64),      -- 정준 투영 해시
  fsrs_impl       TEXT    NOT NULL,                                           -- 'ts-fsrs@5.4.2'
  policy_version  TEXT    NOT NULL,                                           -- 마지막 policy.switched의 정책 세트 주소
  event_count     INTEGER NOT NULL,                                           -- 반영 이벤트 수
  last_order_json TEXT    NOT NULL CHECK (json_valid(last_order_json)),       -- 마지막 총순서 키 [client_ts, device_id, device_seq]
  computed_at     INTEGER NOT NULL,                                           -- 계산 시각
  ext             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),      -- 확장(LDI 정책 전환 대비 훅, SP-3 감사)
  ext_v           INTEGER NOT NULL DEFAULT 1                                  -- ext 스키마 버전
) STRICT;

-- @table 부하 예측 로그(예측 대비 실측 → 띠 폭 보정, 창 ≥ 8개 전에는 ±15%). 리플레이 투영 아님(해시 제외). FR-PRG-018, CR-05
CREATE TABLE lr_forecast_log(
  window_id       TEXT    NOT NULL PRIMARY KEY CHECK (length(window_id) = 26), -- ULID
  made_at         INTEGER NOT NULL,                                           -- 예측 시각
  made_study_day  TEXT    NOT NULL CHECK (length(made_study_day) = 10),       -- 예측 시작 학습일
  horizon_days    INTEGER NOT NULL CHECK (horizon_days BETWEEN 1 AND 60),     -- 예측 지평(기본 30)
  model           TEXT    NOT NULL CHECK (model IN ('fsrs','observed')),      -- 예측 모델(V-field까지 잠정)
  predicted_low   REAL    NOT NULL,                                           -- 띠 하한(거버너 비교값)
  predicted_total REAL    NOT NULL,                                           -- 점 예측(분 또는 리뷰 수)
  predicted_high  REAL    NOT NULL,                                           -- 띠 상한
  unit            TEXT    NOT NULL CHECK (unit IN ('minutes','reviews')),     -- 단위
  actual_total    REAL,                                                       -- 지평 종료 후 실측(NULL = 미종료)
  closed_at       INTEGER,                                                    -- 실측 확정 시각
  policy_version  TEXT    NOT NULL                                            -- 예측 시 정책 세트
) STRICT;
CREATE INDEX ix_lr_forecast_log_open ON lr_forecast_log(made_at) WHERE actual_total IS NULL;
