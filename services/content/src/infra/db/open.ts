import { fileURLToPath } from 'node:url';
import { assertDefined } from '@fathom/shared-kernel/errors/errors';
import type { ServiceDatabase, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { MigrationDir, SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

// DB-01 §2 content 행 — application_id 'FTCT'(0x46544354) · NORMAL · 모듈 적용 순서 catalog → acquisition → itembank → grading → runner.
// URL은 항목마다 리터럴이다(문자열 연결 0, STD-TS-42). `src/infra/db/`·`dist/infra/db/` 모두 `services/content/migrations/<m>/`가 된다.
export const CONTENT_MIGRATIONS: readonly MigrationDir[] = [
  { module: 'catalog', dir: fileURLToPath(new URL('../../../migrations/catalog/', import.meta.url)) },
  { module: 'acquisition', dir: fileURLToPath(new URL('../../../migrations/acquisition/', import.meta.url)) },
  { module: 'itembank', dir: fileURLToPath(new URL('../../../migrations/itembank/', import.meta.url)) },
  { module: 'grading', dir: fileURLToPath(new URL('../../../migrations/grading/', import.meta.url)) },
  { module: 'runner', dir: fileURLToPath(new URL('../../../migrations/runner/', import.meta.url)) },
];

export const CONTENT_DB: ServiceDatabase = {
  file: 'content.db',
  applicationId: 0x46544354,
  profile: 'full',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: CONTENT_MIGRATIONS,
};

/** 열려 있는 `content.db` 연결 — 키가 없으면 결함. */
export function contentDb(deps: ServiceDeps<unknown>): SqlitePort {
  return assertDefined(deps.dbs[CONTENT_DB.file], 'content.db not opened');
}
