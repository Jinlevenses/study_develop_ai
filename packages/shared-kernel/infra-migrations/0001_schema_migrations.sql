-- @fathom:module=_infra version=1 kind=additive profile=meta,full
-- packages/shared-kernel/infra-migrations/0001_schema_migrations.sql
-- 모든 DB 파일(6개)에 가장 먼저 적용된다. insight.db·ai-cache.db(profile=meta)는 이 파일만 적용한다.

-- @table 마이그레이션 적용 기록. (module, version)당 1행. 적용된 파일의 sha256이 번들 파일과 다르면 serve 모드 기동 거부(exit 78)
CREATE TABLE schema_migrations(
  module     TEXT    NOT NULL,                         -- '_infra' | 'catalog' | 'ledger' | ... (마이그레이션 디렉터리 이름)
  version    INTEGER NOT NULL,                         -- 파일 번호 NNNN(1부터, 모듈 안에서 연속)
  name       TEXT    NOT NULL,                         -- 파일명의 <desc> 부분(예: 'catalog_core')
  sha256     TEXT    NOT NULL,                         -- 파일 바이트 sha256(소문자 hex 64)
  applied_at INTEGER NOT NULL,                         -- 적용 시각(epoch ms, UTC)
  PRIMARY KEY (module, version)
) STRICT;
