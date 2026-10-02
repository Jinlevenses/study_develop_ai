import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import type { InstallPackRequest } from '@fathom/contracts/http/content/v1/catalog';
import { createOutbox } from '@fathom/shared-kernel/eventing/eventing';
import type { JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import { createJobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { createUlidSequence, fixedUlid } from '@fathom/testkit/ids';
import type { PackInstaller } from '../../../src/application/catalog/install-pack.js';
import { createPackInstaller } from '../../../src/application/catalog/install-pack.js';
import type { Fixture, RecordingHandler } from '../../unit/catalog/support/db.js';
import { createMigratedHome, openContentDb, recordingHandler } from '../../unit/catalog/support/db.js';
import type { PackSpec, Tamper } from '../../unit/catalog/support/fpack-writer.js';
import { writeFpack } from '../../unit/catalog/support/fpack-writer.js';
import type { CapturedLog } from '../../unit/catalog/support/jobs.js';
import { captureLogger } from '../../unit/catalog/support/jobs.js';

export const JOB_ENTRY = fileURLToPath(new URL('./fixtures/job-entry.ts', import.meta.url));
export const EXEC_ARGV = ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning'];

export type RealCtx = {
  readonly fx: Fixture;
  readonly handler: RecordingHandler;
  readonly runner: JobRunner;
  readonly installer: PackInstaller;
  readonly log: CapturedLog;
  readonly packsDir: string;
  /** tx 소요(ms) — 설치 행 생성·활성화 tx가 모두 여기에 쌓인다. */
  readonly txMs: number[];
  req(source: InstallPackRequest['source'], over?: Partial<InstallPackRequest>): InstallPackRequest;
  put(spec: PackSpec, tamper?: Tamper): string;
  events(): { type: string; correlation_id: string; payload: Record<string, unknown> }[];
  ingestLog(): string[];
  close(): Promise<void>;
};

/** tx 시간을 재는 포트 래퍼(같은 연결을 쓴다). */
function timed(db: SqlitePort, sink: number[]): SqlitePort {
  return {
    path: db.path,
    readOnly: db.readOnly,
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    fn: (name, impl, o) => db.fn(name, impl, o),
    close: () => db.close(),
    tx: (fn) => {
      const t0 = performance.now();
      try {
        return db.tx(fn);
      } finally {
        sink.push(performance.now() - t0);
      }
    },
  };
}

/** 실제 자식 프로세스 job 실행기 + 마이그레이션된 임시 홈 + 실제 outbox. `wrap`으로 실행기를 감쌀 수 있다. */
export async function createRealCtx(wrap: (real: JobRunner) => JobRunner = (r) => r): Promise<RealCtx> {
  const home = await createMigratedHome();
  const rawDb = await openContentDb(home.dbFile);
  const txMs: number[] = [];
  const db = timed(rawDb, txMs);
  const clock = createFakeClock();
  const outbox = createOutbox({
    db,
    svc: 'content',
    clock,
    payloads: EVENT_PAYLOADS,
    currentTraceparent: () => null,
    onAppended: () => undefined,
    newId: createUlidSequence(500_000),
  });
  const real = createJobRunner({
    entry: JOB_ENTRY,
    execArgv: EXEC_ARGV,
    onStdoutLine: () => undefined,
    onStderrLine: () => undefined,
  });
  const runner = wrap(real);
  const handler = recordingHandler();
  const log = captureLogger({ clock } as Fixture);
  const packsDir = path.join(home.home, 'bundled');
  const fx: Fixture = { home, db, clock, outbox, newId: createUlidSequence(1000), close: () => undefined };
  let n = 1;
  return {
    fx,
    handler,
    runner,
    log,
    packsDir,
    txMs,
    installer: createPackInstaller({
      db,
      outbox,
      jobs: runner,
      clock,
      newId: fx.newId,
      log: log.logger,
      home: home.home,
      packsDir,
      ingest: { handlers: [handler] },
      loadTimeoutMs: 120_000,
    }),
    req: (source, over = {}) => ({
      install_id: fixedUlid(n++),
      source,
      channel: 'seed',
      allow_downgrade: false,
      ...over,
    }),
    put: (spec, tamper = {}) => writeFpack(packsDir, spec, tamper).file,
    events: () =>
      db
        .prepare('SELECT type, correlation_id, payload FROM outbox ORDER BY seq')
        .all()
        .map((r) => ({
          type: String(r.type),
          correlation_id: String(r.correlation_id),
          payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
        })),
    ingestLog(): string[] {
      try {
        return readFileSync(path.join(home.home, 'data', 'ingest-calls.log'), 'utf8')
          .split('\n')
          .filter((l) => l !== '');
      } catch {
        return [];
      }
    },
    async close(): Promise<void> {
      await real.shutdown();
      rawDb.close();
      home.cleanup();
    },
  };
}
