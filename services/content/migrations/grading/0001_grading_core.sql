-- @fathom:module=grading version=1 kind=additive
-- services/content/migrations/grading/0001_grading_core.sql
-- 채점 사다리 결과. Verdict는 append-only(상향·재채점 = supersedes 체인). grading은 ct_* 테이블을 읽지 않는다(grading-no-catalog).

-- @table 제출 응답(학습자 답안 원문, C1). 같은 Idempotency-Key(= attempt_id) 재요청은 idem_request로 흡수. FR-QST-022
CREATE TABLE gr_attempt(
  attempt_id         TEXT    NOT NULL PRIMARY KEY CHECK (length(attempt_id) = 26), -- 브라우저 생성 ULID(= Idempotency-Key)
  session_id         TEXT    NOT NULL CHECK (length(session_id) = 26),             -- learning 세션(논리 참조)
  block_id           TEXT    CHECK (block_id IS NULL OR length(block_id) = 26),    -- learning 블록
  item_id            TEXT    NOT NULL,                                             -- 문항
  item_content_hash  TEXT    NOT NULL CHECK (length(item_content_hash) = 64),      -- 채점한 리비전
  response_json      TEXT    NOT NULL CHECK (json_valid(response_json)),           -- 답안(선택 키·텍스트·코드). 로컬 전용
  confidence         INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 3), -- CBM C1~C3
  latency_ms         INTEGER NOT NULL CHECK (latency_ms >= 0),                     -- 응답 시간
  hints_used         INTEGER NOT NULL DEFAULT 0 CHECK (hints_used >= 0),           -- 힌트 단계 수
  reference_mode     INTEGER NOT NULL DEFAULT 0 CHECK (reference_mode IN (0,1)),   -- 참조 모드(증거 제외)
  client_answered_at INTEGER NOT NULL,                                             -- 클라이언트 응답 시각(learning이 fsrs_at 클램프에 사용)
  received_at        INTEGER NOT NULL,                                             -- content 수신 시각
  status             TEXT    NOT NULL CHECK (status IN ('awaiting_self_grade','graded','pending')), -- 현재 상태(awaiting_self_grade = IF-CT-040 ⑤, Verdict 미발급 · IF-CT-041 CT-CONFLICT-010 판정 근거, CR-38)
  current_verdict_id TEXT    CHECK (current_verdict_id IS NULL OR length(current_verdict_id) = 26), -- 최신 Verdict(supersedes 체인 끝)
  ext                TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),        -- 확장(DR-020 ext: attempt.anchor_run_id)
  ext_v              INTEGER NOT NULL DEFAULT 1                                    -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_gr_attempt_session ON gr_attempt(session_id);
CREATE INDEX ix_gr_attempt_item    ON gr_attempt(item_id, received_at);

