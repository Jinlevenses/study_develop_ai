-- @fathom:module=practice version=1 kind=additive
-- services/learning/migrations/practice/0001_practice_core.sql
-- 세션·블록(prefetch 보관)·응답 처리·대화·장기 과제·리듬. 기기 로컬 상태(병합 대상 아님 — 증거는 원장에만).

-- @table 세션. 종료(completed·abandoned) 후 불변(트리거). DR-013, FR-STD-001·031·032
CREATE TABLE lr_session(
  session_id       TEXT    NOT NULL PRIMARY KEY CHECK (length(session_id) = 26), -- ULID(= Idempotency-Key)
  template         TEXT    NOT NULL CHECK (template IN ('standard','placement','verify','promotion_exam','weak_drill','dday','return')), -- IF-01 SessionTemplate(CR-37)
  scope_json       TEXT    NOT NULL CHECK (json_valid(scope_json)),            -- {kind: all|path|tracks|concepts, ids[]}(템플릿에 범위가 없으면 {kind:'all'})
  template_min     INTEGER CHECK (template_min IS NULL OR template_min IN (5,15,25,45,90)), -- 시간 템플릿(placement·verify·promotion_exam = NULL)
  energy           TEXT    CHECK (energy IS NULL OR energy IN ('light','normal','deep')), -- 에너지(standard·dday만)
  ai_mode_at_start TEXT    NOT NULL CHECK (ai_mode_at_start IN ('FULL','JUDGE_ONLY','LLM_ONLY','OFFLINE')), -- 시작 시 AI 모드(SessionView.ai_mode_at_start)
  jol_pred         REAL    CHECK (jol_pred IS NULL OR jol_pred BETWEEN 0 AND 1), -- 세션 전 예측 정답률(선택)
  status           TEXT    NOT NULL CHECK (status IN ('active','paused','completed','abandoned')), -- 상태(paused = IF-LR-012·013, 종료 후 불변 트리거는 completed·abandoned만)
  study_day        TEXT    NOT NULL CHECK (length(study_day) = 10),            -- 시작 학습일(04:00 경계, 생성 시 고정)
  policy_version   TEXT    NOT NULL,                                           -- 조립 시 정책 세트
  composer_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(composer_json)), -- 조립 근거(Stage1·Stage2 점수 요약)
  relaxations_json TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(relaxations_json)), -- 하드 제약 완화 사유(1회 표시)
  blocks_total     INTEGER NOT NULL DEFAULT 0,                                 -- 블록 수
  blocks_done      INTEGER NOT NULL DEFAULT 0,                                 -- 완료 블록 수
  first_item_latency_ms INTEGER,                                               -- 첫 문항 지연(NFR-PERF-001)
  started_at       INTEGER NOT NULL,                                           -- 시작 시각
  ended_at         INTEGER,                                                    -- 종료 시각
  ext              TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),      -- 확장
  ext_v            INTEGER NOT NULL DEFAULT 1                                  -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_lr_session_started ON lr_session(started_at);
CREATE INDEX ix_lr_session_active  ON lr_session(status) WHERE status = 'active';
CREATE TRIGGER lr_session_frozen BEFORE UPDATE ON lr_session WHEN old.status IN ('completed','abandoned') BEGIN SELECT RAISE(ABORT, 'ended session is immutable'); END;
CREATE TRIGGER lr_session_no_delete BEFORE DELETE ON lr_session BEGIN SELECT RAISE(ABORT, 'lr_session rows are permanent'); END;

