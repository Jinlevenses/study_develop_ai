import type { ServiceName } from '@fathom/contracts/common/ids';
import type { FakeClock } from '@fathom/testkit/clock';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import type { AppInternals, AssembleExtras } from '../../../src/service/app.js';
import { assembleApp } from '../../../src/service/app.js';
import type {
  ServiceAppHandle,
  ServiceAppRuntime,
  ServiceDatabase,
  ServiceDefinition,
} from '../../../src/service/types.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import type { LogCapture } from '../eventing/support.js';
import { captureLogger, openInfraDb } from '../eventing/support.js';

export { TEST_CALLER_TOKENS };
export const OPS = { authorization: `Bearer ${TEST_CALLER_TOKENS['ops-api']}` };
export const GATEWAY = { authorization: `Bearer ${TEST_CALLER_TOKENS.gateway}` };
export const LEARNING = { authorization: `Bearer ${TEST_CALLER_TOKENS.learning}` };

export const FULL_DB: ServiceDatabase = {
  file: 'content.db',
  applicationId: 1_700_000_002,
  profile: 'full',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: [],
};

export function defOf(svc: ServiceName, over: Partial<ServiceDefinition<null>> = {}): ServiceDefinition<null> {
  const hasDb = svc !== 'gateway';
  return {
    svc,
    entry: '/nonexistent/main.ts',
    contractsHash: null,
    databases: hasDb ? [{ ...FULL_DB, file: `${svc === 'ops-api' ? 'ops' : svc}.db` }] : [],
    peers: [],
    events: null,
    inbox: null,
    register: () => undefined,
    ...over,
  };
}

export type Rig = {
  readonly app: ServiceAppHandle;
  readonly clock: FakeClock;
  readonly cap: LogCapture;
  readonly db: SqlitePort | null;
  readonly internals: AppInternals;
  close(): Promise<void>;
};

export async function rigOf(
  def: ServiceDefinition<null>,
  over: Partial<ServiceAppRuntime> = {},
  extras: AssembleExtras<null> = {},
): Promise<Rig> {
  const clock = createFakeClock();
  const cap = captureLogger(clock, 'info');
  const file = def.databases[0]?.file;
  const db = file === undefined ? null : openInfraDb(clock);
  const dbs = db === null || file === undefined ? {} : { [file]: db };
  const internals = await assembleApp(def, {
    callerTokens: TEST_CALLER_TOKENS,
    clock,
    home: '/tmp/fathom-test-home',
    log: cap.log,
    dbs,
    ...over,
    ...extras,
  });
  const app = internals.handle;
  return {
    app,
    clock,
    cap,
    db,
    internals,
    async close(): Promise<void> {
      await app.close();
      db?.close();
    },
  };
}
