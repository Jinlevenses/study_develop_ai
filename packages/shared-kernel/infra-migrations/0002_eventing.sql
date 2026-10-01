-- @fathom:module=_infra version=2 kind=additive profile=full
-- packages/shared-kernel/infra-migrations/0002_eventing.sql
-- ARC-01 §8.3 공통 인프라 DDL(정본 그대로) + 운영 인덱스(가산). content.db·learning.db·ai.db·ops.db에 적용.

-- @table transactional outbox. 생산 서비스의 상태 변경과 같은 BEGIN IMMEDIATE tx에서 INSERT. 이벤트 1건 = 행 1개(목적지별 복제 없음)
CREATE TABLE outbox(
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,   -- = envelope.producer_seq (생산자 내 총순서, 재사용 금지 → AUTOINCREMENT)
  event_id       TEXT    NOT NULL UNIQUE,             -- ULID, 소비자 dedupe 키
  type           TEXT    NOT NULL,                    -- '<context>.<entity>.<past_tense>' 예: 'grading.verdict.issued'
  schema_version INTEGER NOT NULL,                    -- type별 payload 스키마 버전
  occurred_at    INTEGER NOT NULL,                    -- epoch ms
  correlation_id TEXT    NOT NULL,                    -- 사용자 의도 단위 ULID(attempt_id, job_id, epoch_id …)
  causation_id   TEXT,                                -- 이 이벤트를 낳은 명령·이벤트 ULID
  traceparent    TEXT,                                -- W3C traceparent
  payload        TEXT    NOT NULL CHECK (json_valid(payload)) -- type × schema_version zod 스키마로 검증된 정준 JSON
) STRICT;

-- @table 목적지별 push 커서(목적지별 FIFO). epoch 매니페스트 delivery 값의 원천, 복원 시 되감기 대상
CREATE TABLE outbox_delivery(
  dest            TEXT    PRIMARY KEY,                -- 'learning'|'content'|'gateway'|'ai-gateway'|'ops-api'
  mode            TEXT    NOT NULL CHECK (mode IN ('durable','notify')), -- 소비자 매니페스트의 mode
  last_acked_seq  INTEGER NOT NULL DEFAULT 0,         -- 소비자가 ack한 최대 outbox.seq(구독하지 않는 타입 구간 포함)
  attempts        INTEGER NOT NULL DEFAULT 0,         -- 연속 실패 횟수(성공 시 0)
  next_attempt_at INTEGER NOT NULL DEFAULT 0,         -- 다음 전송 가능 시각(epoch ms, 0.5s→30s 지수 백오프)
  last_error_code TEXT,                               -- 마지막 실패 코드(예: 'DEP-CONNECT', 'HTTP-503')
  updated_at      INTEGER NOT NULL                    -- epoch ms
) STRICT;

-- @table 소비자 dedupe. 이벤트마다 개별 tx에서 핸들러 반영과 함께 INSERT
CREATE TABLE inbox_dedupe(
  event_id     TEXT    PRIMARY KEY,                   -- envelope.event_id
  producer     TEXT    NOT NULL,                      -- envelope.producer(서비스 이름)
  producer_seq INTEGER NOT NULL,                      -- envelope.producer_seq
  type         TEXT    NOT NULL,                      -- envelope.type
  received_at  INTEGER NOT NULL                       -- 처리 완료 시각(epoch ms)
) STRICT;

-- @table 생산자별 처리 완료 최대 producer_seq. epoch 매니페스트 inbox_watermark의 원천
CREATE TABLE inbox_watermark(
  producer          TEXT    PRIMARY KEY,              -- 생산 서비스 이름
  last_producer_seq INTEGER NOT NULL,                 -- 처리 완료한 최대 producer_seq
  updated_at        INTEGER NOT NULL                  -- epoch ms
) STRICT;

-- @table 비원장 경로(on_poison=dead_letter)의 독 이벤트 격리. 원장 경로(halt)는 여기에 넣지 않고 503으로 정지
CREATE TABLE inbox_dead(
  event_id     TEXT    PRIMARY KEY,                   -- envelope.event_id
  producer     TEXT    NOT NULL,                      -- 생산 서비스 이름
  producer_seq INTEGER NOT NULL,                      -- envelope.producer_seq
  type         TEXT    NOT NULL,                      -- envelope.type
  envelope     TEXT    NOT NULL CHECK (json_valid(envelope)), -- 수신한 envelope 원문(정준 JSON)
  error_code   TEXT    NOT NULL,                      -- 'VAL-SCHEMA' | 'HANDLER-<code>' …
  error_detail TEXT    NOT NULL,                      -- 오류 요약(스택·경로·SQL 금지)
  attempts     INTEGER NOT NULL,                      -- 격리 시점 전달 시도 수(≥ 3)
  failed_at    INTEGER NOT NULL,                      -- 격리 시각(epoch ms)
  resolved_at  INTEGER,                               -- 운영자 처리 시각
  resolution   TEXT CHECK (resolution IN ('replayed','discarded')) -- 처리 방식
) STRICT;

-- 가산 인덱스(ARC §8.3 DDL에 추가): 이벤트 타임라인·보존 정리용
CREATE INDEX ix_outbox_correlation      ON outbox(correlation_id);
CREATE INDEX ix_inbox_dedupe_producer   ON inbox_dedupe(producer, producer_seq);
CREATE INDEX ix_inbox_dedupe_received   ON inbox_dedupe(received_at);
CREATE INDEX ix_inbox_dead_open         ON inbox_dead(failed_at) WHERE resolved_at IS NULL;
