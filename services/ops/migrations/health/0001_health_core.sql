-- @fathom:module=health version=1 kind=additive
-- services/ops/migrations/health/0001_health_core.sql
-- 헬스 샘플(1분 롤업 30일)·배너·서비스 상태 이력·doctor 실행. ADR-015

-- @table 메트릭 1분 롤업(15s 수집 → 1분). 30일 보존. SLO·Tripwire 입력
CREATE TABLE op_health_sample(
  svc          TEXT    NOT NULL CHECK (svc IN ('gateway','content','learning','ai-gateway','ops-api','supervisor')), -- 서비스
  minute_ts    INTEGER NOT NULL,                                               -- 분 시작(epoch ms, 60000 배수)
  metrics_json TEXT    NOT NULL CHECK (json_valid(metrics_json)),              -- {rss_mb, eventloop_p99_ms, outbox{dest:{pending, oldest_age_ms}}, http_p95{route}, …}
  PRIMARY KEY (svc, minute_ts)
) STRICT, WITHOUT ROWID;
CREATE INDEX ix_op_health_sample_minute ON op_health_sample(minute_ts);

-- @table 운영 배너(홈 경보 슬롯 1개 = 우선순위 최상위). FR-SET-017, NFR-AVL-005
CREATE TABLE op_banner(
  banner_id   TEXT    NOT NULL PRIMARY KEY CHECK (length(banner_id) = 26),     -- ULID
  dedupe_key  TEXT    NOT NULL,                                                -- 'backup_stale'|'integrity_fail:<svc>'|'ledger_halt'|'runner_platform_disabled'…
  severity    TEXT    NOT NULL CHECK (severity IN ('info','warn','critical')), -- 심각도
  priority    INTEGER NOT NULL,                                                -- 낮을수록 우선
  title_key   TEXT    NOT NULL,                                                -- i18n 카피 키(비난 없는 카피)
  detail_json TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json)),   -- 상세·조치 링크
  raised_at   INTEGER NOT NULL,                                                -- 발생 시각
  cleared_at  INTEGER                                                          -- 해소 시각
) STRICT;
CREATE UNIQUE INDEX ux_op_banner_open ON op_banner(dedupe_key) WHERE cleared_at IS NULL;

-- @table 서비스 상태 전이 이력(재시작·degraded·ready). 30일 보존
CREATE TABLE op_service_event(
  id         INTEGER PRIMARY KEY,                                              -- rowid
  svc        TEXT    NOT NULL,                                                 -- 서비스
  state      TEXT    NOT NULL CHECK (state IN ('starting','ready','restarting','degraded','stopped','crashed')), -- 새 상태
  exit_code  INTEGER,                                                          -- 종료 코드(75·78 등)
  detail     TEXT,                                                             -- 사유 코드
  at         INTEGER NOT NULL                                                  -- 시각
) STRICT;
CREATE INDEX ix_op_service_event_at ON op_service_event(at);

-- @table doctor 실행 기록(점검 항목별 결과, --fix 선행 백업 ID). FR-SET-003
CREATE TABLE op_doctor_run(
  run_id        TEXT    NOT NULL PRIMARY KEY CHECK (length(run_id) = 26),      -- ULID
  mode          TEXT    NOT NULL CHECK (mode IN ('check','fix','live','safe')), -- 실행 모드
  results_json  TEXT    NOT NULL CHECK (json_valid(results_json)),             -- 항목별 {id, status, code, hint}
  pre_backup_id TEXT,                                                          -- --fix 선행 스냅샷
  created_at    INTEGER NOT NULL                                               -- 실행 시각
) STRICT;
