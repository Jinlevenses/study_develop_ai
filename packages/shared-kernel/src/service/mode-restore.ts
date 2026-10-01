import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { rewindCursors } from '../eventing/rewind.js';
import { infraMigrationsDir } from './infra-dir.js';
import { APP_ID_GET, INTEGRITY_CHECK, JOURNAL_MODE_WAL } from './maintenance.sql.js';
import type { ModeEnv } from './mode-migrate.js';
import type { SqliteRuntime } from './sqlite-loader.js';
import type { ServiceDatabase, ServiceDefinitionBase } from './types.js';

// §4.3.4 restore(DB-01 §12.3-3 일반부). 라이브 파일이 닫혀 있음은 호출자(supervisor `svc.stop` 후 `svc.run_mode`)가 보장한다 [Brief 결정].

const EXIT_DATA = 78;
const EXIT_IO = 70;

type Step = { readonly code: number } | null;

function integrityOk(rows: readonly Record<string, unknown>[]): boolean {
  const [first] = rows;
  return rows.length === 1 && first !== undefined && first.integrity_check === 'ok';
}

function removeQuietly(file: string): void {
  rmSync(file, { force: true });
}

/** 원본 사본의 `application_id`·`integrity_check`를 읽기 전용으로 검사한다. 통과 = null. */
function verifySource(rt: SqliteRuntime, source: string, database: ServiceDatabase, env: ModeEnv): Step {
  let src: SqlitePort;
  try {
    src = rt.openDb(source, { readOnly: true, synchronous: 'NORMAL' });
  } catch {
    env.log.fatal({ event: 'mode.restore.failed', db: database.file, reason: 'source_unreadable' }, 'restore failed');
    return { code: EXIT_DATA };
  }
  try {
    const appId = Number(src.prepare(APP_ID_GET).get()?.application_id ?? 0);
    if (appId !== database.applicationId) {
      env.log.fatal(
        { event: 'mode.restore.failed', db: database.file, reason: 'application_id_mismatch' },
        'restore failed',
      );
      return { code: EXIT_DATA };
    }
    if (!integrityOk(src.prepare(INTEGRITY_CHECK).all())) {
      env.log.fatal(
        { event: 'mode.restore.failed', db: database.file, reason: 'source_integrity_failed' },
        'restore failed',
      );
      return { code: EXIT_DATA };
    }
    return null;
  } catch {
    env.log.fatal({ event: 'mode.restore.failed', db: database.file, reason: 'source_unreadable' }, 'restore failed');
    return { code: EXIT_DATA };
  } finally {
    src.close();
  }
}

function restoreFull(
  def: ServiceDefinitionBase,
  rt: SqliteRuntime,
  env: ModeEnv,
  database: ServiceDatabase,
  args: { from: string; rewind: Readonly<Partial<Record<ServiceName, number>>> },
): Step {
  const source = path.join(args.from, database.file);
  if (!existsSync(source)) {
    env.log.fatal({ event: 'mode.restore.failed', db: database.file, reason: 'source_missing' }, 'restore failed');
    return { code: EXIT_DATA };
  }
  const bad = verifySource(rt, source, database, env);
  if (bad !== null) {
    return bad;
  }
  const live = homePath(env.home, 'data', database.file);
  const tmp = `${live}.restore-tmp`;
  removeQuietly(`${live}-wal`);
  removeQuietly(`${live}-shm`);
  copyFileSync(source, tmp);
  renameSync(tmp, live);
  const db = rt.openDb(live, { synchronous: database.synchronous, recursiveTriggers: database.recursiveTriggers });
  try {
    db.prepare(JOURNAL_MODE_WAL).get();
    const rewound = rewindCursors(db, args.rewind, env.clock);
    const check = def.restoreCheck?.(db, { from: args.from });
    if (check !== undefined && !check.ok) {
      env.log.fatal({ event: 'mode.restore.failed', db: database.file, reason: check.error.code }, 'restore failed');
      return { code: EXIT_DATA };
    }
    if (!integrityOk(db.prepare(INTEGRITY_CHECK).all())) {
      env.log.fatal(
        { event: 'mode.restore.failed', db: database.file, reason: 'restored_integrity_failed' },
        'restore failed',
      );
      return { code: EXIT_DATA };
    }
    env.log.info({ event: 'mode.restore.db', db: database.file, rewound_cursors: rewound }, 'database restored');
    return null;
  } finally {
    db.close();
  }
}

/** `meta` DB(파생 — insight.db·ai-cache.db)는 파일·wal·shm을 지우고 migrate로 다시 만든다. */
function recreateMeta(rt: SqliteRuntime, env: ModeEnv, database: ServiceDatabase): Step {
  const live = homePath(env.home, 'data', database.file);
  for (const suffix of ['', '-wal', '-shm']) {
    removeQuietly(`${live}${suffix}`);
  }
  const db = rt.openDb(live, { synchronous: database.synchronous, recursiveTriggers: database.recursiveTriggers });
  try {
    const result = rt.migrate(db, [{ module: '_infra', dir: infraMigrationsDir() }, ...database.migrations], {
      dryRun: false,
      profile: 'meta',
      applicationId: database.applicationId,
      clock: env.clock,
    });
    if (!result.ok) {
      env.log.fatal({ event: 'mode.restore.failed', db: database.file, reason: result.error.reason }, 'restore failed');
      return { code: result.error.exitCode };
    }
    return null;
  } finally {
    db.close();
  }
}

export async function runRestore(
  def: ServiceDefinitionBase,
  env: ModeEnv,
  args: { readonly from: string; readonly rewind: Readonly<Partial<Record<ServiceName, number>>> },
): Promise<number> {
  const rt = await env.runtime();
  try {
    for (const database of def.databases) {
      const step =
        database.profile === 'full' ? restoreFull(def, rt, env, database, args) : recreateMeta(rt, env, database);
      if (step !== null) {
        return step.code;
      }
    }
  } catch (e) {
    env.log.fatal({ event: 'mode.restore.failed', reason: 'io', err: e }, 'restore failed');
    return EXIT_IO;
  }
  env.log.info({ event: 'mode.restore.completed', from: args.from }, 'restore completed');
  return 0;
}