-- @table 판정(Verdict) — 리플레이 입력 운반체(ADR-011 §4). append-only, verdict_json = 이벤트 payload와 같은 정준 JSON
CREATE TABLE gr_verdict(
  verdict_id            TEXT    NOT NULL PRIMARY KEY CHECK (length(verdict_id) = 26), -- ULID(원장 멱등 키 'verdict:<verdict_id>')
  attempt_id            TEXT    NOT NULL REFERENCES gr_attempt(attempt_id),       -- 응답
  supersedes_verdict_id TEXT    REFERENCES gr_verdict(verdict_id),                -- 대체한 판정(상향·재채점·이의)
  revision_reason       TEXT    CHECK (revision_reason IS NULL OR revision_reason IN ('deadline_upgrade','pending_regrade','appeal')), -- 대체 사유
  item_id               TEXT    NOT NULL,                                          -- 문항
  item_content_hash     TEXT    NOT NULL CHECK (length(item_content_hash) = 64),   -- 리비전
  result                TEXT    NOT NULL CHECK (result IN ('correct','partial','incorrect','pending')), -- 결과
  band                  TEXT    NOT NULL CHECK (band IN ('wrong','partial','right')), -- 점수 밴드(UI diff 기준)
  score                 REAL    NOT NULL CHECK (score BETWEEN 0 AND 1),            -- 점수
  grader_engine         TEXT    NOT NULL CHECK (grader_engine IN ('D','J','LJ','H','S','PENDING')), -- 채점 엔진
  calibrated            INTEGER NOT NULL CHECK (calibrated IN (0,1)),              -- 보정 여부
  pending               INTEGER NOT NULL CHECK (pending IN (0,1)),                 -- 보류
  provisional           INTEGER NOT NULL CHECK (provisional IN (0,1)),             -- 잠정
  w_format              REAL    NOT NULL CHECK (w_format BETWEEN 0 AND 1),         -- 형식 가중(발급 시 고정)
  w_grader              REAL    NOT NULL CHECK (w_grader BETWEEN 0 AND 1),         -- 엔진 가중(발급 시 고정)
  gaming_factor         REAL    NOT NULL CHECK (gaming_factor BETWEEN 0 AND 1),    -- 게이밍 계수
  ai_mode               TEXT    NOT NULL CHECK (ai_mode IN ('FULL','JUDGE_ONLY','LLM_ONLY','OFFLINE')), -- 발급 시 AI 모드
  content_policy_version TEXT   NOT NULL,                                          -- content 정책 세트 주소 'ps_<16hex>'
  judge_log_ref         TEXT,                                                      -- ai_judge_log.judge_log_id(논리 참조)
  prompt_version        TEXT,                                                      -- LJ·L 프롬프트 버전
  verdict_json          TEXT    NOT NULL CHECK (json_valid(verdict_json)),         -- Verdict 전체(정준 JSON, contracts Verdict.strict())
  issued_at             INTEGER NOT NULL                                           -- 발급 시각
) STRICT;
CREATE INDEX ix_gr_verdict_attempt    ON gr_verdict(attempt_id, issued_at);
CREATE INDEX ix_gr_verdict_supersedes ON gr_verdict(supersedes_verdict_id) WHERE supersedes_verdict_id IS NOT NULL;
CREATE TRIGGER gr_verdict_no_update BEFORE UPDATE ON gr_verdict BEGIN SELECT RAISE(ABORT, 'gr_verdict is append-only'); END;
CREATE TRIGGER gr_verdict_no_delete BEFORE DELETE ON gr_verdict BEGIN SELECT RAISE(ABORT, 'gr_verdict is append-only'); END;

-- @table 보류 채점 큐(AI 판단 부재·데드라인 초과·저신뢰·이의). AI 복귀 후 재채점 → grading.verdict.revised. FR-QST-020, X-22
CREATE TABLE gr_pending(
  pending_id          TEXT    NOT NULL PRIMARY KEY CHECK (length(pending_id) = 26), -- ULID
  attempt_id          TEXT    NOT NULL REFERENCES gr_attempt(attempt_id),          -- 응답
  verdict_id          TEXT    NOT NULL REFERENCES gr_verdict(verdict_id),          -- 보류 시점 판정(하위 사다리 결과)
  task_id             TEXT    NOT NULL,                                            -- 재채점 과업(AI-J03 등)
  reason              TEXT    NOT NULL CHECK (reason IN ('offline','deadline','provider_down','self_grade_skipped','low_confidence','appeal')), -- 보류 사유(= IF-01 PendingGradeView.reason, CR-38)
  status              TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','resolved','cancelled')), -- 처리 상태
  attempts            INTEGER NOT NULL DEFAULT 0,                                  -- 재시도 수
  next_attempt_at     INTEGER NOT NULL DEFAULT 0,                                  -- 다음 시도 시각
  ai_job_id           TEXT,                                                        -- ai-gateway background job
  resolved_verdict_id TEXT,                                                        -- 재채점 결과 판정
  created_at          INTEGER NOT NULL,                                            -- 생성 시각
  updated_at          INTEGER NOT NULL,                                            -- 갱신 시각
  resolved_at         INTEGER                                                      -- 해결 시각
) STRICT;
CREATE INDEX ix_gr_pending_open ON gr_pending(status, next_attempt_at) WHERE status IN ('queued','in_progress');

-- @table 이의제기. 원 판정 보존, 결과는 새 Verdict(supersedes). FR-AI-012
CREATE TABLE gr_appeal(
  appeal_id      TEXT    NOT NULL PRIMARY KEY CHECK (length(appeal_id) = 26),      -- ULID
  verdict_id     TEXT    NOT NULL REFERENCES gr_verdict(verdict_id),               -- 이의 대상 판정
  attempt_id     TEXT    NOT NULL REFERENCES gr_attempt(attempt_id),               -- 응답
  reason         TEXT    NOT NULL CHECK (reason IN ('key_wrong','ambiguous','outdated','learner_right','other')), -- 이의 사유 분류(= IF-01 AppealReason, CR-38)
  reason_text    TEXT    NOT NULL DEFAULT '',                                      -- 이의 사유 서술(C1)
  classification_json TEXT CHECK (classification_json IS NULL OR json_valid(classification_json)), -- AI-J19 1차 분류(= AppealView.classification)
  status         TEXT    NOT NULL DEFAULT 'received' CHECK (status IN ('received','classifying','regrading','upheld','rejected','user_decision_required')), -- 처리 상태(= AppealView.state)
  new_verdict_id TEXT,                                                             -- 인용 시 새 판정
  decision_note  TEXT,                                                             -- 기각 사유(표시)
  created_at     INTEGER NOT NULL,                                                 -- 제기 시각
  decided_at     INTEGER                                                           -- 결정 시각
) STRICT;
CREATE INDEX ix_gr_appeal_status ON gr_appeal(status, created_at);

