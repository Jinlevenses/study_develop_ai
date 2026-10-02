import { infraMigrationsDir } from '@fathom/shared-kernel/service/infra-dir';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { LEARNING_DB } from '../../../../src/infra/db/open.js';

// 마이그레이션이 끝난 learning.db(원장·투영 DDL 그대로) — `:memory:` 또는 파일. 연결 규칙은 LEARNING_DB(synchronous FULL + recursive_triggers ON).
export async function openMigratedDb(
  dbPath = ':memory:',
  opts: { readOnly?: boolean; recursiveTriggers?: boolean } = {},
): Promise<SqlitePort> {
  const rt = await loadSqliteRuntime();
  const migrationDirs = [{ module: '_infra', dir: infraMigrationsDir() }, ...LEARNING_DB.migrations];
  if (opts.readOnly !== true) {
    const writable = rt.openDb(dbPath, {
      synchronous: LEARNING_DB.synchronous,
      recursiveTriggers: opts.recursiveTriggers ?? LEARNING_DB.recursiveTriggers,
    });
    const res = rt.migrate(writable, migrationDirs, {
      dryRun: false,
      profile: LEARNING_DB.profile,
      applicationId: LEARNING_DB.applicationId,
      clock: createFakeClock(),
    });
    if (!res.ok) {
      throw new Error(`migrate failed: ${res.error.reason}: ${res.error.detail}`);
    }
    return writable;
  }
  return rt.openDb(dbPath, { readOnly: true, synchronous: LEARNING_DB.synchronous, recursiveTriggers: true });
}
