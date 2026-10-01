-- @fathom:module=routing version=1 kind=additive
-- services/ai-gateway/migrations/routing/0001_routing_core.sql
-- background 레인 영속 큐·작업 주문(단일 PEP)·예산·쿼터·호출 로그. interactive 레인은 메모리 큐(영속 0).

-- @table 작업 주문(대량 AI 작업 미리보기·승인). v1 lite = 추정 + 승인 플래그. FR-AI-026
CREATE TABLE ai_work_order(
  work_order_id TEXT    NOT NULL PRIMARY KEY CHECK (length(work_order_id) = 26), -- ULID
  purpose       TEXT    NOT NULL CHECK (purpose IN ('import','generation','regate','tier_promotion','pack_refresh','calibration','canary','warming','appeal_regrade','pending_regrade')), -- IF-01 WorkOrderPurpose(CR-39)
  requested_by  TEXT    NOT NULL CHECK (requested_by IN ('content','user','system')), -- 요청 주체(= CreateWorkOrderBody.requested_by)
  caller_svc    TEXT    NOT NULL CHECK (caller_svc IN ('content','gateway','ops-api','ai-gateway')), -- 호출 서비스(토큰 주체)
  tasks_json    TEXT    NOT NULL CHECK (json_valid(tasks_json)),               -- CreateWorkOrderBody.tasks = WorkOrderView.tasks[{task_id, calls}]
  context_ref_json TEXT NOT NULL CHECK (json_valid(context_ref_json)),         -- ContextRef
  estimate_json TEXT    NOT NULL CHECK (json_valid(estimate_json)),            -- {calls, krw, quota_pct, duration_s}
  requires_approval INTEGER NOT NULL CHECK (requires_approval IN (0,1)),       -- 임계 초과(호출 > 50 ∨ ₩ > 1,000 ∨ 창 쿼터 > 20%, 경계값은 미초과)
  status        TEXT    NOT NULL CHECK (status IN ('approval_required','approved','rejected','exhausted','expired','completed')), -- 상태(= WorkOrderView.state)
  cap_json      TEXT    CHECK (cap_json IS NULL OR json_valid(cap_json)),      -- DecideWorkOrderBody.cap
  decided_by    TEXT    CHECK (decided_by IS NULL OR decided_by IN ('auto','user')), -- 결정 주체
  reservation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(reservation_json)), -- 예약(Should 훅: calls·krw·expires_at)
  consumed_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(consumed_json)), -- 소비 실적
  created_at    INTEGER NOT NULL,                                              -- 생성 시각
  decided_at    INTEGER,                                                       -- 결정 시각
  expires_at    INTEGER,                                                       -- 승인 만료
  ext           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장
  ext_v         INTEGER NOT NULL DEFAULT 1                                     -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_ai_work_order_status ON ai_work_order(status, created_at);

-- @table 제공자 클래스별 예약·원자 차감(Should — v1은 스키마 훅만, 행 0). ADR-005 §12
CREATE TABLE ai_reservation(
  reservation_id TEXT    NOT NULL PRIMARY KEY CHECK (length(reservation_id) = 26), -- ULID
  work_order_id  TEXT    NOT NULL REFERENCES ai_work_order(work_order_id),     -- 작업 주문
  provider_class TEXT    NOT NULL,                                             -- 'api'|'subscription:<provider_id>'|'local'
  calls_reserved INTEGER NOT NULL DEFAULT 0,                                   -- 예약 호출 수
  krw_milli_reserved INTEGER NOT NULL DEFAULT 0,                               -- 예약 금액(밀리원)
  calls_used     INTEGER NOT NULL DEFAULT 0,                                   -- 사용 호출 수
  krw_milli_used INTEGER NOT NULL DEFAULT 0,                                   -- 사용 금액(밀리원)
  expires_at     INTEGER NOT NULL                                              -- 만료
) STRICT;