-- @table 세션 블록(슬롯 W/R/N/D/S/C). items_json = items:select 1회 prefetch 결과(ItemDelivery, 정답·해설 없음) — content 정지 중 제시 지속(D-9)
CREATE TABLE lr_block(
  block_id          TEXT    NOT NULL PRIMARY KEY CHECK (length(block_id) = 26), -- ULID
  session_id        TEXT    NOT NULL REFERENCES lr_session(session_id),        -- 세션
  ord               INTEGER NOT NULL CHECK (ord >= 0),                         -- 순서(0부터, IF BlockSummary.ord)
  slot              TEXT    NOT NULL CHECK (slot IN ('W','R','N','D','S','C')), -- 슬롯
  kind              TEXT    NOT NULL CHECK (kind IN ('lesson','items','blank_note','dialog','lab','case','artifact','jol','reflection','triage')), -- IF-01 BlockKind(CR-37)
  mode_id           TEXT    NOT NULL,                                          -- 'M-03' 등(modes.manifest)
  concept_id        TEXT,                                                      -- 대상 개념(BlockSummary.concept_id)
  format            TEXT,                                                      -- 형식(문항 블록, IF-01 FormatId)
  est_minutes       REAL    NOT NULL DEFAULT 0,                                -- 예상 소요 분(BlockSummary.est_minutes)
  boss              INTEGER NOT NULL DEFAULT 0 CHECK (boss IN (0,1)),          -- 보스 챌린지(FR-STD-004)
  wildcard          TEXT,                                                      -- 와일드카드 종류(composer_policy.wildcard 키, 없으면 NULL)
  reason_codes_json TEXT    NOT NULL CHECK (json_valid(reason_codes_json)),    -- "왜 지금?" 사유 칩(≥ 1)
  locked            INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),        -- 잠금(재구성 시 유지)
  status            TEXT    NOT NULL CHECK (status IN ('pending','active','awaiting_grade','done','skipped','swapped')), -- IF-01 BlockState(awaiting_grade = IF-LR-010 ⑤, CR-37)
  swapped_by        TEXT,                                                      -- 교체 블록(status = swapped)
  items_json        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(items_json)), -- prefetch ItemDelivery 목록
  cursor            INTEGER NOT NULL DEFAULT 0,                                -- 블록 내 진행 위치(재개)
  started_at        INTEGER,                                                   -- 시작 시각
  done_at           INTEGER,                                                   -- 완료 시각
  UNIQUE (session_id, ord)
) STRICT;

-- @table 응답 처리 상태(attempt 단위). 원장 기록 여부·Verdict 연결. 재시작 후 재개·중복 0(FR-STD-031)
CREATE TABLE lr_attempt(
  attempt_id      TEXT    NOT NULL PRIMARY KEY CHECK (length(attempt_id) = 26), -- 브라우저 ULID(= Idempotency-Key)
  session_id      TEXT    NOT NULL REFERENCES lr_session(session_id),          -- 세션
  block_id        TEXT    REFERENCES lr_block(block_id),                       -- 블록
  item_id         TEXT    NOT NULL,                                            -- 문항
  kind            TEXT    NOT NULL CHECK (kind IN ('graded','pretest','embedded','self_assessment','exam')), -- 원장 매핑 종류
  status          TEXT    NOT NULL CHECK (status IN ('submitted','awaiting_self_grade','graded','pending','failed')), -- 처리 상태(awaiting_self_grade = 자기채점 대기, CR-37)
  verdict_id      TEXT,                                                        -- 최신 Verdict
  ledger_event_id TEXT,                                                        -- 기록된 원장 이벤트
  exam_id         TEXT,                                                        -- 승급 평가 소속
  submitted_at    INTEGER NOT NULL,                                            -- 제출 시각
  updated_at      INTEGER NOT NULL                                             -- 갱신 시각
) STRICT;
CREATE INDEX ix_lr_attempt_session ON lr_attempt(session_id);
CREATE INDEX ix_lr_attempt_open    ON lr_attempt(status) WHERE status IN ('submitted','awaiting_self_grade','pending');

-- @table 대화 상태(디깅·Feynman·Case 토론·산출물 반박). 상태기계 정의는 팩, 판정·발화는 content. AQ-03
CREATE TABLE lr_dialog_state(
  dialog_id   TEXT    NOT NULL PRIMARY KEY CHECK (length(dialog_id) = 26),     -- ULID
  kind        TEXT    NOT NULL CHECK (kind IN ('dig','feynman','artifact_rebuttal')), -- 대화 종류(= IF-01 DialogKind, CR-37. Case 토론은 lr_long_task + dig)
  target_ref  TEXT    NOT NULL,                                                -- concept_id · case_id · artifact_id
  session_id  TEXT,                                                            -- 시작 세션
  state_json  TEXT    NOT NULL CHECK (json_valid(state_json)),                 -- 상태기계 위치(move, 깊이 게이지, 실패 수)
  turn_count  INTEGER NOT NULL DEFAULT 0 CHECK (turn_count BETWEEN 0 AND 12),  -- 턴 수(상한 12)
  depth_max   INTEGER NOT NULL DEFAULT 0 CHECK (depth_max BETWEEN 0 AND 7),    -- 도달 D 단계
  status      TEXT    NOT NULL CHECK (status IN ('active','completed','abandoned')), -- 상태
  created_at  INTEGER NOT NULL,                                                -- 시작 시각
  updated_at  INTEGER NOT NULL,                                                -- 갱신 시각
  ext         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),           -- 확장
  ext_v       INTEGER NOT NULL DEFAULT 1                                       -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_lr_dialog_state_active ON lr_dialog_state(status, updated_at);

