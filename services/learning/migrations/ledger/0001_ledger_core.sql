-- @fathom:module=ledger version=1 kind=additive
-- services/learning/migrations/ledger/0001_ledger_core.sql
-- 증거 원장(ADR-011 §1 정본 DDL). 쓰기 = services/learning/src/infra/ledger/ledger-writer.ts의 INSERT OR IGNORE 하나뿐.
-- 모든 learning.db 연결은 PRAGMA recursive_triggers=ON(REPLACE의 암묵 DELETE도 아래 트리거가 거부). 트리거는 실수 방지 장치이지 보안 경계가 아니다.

-- @table 증거 원장(append-only, 기기별 해시 체인). 리플레이 = ORDER BY client_ts, device_id, device_seq만. DR-010, DR-020(event.*), NFR-DATA-001·013
CREATE TABLE lr_event(
  event_id        TEXT    PRIMARY KEY CHECK (length(event_id) = 26),          -- ULID, 멱등 수입 키(DR-020 이름 훅)
  device_id       TEXT    NOT NULL CHECK (length(device_id) = 26 AND device_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'), -- 기기 ULID(ASCII 대문자 → BINARY = JS 비교, DR-020)
  device_seq      INTEGER NOT NULL CHECK (device_seq >= 1),                   -- 기기별 단조 순번(DR-020)
  client_ts       INTEGER NOT NULL,                                           -- epoch ms, 기기별 단조: max(now, last_client_ts + 1) (DR-020)
  type            TEXT    NOT NULL,                                           -- 원장 이벤트 17종(contracts/ledger/types)
  schema_version  INTEGER NOT NULL,                                           -- 타입별 payload 버전, upcaster 입력
  idempotency_key TEXT    NOT NULL UNIQUE,                                    -- 'verdict:<id>'·'corr:…'·'cmd:<id>'… (DR-020)
  payload         TEXT    NOT NULL CHECK (json_valid(payload)),               -- 정준 JSON(리플레이 입력 내장: card_id·concept_id·…·policy_version·fsrs_at·study_day)
  prev_hash       TEXT    NOT NULL,                                           -- 같은 device 직전 이벤트 hash(첫 이벤트 '0' × 64)
  hash            TEXT    NOT NULL,                                           -- sha256(canonical({event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash}))
  experiment_arm  TEXT,                                                       -- DR-020 이름 훅(v2 N-of-1 실험, v1 항상 NULL)
  recorded_at     INTEGER NOT NULL,                                           -- 수신 시각(정보용, 리플레이 미사용)
  ext             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),      -- 확장(해시 대상 아님)
  ext_v           INTEGER NOT NULL DEFAULT 1,                                 -- ext 스키마 버전
  card_id    TEXT GENERATED ALWAYS AS (json_extract(payload, '$.card_id'))    STORED, -- payload.card_id(카드 키 재도출 인덱스)
  concept_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.concept_id')) STORED, -- payload.concept_id(개념 키 재도출 인덱스)
  UNIQUE (device_id, device_seq)
) STRICT;
CREATE INDEX ix_lr_event_order   ON lr_event(client_ts, device_id, device_seq);
CREATE INDEX ix_lr_event_card    ON lr_event(card_id, client_ts, device_id, device_seq);
CREATE INDEX ix_lr_event_concept ON lr_event(concept_id, client_ts, device_id, device_seq);
CREATE INDEX ix_lr_event_corr    ON lr_event(type) WHERE type IN ('evidence.voided', 'evidence.weight_adjusted');
CREATE TRIGGER lr_event_no_update BEFORE UPDATE ON lr_event BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER lr_event_no_delete BEFORE DELETE ON lr_event BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

-- @table 기기 레지스트리. is_local = 1인 행은 정확히 1개(이 설치). DR-025
CREATE TABLE lr_device(
  device_id    TEXT    NOT NULL PRIMARY KEY CHECK (length(device_id) = 26 AND device_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'), -- 기기 ULID
  is_local     INTEGER NOT NULL DEFAULT 0 CHECK (is_local IN (0,1)),          -- 이 설치의 기기 여부
  display_name TEXT    NOT NULL DEFAULT '',                                   -- 표시 이름(사용자 지정)
  platform     TEXT    NOT NULL DEFAULT '',                                   -- 'win32-x64' 등(정보용)
  created_at   INTEGER NOT NULL,                                              -- 최초 등록(로컬 = 설치 시각, 원격 = 첫 병합 시각)
  ext          TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),         -- 확장
  ext_v        INTEGER NOT NULL DEFAULT 1                                     -- ext 스키마 버전
) STRICT;
CREATE UNIQUE INDEX ux_lr_device_local ON lr_device(is_local) WHERE is_local = 1;

-- @table 체크포인트 매니페스트(append-only) = 체인 헤드 외부 앵커 ①. root_hash = sha256(정준 devices_json). FR-PRG-003, DR-025, CR-27
CREATE TABLE lr_checkpoint(
  checkpoint_id      TEXT    NOT NULL PRIMARY KEY CHECK (length(checkpoint_id) = 26), -- ULID(export --since 인자)
  kind               TEXT    NOT NULL CHECK (kind IN ('export','merge','epoch','local')), -- 생성 사유
  devices_json       TEXT    NOT NULL CHECK (json_valid(devices_json)),       -- {device_id: {seq, head_hash}} 기기별 체인 헤드
  root_hash          TEXT    NOT NULL CHECK (length(root_hash) = 64),         -- sha256(canonical(devices_json))
  source_file_sha256 TEXT    CHECK (source_file_sha256 IS NULL OR length(source_file_sha256) = 64), -- 병합 입력 파일 sha256
  projection_hash    TEXT    CHECK (projection_hash IS NULL OR length(projection_hash) = 64), -- 병합 후 투영 해시
  created_at         INTEGER NOT NULL                                         -- 생성 시각
) STRICT;
CREATE TRIGGER lr_checkpoint_no_update BEFORE UPDATE ON lr_checkpoint BEGIN SELECT RAISE(ABORT, 'lr_checkpoint is append-only'); END;
CREATE TRIGGER lr_checkpoint_no_delete BEFORE DELETE ON lr_checkpoint BEGIN SELECT RAISE(ABORT, 'lr_checkpoint is append-only'); END;
