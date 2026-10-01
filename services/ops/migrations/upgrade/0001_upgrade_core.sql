-- @fathom:module=upgrade version=1 kind=additive
-- services/ops/migrations/upgrade/0001_upgrade_core.sql

-- @table 업그레이드·롤백 실행(fathom upgrade [--rollback]). 이력 영구. ADR-013 §6
CREATE TABLE op_upgrade(
  upgrade_id     TEXT    NOT NULL PRIMARY KEY CHECK (length(upgrade_id) = 26), -- ULID
  kind           TEXT    NOT NULL CHECK (kind IN ('upgrade','rollback')),      -- 종류
  from_version   TEXT    NOT NULL,                                             -- 이전 앱 버전
  to_version     TEXT    NOT NULL,                                             -- 대상 앱 버전
  bundle_sha256  TEXT    CHECK (bundle_sha256 IS NULL OR length(bundle_sha256) = 64), -- bundle.manifest.json sha256
  pre_epoch_id   TEXT,                                                         -- 업그레이드 전 자동 epoch
  status         TEXT    NOT NULL CHECK (status IN ('preparing','dry_run_ok','migrating','handshake','completed','rolled_back','failed')), -- 진행 상태
  steps_json     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(steps_json)), -- 단계별 결과(서비스별 migrate exit·verify 해시 리포트)
  error_code     TEXT,                                                         -- 실패 코드
  started_at     INTEGER NOT NULL,                                             -- 시작 시각
  finished_at    INTEGER,                                                      -- 종료 시각
  ext            TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),        -- 확장
  ext_v          INTEGER NOT NULL DEFAULT 1                                    -- ext 스키마 버전
) STRICT;

-- @table 자동 기동 설정 상태(기본 off). FR-SET-024
CREATE TABLE op_autostart(
  platform   TEXT    NOT NULL PRIMARY KEY CHECK (platform IN ('darwin','win32','linux')), -- OS
  enabled    INTEGER NOT NULL CHECK (enabled IN (0,1)),                        -- 활성
  file_path  TEXT,                                                             -- 생성한 plist·작업·unit 경로
  updated_at INTEGER NOT NULL                                                  -- 갱신 시각
) STRICT;