-- @table 대화 턴 로그(append-only). 학습자 발화 원문(C1) + 판정·발화 참조
CREATE TABLE lr_dialog_turn(
  dialog_id     TEXT    NOT NULL REFERENCES lr_dialog_state(dialog_id),        -- 대화
  turn_no       INTEGER NOT NULL CHECK (turn_no BETWEEN 1 AND 12),             -- 턴 번호
  turn_id       TEXT    NOT NULL UNIQUE CHECK (length(turn_id) = 26),          -- SubmitTurnBody.turn_id(= Idempotency-Key, CR-37)
  learner_text  TEXT    NOT NULL,                                              -- 학습자 입력
  judgment_json TEXT    NOT NULL CHECK (json_valid(judgment_json)),            -- content TurnJudge 응답(label·next_move·engine)
  utterance_ref TEXT,                                                          -- gr_utterance 참조(시스템 발화)
  created_at    INTEGER NOT NULL,                                              -- 기록 시각
  PRIMARY KEY (dialog_id, turn_no)
) STRICT;
CREATE TRIGGER lr_dialog_turn_no_update BEFORE UPDATE ON lr_dialog_turn BEGIN SELECT RAISE(ABORT, 'lr_dialog_turn is append-only'); END;
CREATE TRIGGER lr_dialog_turn_no_delete BEFORE DELETE ON lr_dialog_turn BEGIN SELECT RAISE(ABORT, 'lr_dialog_turn is append-only'); END;

-- @table 장기 과제(Case run·산출물·카타 시리즈) 진행 상태. 저장·재개. DR-014, FR-STD-025·034
CREATE TABLE lr_long_task(
  task_id      TEXT    NOT NULL PRIMARY KEY CHECK (length(task_id) = 26),      -- ULID
  kind         TEXT    NOT NULL CHECK (kind IN ('case','artifact')),           -- 과제 종류
  target_ref   TEXT    NOT NULL,                                               -- case_id · artifact_id
  variant_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(variant_json)), -- 인스턴스화 변형(variant_params·root_cause 선택)
  recall_mode  INTEGER NOT NULL DEFAULT 0 CHECK (recall_mode IN (0,1)),        -- 변형 소진 회상 모드(w × 0.5)
  state_json   TEXT    NOT NULL CHECK (json_valid(state_json)),                -- 공개 노드·결정·요청 비용 로그
  status       TEXT    NOT NULL CHECK (status IN ('active','submitted','graded','abandoned')), -- 상태
  dialog_id    TEXT,                                                           -- 연결 대화(반박·토론)
  created_at   INTEGER NOT NULL,                                               -- 시작 시각
  updated_at   INTEGER NOT NULL,                                               -- 갱신 시각
  ext          TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),          -- 확장(DR-020 ext: case.world_id·episode_seq)
  ext_v        INTEGER NOT NULL DEFAULT 1                                      -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_lr_long_task_target ON lr_long_task(kind, target_ref);

-- @table 산출물 초안·버전. submitted = 1인 행은 불변(트리거). DR-014
CREATE TABLE lr_artifact_version(
  task_id     TEXT    NOT NULL REFERENCES lr_long_task(task_id),               -- 장기 과제
  version     INTEGER NOT NULL CHECK (version >= 1),                           -- 버전
  content_md  TEXT    NOT NULL,                                                -- 본문(C1)
  submitted   INTEGER NOT NULL DEFAULT 0 CHECK (submitted IN (0,1)),           -- 제출본 여부
  attempt_id  TEXT,                                                            -- 채점 응답(제출본)
  created_at  INTEGER NOT NULL,                                                -- 저장 시각
  PRIMARY KEY (task_id, version)
) STRICT;
CREATE TRIGGER lr_artifact_version_frozen BEFORE UPDATE ON lr_artifact_version WHEN old.submitted = 1 BEGIN SELECT RAISE(ABORT, 'submitted artifact is immutable'); END;
CREATE TRIGGER lr_artifact_version_no_delete BEFORE DELETE ON lr_artifact_version WHEN old.submitted = 1 BEGIN SELECT RAISE(ABORT, 'submitted artifact is immutable'); END;

