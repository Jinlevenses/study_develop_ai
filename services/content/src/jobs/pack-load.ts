import { Ulid, Sha256Hex } from '@fathom/contracts/common/ids';
import { S } from '@fathom/contracts/common/schema';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { JobDefinition } from '@fathom/shared-kernel/jobs/jobs';
import { defineJob } from '@fathom/shared-kernel/jobs/jobs';
import type { SqliteRuntime } from '@fathom/shared-kernel/service/service';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { systemClock } from '@fathom/shared-kernel/time/time';
import { z } from 'zod';
import type { IngestRegistry } from '../application/catalog/ports.js';
import { PackLoadError, runPackLoad, sanitizeFailureCode } from '../application/catalog/ingest/pack-load-run.js';
import { CONTENT_DB } from '../infra/db/open.js';

// PGM-CT-002 job `pack-load`(STD-DIR-21: 파일 이름 = job 이름) — 단명 자식 프로세스에서 비활성 설치 범위 행을 적재한다.
// 서빙 프로세스는 막히지 않는다: 이 자식이 별도 연결로 쓰고, 부모는 `ready` 확인 뒤 활성화 tx만 잡는다(blue/green).

const PackLoadJobArgs = S({
  home: z.string().min(1).max(1024),
  install_id: Ulid,
  fpack_path: z.string().min(1).max(1024),
  expected_sha256: Sha256Hex,
});

export type PackLoadJobDeps = {
  readonly ingest: IngestRegistry;
  readonly runtime?: () => Promise<Pick<SqliteRuntime, 'openDb'>>;
  readonly clock?: Clock;
};

export function makePackLoadJob(deps: PackLoadJobDeps): JobDefinition {
  return defineJob('pack-load', async (rawArgs, ctx) => {
    const args = PackLoadJobArgs.parse(rawArgs);
    const runtime = await (deps.runtime ?? loadSqliteRuntime)();
    const db = runtime.openDb(homePath(args.home, 'data', CONTENT_DB.file), {
      synchronous: CONTENT_DB.synchronous,
      recursiveTriggers: CONTENT_DB.recursiveTriggers,
    });
    try {
      const result = runPackLoad(
        db,
        { ingest: deps.ingest, clock: deps.clock ?? systemClock },
        { install_id: args.install_id, fpack_path: args.fpack_path, expected_sha256: args.expected_sha256 },
        ctx,
      );
      return { ...result };
    } catch (e) {
      // 부모는 메시지를 `state_reason`에 옮긴다 — 코드 모양이 아닌 메시지(SQL·경로 포함 가능)는 `internal`로 가린다.
      throw new PackLoadError(sanitizeFailureCode(e instanceof Error ? e.message : String(e)), { cause: e });
    } finally {
      db.close();
    }
  });
}
