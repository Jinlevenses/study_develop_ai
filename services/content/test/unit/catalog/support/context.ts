import path from 'node:path';
import type { InstallPackRequest } from '@fathom/contracts/http/content/v1/catalog';
import { fixedUlid } from '@fathom/testkit/ids';
import type { PackInstaller } from '../../../../src/application/catalog/install-pack.js';
import { createPackInstaller } from '../../../../src/application/catalog/install-pack.js';
import type { Fixture, RecordingHandler } from './db.js';
import { createFixture, recordingHandler } from './db.js';
import type { PackSpec } from './fpack-writer.js';
import { writeFpack } from './fpack-writer.js';
import type { CapturedLog, FakeJobs } from './jobs.js';
import { captureLogger, inProcessJobs } from './jobs.js';

// 설치 흐름 테스트 공용 컨텍스트 — 실제 PackInstaller + 같은 프로세스 job 실행기 + 기록용 핸들러.
export type Ctx = {
  fx: Fixture;
  handler: RecordingHandler;
  jobs: FakeJobs;
  log: CapturedLog;
  installer: PackInstaller;
  packsDir: string;
  req(source: InstallPackRequest['source'], over?: Partial<InstallPackRequest>): InstallPackRequest;
  put(spec: PackSpec): string;
  events(): { type: string; correlation_id: string; payload: Record<string, unknown> }[];
};

export async function createCtx(): Promise<Ctx> {
  const fx = await createFixture();
  const handler = recordingHandler();
  const ingest = { handlers: [handler] };
  const jobs = inProcessJobs(fx, ingest);
  const log = captureLogger(fx);
  const packsDir = path.join(fx.home.home, 'bundled');
  let n = 1;
  return {
    fx,
    handler,
    jobs,
    log,
    packsDir,
    installer: createPackInstaller({
      db: fx.db,
      outbox: fx.outbox,
      jobs,
      clock: fx.clock,
      newId: fx.newId,
      log: log.logger,
      home: fx.home.home,
      packsDir,
      ingest,
    }),
    req: (source, over = {}) => ({
      install_id: fixedUlid(n++),
      source,
      channel: 'seed',
      allow_downgrade: false,
      ...over,
    }),
    put: (spec) => writeFpack(packsDir, spec).file,
    events: () =>
      fx.db
        .prepare('SELECT type, correlation_id, payload FROM outbox ORDER BY seq')
        .all()
        .map((r) => ({
          type: String(r.type),
          correlation_id: String(r.correlation_id),
          payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
        })),
  };
}
