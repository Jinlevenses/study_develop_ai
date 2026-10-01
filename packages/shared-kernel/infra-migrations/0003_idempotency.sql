-- @fathom:module=_infra version=3 kind=additive profile=full
-- packages/shared-kernel/infra-migrations/0003_idempotency.sql

-- @table HTTP 멱등 저장소. 저장 키 = (key, caller, route_id), 보관 7일, 같은 키·다른 본문 해시 → 422 *-CONFLICT-001
CREATE TABLE idem_request(
  key           TEXT    NOT NULL,                      -- Idempotency-Key 헤더 값(브라우저 ULID 또는 'verdict:<id>' 등)
  caller        TEXT    NOT NULL,                      -- 호출자 이름('gateway'|'learning'|'content'|'ops-api'|'browser'|'cli')
  route_id      TEXT    NOT NULL,                      -- contracts defineRoute().id
  request_hash  TEXT    NOT NULL,                      -- sha256(canonical JSON body)
  status        INTEGER NOT NULL,                      -- 저장된 HTTP 상태 코드
  response_json TEXT    NOT NULL CHECK (json_valid(response_json)), -- 저장된 응답 본문
  created_at    INTEGER NOT NULL,                      -- epoch ms
  PRIMARY KEY (key, caller, route_id)
) STRICT;

CREATE INDEX ix_idem_request_created ON idem_request(created_at);