-- @table background 레인 작업(앱 재시작 후 재개, 재시도 3회, 멱등 키). FR-AI-010
CREATE TABLE ai_job(
  job_id          TEXT    NOT NULL PRIMARY KEY CHECK (length(job_id) = 26),    -- ULID
  task_id         TEXT    NOT NULL,                                            -- 'AI-G01'…(contracts TaskId)
  idempotency_key TEXT    NOT NULL UNIQUE,                                     -- 호출자 키(중복 생성 0)
  caller          TEXT    NOT NULL CHECK (caller IN ('content','gateway','ops-api','ai-gateway')), -- 요청 서비스
  work_order_id   TEXT    REFERENCES ai_work_order(work_order_id),             -- 작업 주문(background 필수)
  priority        INTEGER NOT NULL DEFAULT 100,                                -- 낮을수록 먼저
  status          TEXT    NOT NULL CHECK (status IN ('queued','waiting_window','running','done','failed','cancelled','deferred')), -- 상태(= IF-01 JobView.state. 작업 주문 미승인은 JudgeResult.deferred{work_order_pending}로 표현, 상태 아님, CR-39)
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3), -- 시도 수
  next_attempt_at INTEGER NOT NULL DEFAULT 0,                                  -- 다음 시도(지수 백오프)
  input_json      TEXT    NOT NULL CHECK (json_valid(input_json)),             -- 과업 입력(호출 직전 Firewall 통과 — 저장본은 비검사 원본, 로컬 전용)
  data_class      TEXT    NOT NULL CHECK (data_class IN ('C0','C1','C2','C3')), -- 입력 등급
  correlation_id  TEXT    NOT NULL,                                            -- 요청 correlation
  prompt_version  TEXT,                                                        -- 실행 프롬프트 버전
  error_code      TEXT,                                                        -- 실패 코드
  created_at      INTEGER NOT NULL,                                            -- 생성 시각
  started_at      INTEGER,                                                     -- 시작 시각
  finished_at     INTEGER                                                      -- 종료 시각
) STRICT;
CREATE INDEX ix_ai_job_runnable ON ai_job(status, priority, next_attempt_at) WHERE status IN ('queued','waiting_window');
CREATE INDEX ix_ai_job_finished ON ai_job(finished_at) WHERE finished_at IS NOT NULL;

-- @table 작업 결과(ai.job.completed.result_ref로 회수). 회수 후 30일 보존
CREATE TABLE ai_job_result(
  job_id       TEXT    NOT NULL PRIMARY KEY REFERENCES ai_job(job_id) ON DELETE CASCADE, -- 작업
  outcome      TEXT    NOT NULL CHECK (outcome IN ('ok','failed','cancelled','deferred')), -- 결과(이벤트 enum)
  result_json  TEXT    NOT NULL CHECK (json_valid(result_json)),               -- zod strict 통과 결과
  created_at   INTEGER NOT NULL,                                               -- 생성 시각
  collected_at INTEGER                                                         -- 호출자 회수 시각
) STRICT;

