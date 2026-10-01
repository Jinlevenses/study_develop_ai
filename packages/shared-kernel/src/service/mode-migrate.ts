import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { infraMigrationsDir } from './infra-dir.js';
import type { SqliteRuntime } from './sqlite-loader.js';
import type { ServiceDefinitionBase } from './types.js';

// §4.3.4 migrate(DB-01 §11.2) — DB마다 `_infra` + 서비스 모듈을 적용한다. 파일이 없으면 `openDb`가 새로 만든다(D-31).

export type ModeEnv = {
  readonly clock: Clock;
  readonly log: Logger;
  readonly home: string;
  readonly runtime: () => Promise<SqliteRuntime>;
};

export async function runMigrate(
  def: ServiceDefinitionBase,
  env: ModeEnv,
  args: { readonly dryRun: boolean; readonly dbCopyDir: string | null },
): Promise<number> {
  const rt = await env.runtime();
  const dir = args.dbCopyDir ?? homePath(env.home, 'data');
  // `--dry-run`은 사본(`--db-copy-dir`)이 없을 때만 DB를 건드리지 않는다. 사본이 있으면 사본에 실제로 적용한다(T-00-04 [Brief 결정]).
  const dryRun = args.dryRun && args.dbCopyDir === null;
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
  }
  const report: Record<string, { applied: number; pending: number }> = {};
  for (const database of def.databases) {
    const file = path.join(dir, database.file);
    // dry-run인데 파일이 아직 없으면 빈 파일을 만들지 않도록 메모리 DB로 계산한다.
    const target = dryRun && !existsSync(file) ? ':memory:' : file;
    const db = rt.openDb(target, { synchronous: database.synchronous, recursiveTriggers: database.recursiveTriggers });
    try {
      const result = rt.migrate(db, [{ module: '_infra', dir: infraMigrationsDir() }, ...database.migrations], {
        dryRun,
        profile: database.profile,
        applicationId: database.applicationId,
        clock: env.clock,
      });
      if (!result.ok) {
        const f = result.error;
        env.log.fatal(
          { event: 'mode.migrate.failed', db: database.file, reason: f.reason, file: f.file },
          'migrate failed',
        );
        return f.exitCode;
      }
      report[database.file] = { applied: result.value.applied.length, pending: result.value.pending.length };
    } finally {
      db.close();
    }
  }
  env.log.info({ event: 'mode.migrate.completed', dry_run: dryRun, databases: report }, 'migrate completed');
  return 0;
}
