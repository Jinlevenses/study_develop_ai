-- @fathom:module=backup version=1 kind=additive
-- services/ops/migrations/backup/0001_backup_core.sql
-- epoch 백업·증분·복원 리허설 기록. ops-api는 다른 서비스 DB 파일을 열지 않는다(매니페스트 값은 각 서비스 snapshot 응답). DR-021, ADR-013

-- @table 백업 실행(스냅샷 epoch·증분·리허설). 부분 매니페스트 금지 → aborted면 op_epoch_manifest 행 없음. FR-SET-004·005
CREATE TABLE op_backup(
  backup_id       TEXT    NOT NULL PRIMARY KEY CHECK (length(backup_id) = 26), -- ULID(스냅샷은 = epoch_id)
  kind            TEXT    NOT NULL CHECK (kind IN ('snapshot','incremental','rehearsal')), -- 종류
  trigger_kind    TEXT    NOT NULL CHECK (trigger_kind IN ('schedule','manual','pre_migrate','pre_fix','pre_upgrade','rehearse')), -- 시작 원인
  status          TEXT    NOT NULL CHECK (status IN ('running','ok','aborted','failed')), -- 결과(ops.backup.completed.outcome)
  reason          TEXT,                                                        -- 중단·실패 사유('quiesce_timeout:learning' 등)
  dir             TEXT    NOT NULL,                                            -- FATHOM_HOME 상대 경로('backups/snap/<epoch_id>')
  bytes           INTEGER,                                                     -- 총 크기
  encrypted       INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0,1)),       -- 2차 사본 암호화 여부
  secondary_status TEXT   CHECK (secondary_status IS NULL OR secondary_status IN ('pending','copied','failed','disabled')), -- 2차 대상 복제 상태
  secondary_at    INTEGER,                                                     -- 2차 복제 완료 시각
  rehearsal_json  TEXT    CHECK (rehearsal_json IS NULL OR json_valid(rehearsal_json)), -- 리허설 결과(체크섬·행 수·투영 해시 비교)
  rpo_hours       REAL,                                                        -- 완료 시점 RPO
  started_at      INTEGER NOT NULL,                                            -- 시작 시각
  finished_at     INTEGER,                                                     -- 종료 시각
  pruned_at       INTEGER,                                                     -- 세대 정리(7세대 초과)로 파일 삭제된 시각(행은 영구)
  ext             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),       -- 확장
  ext_v           INTEGER NOT NULL DEFAULT 1                                   -- ext 스키마 버전
) STRICT;
CREATE INDEX ix_op_backup_kind ON op_backup(kind, started_at);

-- @table 백업 파일 목록(서비스 응답의 file·sha256·bytes)
CREATE TABLE op_backup_file(
  backup_id TEXT    NOT NULL REFERENCES op_backup(backup_id) ON DELETE CASCADE, -- 백업
  svc       TEXT    NOT NULL CHECK (svc IN ('content','learning','ai-gateway','ops-api')), -- 소유 서비스
  file      TEXT    NOT NULL,                                                  -- 파일명('content.db' · '<date>.jsonl')
  sha256    TEXT    NOT NULL CHECK (length(sha256) = 64),                      -- 파일 sha256
  bytes     INTEGER NOT NULL,                                                  -- 크기
  PRIMARY KEY (backup_id, file)
) STRICT;

-- @table epoch 매니페스트 사본(manifest.json 원자 기록 후 INSERT, append-only). @fathom/contracts/admin/epoch-manifest
CREATE TABLE op_epoch_manifest(
  epoch_id        TEXT    NOT NULL PRIMARY KEY REFERENCES op_backup(backup_id), -- epoch ULID
  manifest_json   TEXT    NOT NULL CHECK (json_valid(manifest_json)),          -- 매니페스트 전체(정준 JSON)
  manifest_sha256 TEXT    NOT NULL CHECK (length(manifest_sha256) = 64),       -- manifest.json sha256
  created_at      INTEGER NOT NULL                                             -- 기록 시각
) STRICT;
CREATE TRIGGER op_epoch_manifest_no_update BEFORE UPDATE ON op_epoch_manifest BEGIN SELECT RAISE(ABORT, 'op_epoch_manifest is append-only'); END;
CREATE TRIGGER op_epoch_manifest_no_delete BEFORE DELETE ON op_epoch_manifest BEGIN SELECT RAISE(ABORT, 'op_epoch_manifest is append-only'); END;

-- @table 일 증분 파일(기기별 원장 JSONL + 오버레이 + 골드셋 확정). RPO ≤ 26h
CREATE TABLE op_incremental(
  incr_id          TEXT    NOT NULL PRIMARY KEY CHECK (length(incr_id) = 26),  -- ULID(= op_backup.backup_id)
  device_id        TEXT    NOT NULL CHECK (length(device_id) = 26),            -- 기기
  day              TEXT    NOT NULL CHECK (length(day) = 10),                  -- 파일 날짜(YYYY-MM-DD)
  file             TEXT    NOT NULL,                                           -- 'backups/incr/<device_id>/<day>.jsonl'
  sha256           TEXT    NOT NULL CHECK (length(sha256) = 64),               -- 파일 sha256
  since_checkpoint TEXT,                                                       -- 기준 체크포인트
  to_checkpoint    TEXT    NOT NULL,                                           -- 생성 체크포인트(다음 since)
  created_at       INTEGER NOT NULL,                                           -- 생성 시각
  pruned_at        INTEGER,                                                    -- 가장 오래된 보관 스냅샷 이전분 파일 삭제 시각
  UNIQUE (device_id, day)
) STRICT;

-- @table 업그레이드 롤백 시 보류한 상위 schema_version 증분(backups/incr/_held/). 재업그레이드 때 흡수
CREATE TABLE op_held_increment(
  file        TEXT    NOT NULL PRIMARY KEY,                                    -- 'backups/incr/_held/<…>.jsonl'
  sha256      TEXT    NOT NULL CHECK (length(sha256) = 64),                    -- 파일 sha256
  max_schema_json TEXT NOT NULL CHECK (json_valid(max_schema_json)),           -- 타입별 최대 schema_version
  held_at     INTEGER NOT NULL,                                                -- 보류 시각
  absorbed_at INTEGER                                                          -- 흡수 시각
) STRICT;
