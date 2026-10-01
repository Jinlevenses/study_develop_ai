-- 증거 원장 (주석은 DDL 해석에서 제거된다: CREATE TABLE fake (x INT);)
CREATE TABLE IF NOT EXISTS lr_event (
  event_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),
  ext_v INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT lr_event_len CHECK (length(event_id) = 26)
) STRICT;
/* 가상 테이블은 무시한다 */
CREATE VIRTUAL TABLE lr_event_fts USING fts5(body);
