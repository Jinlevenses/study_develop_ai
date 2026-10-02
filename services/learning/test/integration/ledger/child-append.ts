import { createInterface } from 'node:readline';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { createUlidSequence } from '@fathom/testkit/ids';
import type { IntegrityAlarmKind } from '../../../src/application/ledger/ports.js';
import { NOOP_PROJECTION_APPLIER } from '../../../src/application/ledger/ports.js';
import { learningDbOptions } from '../../../src/infra/db/open.js';
import { createLedgerWriter } from '../../../src/infra/ledger/ledger-writer.js';
import { fixturePayload } from '../../contract/ledger/ledger-fixtures.js';
import { GOLDEN_POLICY, GOLDEN_STUDY_DAY } from '../../golden/ledger/payloads.js';

// IT-331·332 자식 프로세스: 마이그레이션된 파일 DB에 lesson.completed를 계속 append한다.
// 사용: child-append.ts <dbPath> <count> <idStart> <mode: free|wait>   (wait = stdin 한 줄을 받을 때까지 대기해 동시 시작을 맞춘다)
const [dbPath, countArg, idStartArg, mode] = process.argv.slice(2);
if (dbPath === undefined || countArg === undefined || idStartArg === undefined) {
  throw new Error('usage: child-append.ts <dbPath> <count> <idStart> <mode>');
}
const alarms: IntegrityAlarmKind[] = [];
const db = openDb(dbPath, learningDbOptions(false));
const newId = createUlidSequence(Number(idStartArg));
const clock = createFakeClock(1_790_000_000_000);
const writer = createLedgerWriter({
  db,
  clock,
  newId,
  applier: NOOP_PROJECTION_APPLIER,
  alarm: { raise: (kind) => void alarms.push(kind) },
  policySet: () => GOLDEN_POLICY,
  studyDay: GOLDEN_STUDY_DAY,
  platform: 'child',
});

if (mode === 'wait') {
  process.stdout.write('ready\n');
  const rl = createInterface({ input: process.stdin });
  await new Promise<void>((resolve) => {
    rl.once('line', () => {
      rl.close();
      resolve();
    });
  });
}
const payload = fixturePayload('lesson.completed');
for (let i = 0; i < Number(countArg); i += 1) {
  clock.advance(1000);
  const res = writer.append({ type: 'lesson.completed', idempotency_key: `cmd:${newId()}:theory`, payload });
  if (!res.ok) {
    process.stdout.write(`fault ${res.error.kind}\n`);
    process.exit(3);
  }
  process.stdout.write(`ack ${i + 1}\n`);
}
process.stdout.write(`done alarms=${alarms.length}\n`);
db.close();
