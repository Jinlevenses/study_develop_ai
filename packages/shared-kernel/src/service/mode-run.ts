import type { JobDefinition } from '@fathom/shared-kernel/jobs/jobs';
import { processJobChannel, serveJob } from '@fathom/shared-kernel/jobs/jobs';
import { makeIntegrityJob, makeSnapshotJob } from './default-jobs.js';
import type { ModeEnv } from './mode-migrate.js';
import { runMigrate } from './mode-migrate.js';
import { runRestore } from './mode-restore.js';
import type { ParsedMode } from './modes.js';
import type { ModeContext, ServiceDefinitionBase } from './types.js';

// serve 외 모드 실행기 — 봉투를 기다리지 않는다. 반환값 = 종료 코드.

const EXIT_USAGE = 64;

/** 기본 2개(`full` DB가 있을 때만) 중 `def.jobs`에 같은 이름이 있으면 그것으로 대체하고, 나머지 `def.jobs`를 더한다. 이름 중복 = invariant. */
export function resolveJobs(def: ServiceDefinitionBase, env: Pick<ModeEnv, 'runtime'>): JobDefinition[] {
  const own = def.jobs ?? [];
  const names = new Set<string>();
  for (const job of own) {
    if (names.has(job.name)) {
      throw new Error(`invariant: duplicate job ${job.name}`);
    }
    names.add(job.name);
  }
  const hasFull = def.databases.some((d) => d.profile === 'full');
  const defaults: JobDefinition[] = hasFull
    ? [makeSnapshotJob(def, env.runtime), makeIntegrityJob(def, env.runtime)]
    : [];
  return [...defaults.filter((d) => !names.has(d.name)), ...own];
}

export async function runNonServeMode(
  def: ServiceDefinitionBase,
  parsed: Exclude<ParsedMode, { mode: 'serve' }>,
  env: ModeEnv,
): Promise<number> {
  switch (parsed.mode) {
    case 'migrate':
      return runMigrate(def, env, parsed);
    case 'restore':
      return runRestore(def, env, parsed);
    case 'verify': {
      if (def.verify === undefined) {
        env.log.error({ event: 'mode.verify.unsupported' }, 'mode_unsupported');
        return EXIT_USAGE;
      }
      const ctx: ModeContext = {
        svc: def.svc,
        home: env.home,
        replay: parsed.replay,
        dbCopyDir: parsed.dbCopyDir,
        log: env.log,
        clock: env.clock,
        runtime: env.runtime,
      };
      return def.verify(ctx);
    }
    case 'job': {
      if (def.databases.length > 0) {
        await env.runtime(); // 경고 필터를 job 핸들러가 `node:sqlite`를 읽기 전에 건다
      }
      return serveJob(resolveJobs(def, env), processJobChannel());
    }
  }
}
