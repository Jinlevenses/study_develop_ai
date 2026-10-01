-- @fathom:module=judge version=1 kind=additive
-- services/ai-gateway/migrations/judge/0001_judge_core.sql
-- 판정 원자료(append-only, NFR-DATA-005)·골드셋·캘리브레이션. DR-017, DR-020(judge_log.probabilities·input_hash·model_version)

-- @table 판정 로그(Jev·LLM-judge 원자료, append-only, 영구). 항목은 객체 키로만. K05 증류·K03 재보정 대비
CREATE TABLE ai_judge_log(
  judge_log_id   TEXT    NOT NULL PRIMARY KEY CHECK (length(judge_log_id) = 26), -- ULID(Verdict.judge_log_ref)
  task_id        TEXT    NOT NULL,                                             -- 'AI-J03'…
  engine         TEXT    NOT NULL CHECK (engine IN ('J','LJ')),                -- 판정 엔진
  provider_id    TEXT    NOT NULL,                                             -- 제공자
  model_version  TEXT    NOT NULL,                                             -- DR-020 이름 훅. 응답 model_version
  input_hash     TEXT    NOT NULL CHECK (length(input_hash) = 64),             -- DR-020 이름 훅. sha256(task, prompt_version, 정준 입력)
  questions      TEXT    NOT NULL CHECK (json_valid(questions)),               -- 질문(객체 키 맵, 배열 금지)
  probabilities  TEXT    NOT NULL CHECK (json_valid(probabilities)),           -- DR-020 이름 훅. 객체 키 → 확률 분포
  confidence     REAL,                                                         -- 판정 confidence
  calibrated     INTEGER NOT NULL CHECK (calibrated IN (0,1)),                 -- 판정 시점 보정 여부
  latency_ms     INTEGER NOT NULL,                                             -- 지연
  cost_krw_milli INTEGER NOT NULL DEFAULT 0,                                   -- 비용(밀리원)
  prompt_version TEXT    NOT NULL,                                             -- 프롬프트 버전
  call_id        TEXT,                                                         -- ai_call_log.call_id(캐시 적중이면 원 호출)
  created_at     INTEGER NOT NULL                                              -- 판정 시각
) STRICT;
CREATE INDEX ix_ai_judge_log_task  ON ai_judge_log(task_id, created_at);
CREATE INDEX ix_ai_judge_log_input ON ai_judge_log(input_hash);
CREATE TRIGGER ai_judge_log_no_update BEFORE UPDATE ON ai_judge_log BEGIN SELECT RAISE(ABORT, 'ai_judge_log is append-only'); END;
CREATE TRIGGER ai_judge_log_no_delete BEFORE DELETE ON ai_judge_log BEGIN SELECT RAISE(ABORT, 'ai_judge_log is append-only'); END;

-- @table 개인 골드셋(model_labeled_draft 출하 → 사용자 확정, 인용된 이의). FR-AI-013·027
CREATE TABLE ai_gold_item(
  gold_id       TEXT    NOT NULL PRIMARY KEY,                                  -- IF-01 GoldId: 시드 'gold.AI-J03.017' · 런타임 ULID
  task_id       TEXT    NOT NULL,                                              -- 과업
  source        TEXT    NOT NULL CHECK (source IN ('model_labeled_draft','appeal','confirm_card','user')), -- 출처
  input_json    TEXT    NOT NULL CHECK (json_valid(input_json)),               -- 판정 입력(합성·익명 위주)
  label_json    TEXT    NOT NULL CHECK (json_valid(label_json)),               -- 라벨(객체 키)
  status        TEXT    NOT NULL CHECK (status IN ('model_labeled_draft','user_confirmed','user_corrected','skipped')), -- 확정 상태(= GoldItemView.state, 확정·교정 ≥ 20 → calibrated 후보, CR-39)
  cross_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (cross_reviewed IN (0,1)),   -- 타 계열 교차 리뷰
  created_at    INTEGER NOT NULL,                                              -- 생성 시각
  decided_at    INTEGER,                                                       -- 사용자 확정 시각(export since 기준)
  ext           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장
  ext_v         INTEGER NOT NULL DEFAULT 1                                     -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_ai_gold_item_task    ON ai_gold_item(task_id, status);
CREATE INDEX ix_ai_gold_item_decided ON ai_gold_item(decided_at) WHERE decided_at IS NOT NULL;

-- @table 캘리브레이션 실행 기록(append-only). SP-1 지표. FR-AI-014
CREATE TABLE ai_calibration_run(
  run_id        TEXT    NOT NULL PRIMARY KEY CHECK (length(run_id) = 26),      -- ULID
  task_id       TEXT    NOT NULL,                                              -- 과업
  provider_id   TEXT    NOT NULL,                                              -- 제공자
  model_version TEXT    NOT NULL,                                              -- 평가 모델 버전
  prompt_version TEXT   NOT NULL DEFAULT '1.0.0',                              -- 템플릿(프롬프트) 버전(D-AI-16, CR-39)
  gold_count    INTEGER NOT NULL,                                              -- 사용 골드 수
  metrics_json  TEXT    NOT NULL CHECK (json_valid(metrics_json)),             -- idea unit 정확도·정밀도·κ·패러프레이즈·장황함 편향
  passed        INTEGER NOT NULL CHECK (passed IN (0,1)),                      -- SP-1 통과
  created_at    INTEGER NOT NULL                                               -- 실행 시각
) STRICT;
CREATE TRIGGER ai_calibration_run_no_update BEFORE UPDATE ON ai_calibration_run BEGIN SELECT RAISE(ABORT, 'ai_calibration_run is append-only'); END;
CREATE TRIGGER ai_calibration_run_no_delete BEFORE DELETE ON ai_calibration_run BEGIN SELECT RAISE(ABORT, 'ai_calibration_run is append-only'); END;

-- @table 과업별 현재 보정 상태(w_grader 0.9/0.7 결정). 드리프트 시 calibrated = 0
CREATE TABLE ai_task_calibration(
  task_id       TEXT    NOT NULL,                                              -- 과업
  provider_id   TEXT    NOT NULL,                                              -- 제공자
  prompt_version TEXT   NOT NULL DEFAULT '1.0.0',                              -- 템플릿(프롬프트) 버전(D-AI-16, CR-39)
  model_version TEXT    NOT NULL,                                              -- 보정 시 모델 버전
  calibrated    INTEGER NOT NULL CHECK (calibrated IN (0,1)),                  -- 현재 보정 여부
  run_id        TEXT,                                                          -- 근거 실행
  updated_at    INTEGER NOT NULL,                                              -- 갱신 시각
  PRIMARY KEY (task_id, provider_id, prompt_version)
) STRICT, WITHOUT ROWID;
