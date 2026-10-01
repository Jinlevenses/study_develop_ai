-- @fathom:module=fixture version=1 kind=additive
-- 통합 테스트 fixture 모듈 — 서비스 모듈 1개가 `_infra`와 함께 적용되는지 본다.
CREATE TABLE fx_item(
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;