-- @table 외부 호출 로그(호출 1건 = 1행, append-only, 영구). 비밀 원문 0. FR-AI-021
CREATE TABLE ai_call_log(
  call_id         TEXT    NOT NULL PRIMARY KEY CHECK (length(call_id) = 26),   -- ULID
  task_id         TEXT    NOT NULL,                                            -- 과업(TaskId ∪ SystemTaskId 'SYS-CANARY'·'SYS-SMOKE'·'SYS-FWCLS', D-AI-10)
  provider_id     TEXT    NOT NULL,                                            -- 제공자
  model           TEXT,                                                        -- 요청 모델
  lane            TEXT    NOT NULL CHECK (lane IN ('interactive','conversational','background')), -- 레인
  job_id          TEXT,                                                        -- background 작업
  work_order_id   TEXT,                                                        -- 작업 주문
  prompt_version  TEXT,                                                        -- 프롬프트 버전(계보·캐시 키)
  route_trace_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(route_trace_json)), -- 후보 탈락 사유 추적
  firewall_decision_id TEXT NOT NULL,                                          -- ai_firewall_log.decision_id(우회 0 증명)
  firewall_action TEXT    NOT NULL CHECK (firewall_action IN ('pass','masked','force_local')), -- 적용 조치(block은 호출 0)
  data_class      TEXT    NOT NULL CHECK (data_class IN ('C0','C1','C2','C3')), -- 송출 등급
  tokens_in       INTEGER,                                                     -- 입력 토큰
  tokens_out      INTEGER,                                                     -- 출력 토큰
  cost_krw_milli  INTEGER NOT NULL DEFAULT 0,                                  -- 비용(밀리원, 구독·로컬 = 0)
  cost_basis      TEXT    NOT NULL CHECK (cost_basis IN ('reported','computed','subscription','free')), -- 과금 근거(= IF-01 CostBasis, 캐시는 cache_hit 열, CR-39)
  cache_hit       INTEGER NOT NULL CHECK (cache_hit IN (0,1)),                 -- 캐시 적중
  latency_ms      INTEGER NOT NULL,                                            -- 지연
  outcome         TEXT    NOT NULL CHECK (outcome IN ('ok','error','timeout','fallback','cache_hit')), -- 결과(= IF-01 CallLogEntry.outcome. 방화벽 차단은 호출 0 → ai_firewall_log에만, 스키마 실패·repair·서킷은 error_code, CR-39)
  error_code      TEXT,                                                        -- 오류 코드
  created_at      INTEGER NOT NULL                                             -- 호출 시각
) STRICT;
CREATE INDEX ix_ai_call_log_created  ON ai_call_log(created_at);
CREATE INDEX ix_ai_call_log_provider ON ai_call_log(provider_id, created_at);
CREATE TRIGGER ai_call_log_no_update BEFORE UPDATE ON ai_call_log BEGIN SELECT RAISE(ABORT, 'ai_call_log is append-only'); END;
CREATE TRIGGER ai_call_log_no_delete BEFORE DELETE ON ai_call_log BEGIN SELECT RAISE(ABORT, 'ai_call_log is append-only'); END;

-- @table 기간별 사용량 카운터(예산 판정 O(1)). ai_call_log와 같은 tx에서 증가. FR-AI-007
CREATE TABLE ai_usage_counter(
  period_key     TEXT    NOT NULL,                                             -- 'YYYY-MM'(월) | 'YYYY-MM-DD'(일)
  provider_id    TEXT    NOT NULL,                                             -- 제공자('*' = 합계)
  billing        TEXT    NOT NULL CHECK (billing IN ('metered','subscription','free','local')), -- 과금 분리 표시(= billing_mode)
  calls          INTEGER NOT NULL DEFAULT 0,                                   -- 호출 수
  tokens_in      INTEGER NOT NULL DEFAULT 0,                                   -- 입력 토큰
  tokens_out     INTEGER NOT NULL DEFAULT 0,                                   -- 출력 토큰
  cost_krw_milli INTEGER NOT NULL DEFAULT 0,                                   -- 비용(밀리원)
  updated_at     INTEGER NOT NULL,                                             -- 갱신 시각
  PRIMARY KEY (period_key, provider_id, billing)
) STRICT, WITHOUT ROWID;

-- @table 구독 CLI 쿼터 창(5시간·주간). FR-AI-025
CREATE TABLE ai_quota_window(
  provider_id  TEXT    NOT NULL,                                               -- 구독 제공자
  window_kind  TEXT    NOT NULL CHECK (window_kind IN ('5h','week')),          -- 창 종류
  window_start INTEGER NOT NULL,                                               -- 창 시작(epoch ms)
  calls        INTEGER NOT NULL DEFAULT 0,                                     -- 호출 수
  est_tokens   INTEGER NOT NULL DEFAULT 0,                                     -- 추정 토큰
  PRIMARY KEY (provider_id, window_kind, window_start)
) STRICT, WITHOUT ROWID;

-- @table 예산 임계 발행 기록(80%·100% 이벤트 중복 방지). ai.budget.threshold_reached
CREATE TABLE ai_budget_alert(
  period_key  TEXT    NOT NULL,                                                -- 기간
  scope       TEXT    NOT NULL CHECK (scope IN ('money','quota')),             -- 범위
  provider_id TEXT    NOT NULL,                                                -- 제공자('*' = 합계)
  ratio       REAL    NOT NULL CHECK (ratio IN (0.8, 1.0)),                    -- 임계
  raised_at   INTEGER NOT NULL,                                                -- 발행 시각
  PRIMARY KEY (period_key, scope, provider_id, ratio)
) STRICT, WITHOUT ROWID;
