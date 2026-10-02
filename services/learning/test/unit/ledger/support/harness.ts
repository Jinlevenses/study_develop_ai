import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock, type FakeClock } from '@fathom/testkit/clock';
import { createUlidSequence } from '@fathom/testkit/ids';
import type {
  IntegrityAlarm,
  IntegrityAlarmKind,
  LedgerWriter,
  ProjectionApplier,
} from '../../../../src/application/ledger/ports.js';
import { NOOP_PROJECTION_APPLIER } from '../../../../src/application/ledger/ports.js';
import { createLedgerWriter } from '../../../../src/infra/ledger/ledger-writer.js';
import { GOLDEN_POLICY, GOLDEN_STUDY_DAY } from '../../../golden/ledger/payloads.js';
import { openMigratedDb } from './db.js';

export type RaisedAlarm = {
  kind: IntegrityAlarmKind;
  device_id?: string;
  device_seq?: number;
  event_id?: string;
  message: string;
};

export type Harness = {
  readonly db: SqlitePort;
  readonly clock: FakeClock;
  readonly newId: () => string;
  readonly alarms: RaisedAlarm[];
  readonly applied: LedgerEventEnvelope[];
  readonly writer: LedgerWriter;
};

/** 마이그레이션된 `:memory:` DB + 결정적 시계·ID + 경보 수집기 + 적용 기록 투영 가짜를 묶은 writer 하니스. */
export async function makeHarness(
  opts: {
    db?: SqlitePort;
    idStart?: number;
    applier?: ProjectionApplier;
    newId?: () => string;
    wrapDb?: (db: SqlitePort) => SqlitePort;
  } = {},
): Promise<Harness> {
  const rawDb = opts.db ?? (await openMigratedDb());
  const db = opts.wrapDb === undefined ? rawDb : opts.wrapDb(rawDb);
  const clock = createFakeClock();
  const newId = opts.newId ?? createUlidSequence(opts.idStart ?? 0);
  const alarms: RaisedAlarm[] = [];
  const applied: LedgerEventEnvelope[] = [];
  const alarm: IntegrityAlarm = {
    raise(kind, detail): void {
      alarms.push({ kind, ...detail });
    },
  };
  const base = opts.applier ?? NOOP_PROJECTION_APPLIER;
  const applier: ProjectionApplier = {
    apply(txDb, event): void {
      applied.push(event);
      base.apply(txDb, event);
    },
  };
  const writer = createLedgerWriter({
    db,
    clock,
    newId,
    applier,
    alarm,
    policySet: () => GOLDEN_POLICY,
    studyDay: GOLDEN_STUDY_DAY,
    platform: 'linux-x64',
  });
  return { db, clock, newId, alarms, applied, writer };
}
