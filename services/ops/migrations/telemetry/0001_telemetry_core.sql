-- @fathom:module=telemetry version=1 kind=additive
-- services/ops/migrations/telemetry/0001_telemetry_core.sql
-- 로컬 텔레메트리(외부 전송 0). 원시 400일·일 집계 영구(NFR-DATA-007). Tripwire TW-01~13 + 자원 Tripwire

-- @table 텔레메트리 원시 신호(이벤트 수신·learning 텔레메트리 API 수집). 400일 보존
CREATE TABLE op_telemetry_raw(
  id          INTEGER PRIMARY KEY,                                             -- rowid
  kind        TEXT    NOT NULL,                                                -- 'session.completed'|'level.promoted'|'ledger.merged'|'ai.mode'|'resource'…
  ts          INTEGER NOT NULL,                                                -- 발생 시각
  source_event_id TEXT,                                                        -- 원천 통합 이벤트 event_id(멱등)
  payload_json TEXT   NOT NULL CHECK (json_valid(payload_json))                -- 신호 값
) STRICT;
CREATE INDEX ix_op_telemetry_raw_ts ON op_telemetry_raw(ts);
CREATE UNIQUE INDEX ux_op_telemetry_raw_src ON op_telemetry_raw(source_event_id) WHERE source_event_id IS NOT NULL;

-- @table 일 집계(영구). RETRO 기준선·Radar 개인 기준선(28일 평균)
CREATE TABLE op_telemetry_daily(
  day     TEXT    NOT NULL CHECK (length(day) = 10),                           -- 학습일(YYYY-MM-DD)
  metric  TEXT    NOT NULL,                                                    -- 'sessions'|'minutes'|'first_item_p95_ms'|'idle_rss_mb'|…
  dim     TEXT    NOT NULL DEFAULT '*',                                        -- 차원('*'|트랙|서비스)
  value   REAL    NOT NULL,                                                    -- 값
  PRIMARY KEY (day, metric, dim)
) STRICT, WITHOUT ROWID;

-- @table Tripwire 상태(TW-01~13·자원 Tripwire)
CREATE TABLE op_tripwire_state(
  tw_id       TEXT    NOT NULL PRIMARY KEY,                                    -- 'TW-01'…'TW-13'|'RES-RSS'|'RES-COLD'|'RES-DISK'
  state       TEXT    NOT NULL CHECK (state IN ('ok','warn','trip','insufficient_data')), -- 상태(= IF-01 TripwireView.state, CR-48)
  value       REAL,                                                            -- 현재 값
  baseline    REAL,                                                            -- 개인 기준선
  action_strength TEXT NOT NULL DEFAULT 'suggest' CHECK (action_strength IN ('observe','suggest','auto_adjust')), -- 조치 강도(= TripwireSettings.action_strength, FR-SET-021)
  muted       INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0,1)),               -- 음소거(= TripwireSettings.muted 포함 여부)
  updated_at  INTEGER NOT NULL                                                 -- 갱신 시각
) STRICT;

-- @table 최신 호스트 상태(ops.host_state.changed 원천, 1행)
CREATE TABLE op_host_state(
  id                INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),               -- 단일 행
  idle_window_open  INTEGER NOT NULL CHECK (idle_window_open IN (0,1)),        -- 배치 창 열림
  idle_since        INTEGER,                                                   -- 입력 유휴 시작
  power             TEXT    NOT NULL CHECK (power IN ('ac','battery','unknown')), -- 전원
  interactive_cli_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interactive_cli_json)), -- 사용자 대화형 CLI 감지 목록
  disk_free_mb      INTEGER,                                                   -- FATHOM_HOME 디스크 여유
  data_path_risk    TEXT    CHECK (data_path_risk IS NULL OR data_path_risk IN ('sync_folder','network','wsl')), -- 데이터 경로 경고
  sampled_at        INTEGER NOT NULL                                           -- 샘플 시각
) STRICT;