-- @table 대화 턴 판정(디깅·Feynman·Case·반박). 상태·재개는 learning 소유, 판정·다음 move만 기록(append-only). AQ-03
CREATE TABLE gr_turn_judgment(
  judgment_id   TEXT    NOT NULL PRIMARY KEY CHECK (length(judgment_id) = 26),     -- ULID
  turn_id       TEXT    NOT NULL UNIQUE CHECK (length(turn_id) = 26),              -- SubmitTurnBody.turn_id(= Idempotency-Key, IF-CT-042 멱등, CR-37)
  dialog_id     TEXT    NOT NULL CHECK (length(dialog_id) = 26),                   -- learning 대화
  turn_no       INTEGER NOT NULL CHECK (turn_no >= 1),                             -- 턴 번호
  item_ref      TEXT    NOT NULL,                                                  -- 개념·Case·과제 참조
  label         TEXT    NOT NULL,                                                  -- 'complete'|'partial'|'misconception'|'off_topic'|'dont_know'|루브릭 라벨
  mc_id         TEXT,                                                              -- 오개념 라벨일 때
  next_move     TEXT    NOT NULL,                                                  -- 결정적 상태기계의 다음 move(D1~D7 …)
  engine        TEXT    NOT NULL CHECK (engine IN ('D','J','LJ','H','S')),         -- 판정 엔진
  calibrated    INTEGER NOT NULL CHECK (calibrated IN (0,1)),                      -- 보정 여부
  confidence    REAL,                                                              -- 판정 confidence
  judge_log_ref TEXT,                                                              -- ai_judge_log 참조
  utterance_ref TEXT,                                                              -- gr_utterance 참조
  input_hash    TEXT    NOT NULL CHECK (length(input_hash) = 64),                  -- sha256(정준 입력) — 재요청 동일성
  created_at    INTEGER NOT NULL,                                                  -- 판정 시각
  UNIQUE (dialog_id, turn_no)
) STRICT;
CREATE TRIGGER gr_turn_judgment_no_update BEFORE UPDATE ON gr_turn_judgment BEGIN SELECT RAISE(ABORT, 'gr_turn_judgment is append-only'); END;
CREATE TRIGGER gr_turn_judgment_no_delete BEFORE DELETE ON gr_turn_judgment BEGIN SELECT RAISE(ABORT, 'gr_turn_judgment is append-only'); END;

-- @table 발화(질문 은행 렌더 또는 AI-G07 스트림 최종본). gateway·content는 스트림 바이트 중계만
CREATE TABLE gr_utterance(
  utterance_ref TEXT    NOT NULL PRIMARY KEY CHECK (length(utterance_ref) = 26),   -- ULID
  turn_id       TEXT    NOT NULL UNIQUE CHECK (length(turn_id) = 26),              -- 턴 ID(IF-GW-063 /turns/{turn_id}/utterance 라우팅 키, CR-37)
  dialog_id     TEXT    NOT NULL CHECK (length(dialog_id) = 26),                   -- 대화
  turn_no       INTEGER NOT NULL CHECK (turn_no >= 1),                             -- 턴 번호
  source        TEXT    NOT NULL CHECK (source IN ('question_bank','template','ai_stream')), -- 발화 원천
  stream_ref    TEXT,                                                              -- ai-gateway streams/{ref}
  text          TEXT,                                                              -- 최종 텍스트(스트림 완료 전 NULL)
  status        TEXT    NOT NULL CHECK (status IN ('streaming','complete','failed')), -- 상태
  created_at    INTEGER NOT NULL,                                                  -- 생성 시각
  completed_at  INTEGER                                                            -- 완료 시각
) STRICT;
CREATE INDEX ix_gr_utterance_dialog ON gr_utterance(dialog_id, turn_no);
CREATE INDEX ix_gr_utterance_turn ON gr_utterance(turn_id);