-- @table 백지노트 초안(블록당 1행, 원장 아님 — 재시작 후 재개). IF-LR-025·IF-GW-066, IF-01 D-32, FR-STD-031, CR-40
CREATE TABLE lr_note_draft(
  block_id          TEXT    NOT NULL PRIMARY KEY REFERENCES lr_block(block_id), -- 블록
  text              TEXT    NOT NULL,                                          -- 초안 본문(C1, NFC)
  uncertain_spans_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(uncertain_spans_json)), -- 불확실 표시 구간
  client_updated_at INTEGER NOT NULL,                                          -- 클라이언트 편집 시각(늦은 쓰기 거부 기준)
  saved_at          INTEGER NOT NULL                                           -- 서버 저장 시각
) STRICT;

-- @table 주간 리뷰·시즌 회고 사용자 서술(백업·export 대상 — insight.db는 재구성 가능이므로 사용자 원문을 두지 않음). IF-LR-058·033, CR-40
CREATE TABLE lr_review_note(
  kind         TEXT    NOT NULL CHECK (kind IN ('weekly','season_retro')),    -- 종류
  key          TEXT    NOT NULL,                                               -- weekly = 주 시작 학습일 'YYYY-MM-DD' · season_retro = season_id
  body_md      TEXT,                                                           -- reflection_md · retro_md(C1)
  focus_json   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(focus_json)),   -- next_week_focus(개념 ID 목록)
  completed_at INTEGER NOT NULL,                                               -- 완료 시각
  PRIMARY KEY (kind, key)
) STRICT, WITHOUT ROWID;

-- @table 리듬 프로파일(일시정지·크런치·복귀·D-day). 큐 조립 입력(FSRS 상태는 바꾸지 않음). FR-PRG-019~021
CREATE TABLE lr_profile_mode(
  mode_id     TEXT    NOT NULL PRIMARY KEY CHECK (length(mode_id) = 26),       -- ULID
  kind        TEXT    NOT NULL CHECK (kind IN ('pause','crunch','return','dday')), -- 프로파일 종류
  start_day   TEXT    NOT NULL CHECK (length(start_day) = 10),                 -- 시작 학습일
  end_day     TEXT    CHECK (end_day IS NULL OR length(end_day) = 10),         -- 종료 학습일(dday = 목표일)
  params_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(params_json)),   -- 범위(개념·블루프린트)·보존율 조정 등
  status      TEXT    NOT NULL CHECK (status IN ('active','ended','cancelled')), -- 상태
  created_at  INTEGER NOT NULL,                                                -- 생성 시각
  ended_at    INTEGER,                                                         -- 종료 시각
  ext         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),           -- 확장
  ext_v       INTEGER NOT NULL DEFAULT 1                                       -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_lr_profile_mode_active ON lr_profile_mode(status) WHERE status = 'active';

-- @table 예약 힌트(재회상 1d·1w·1m, 고확신 오답 24h 재출제, 재도전 +2d·+14d, 타임캡슐 재질문). Composer 입력
CREATE TABLE lr_schedule_hint(
  hint_id         TEXT    NOT NULL PRIMARY KEY CHECK (length(hint_id) = 26),   -- ULID
  kind            TEXT    NOT NULL CHECK (kind IN ('recall','mc_retry','verify_retry','promotion_retry','timecapsule','inbox_triage')), -- 힌트 종류
  target_kind     TEXT    NOT NULL CHECK (target_kind IN ('concept','card','mc','track','declaration','inbox')), -- 대상 종류
  target_id       TEXT    NOT NULL,                                            -- 대상 ID
  due_at          INTEGER NOT NULL,                                            -- 예정 시각
  source_event_id TEXT,                                                        -- 원인 원장 이벤트
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','cancelled')), -- 상태
  created_at      INTEGER NOT NULL,                                            -- 생성 시각
  consumed_at     INTEGER                                                      -- 소비 시각
) STRICT;
CREATE INDEX ix_lr_schedule_hint_due ON lr_schedule_hint(status, due_at);

-- @table 일일 상한 초과 카드의 분산 배치(Keystone 절단분, 다음 3일 로드밸런싱). FR-PRG-006
CREATE TABLE lr_queue_overflow(
  card_id          TEXT    NOT NULL PRIMARY KEY,                               -- 카드
  target_study_day TEXT    NOT NULL CHECK (length(target_study_day) = 10),     -- 배치 학습일
  created_at       INTEGER NOT NULL                                            -- 생성 시각
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_lr_queue_overflow_day ON lr_queue_overflow(target_study_day);
