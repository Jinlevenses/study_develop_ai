import { LR_ERRORS } from '@fathom/contracts/http/learning/v1/errors';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { createMetrics } from '@fathom/shared-kernel/metrics/metrics';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { LEDGER_ERROR_MAP } from '../../../src/application/ledger/errors.js';
import type { IntegrityAlarmKind, LedgerFaultKind } from '../../../src/application/ledger/ports.js';
import { NOOP_PROJECTION_APPLIER } from '../../../src/application/ledger/ports.js';
import { createIntegrityAlarm } from '../../../src/infra/ledger/integrity-alarm.js';
import { createLedgerWriter } from '../../../src/infra/ledger/ledger-writer.js';
import { fixtureDraft } from '../../contract/ledger/ledger-fixtures.js';
import { GOLDEN_POLICY, GOLDEN_STUDY_DAY } from '../../golden/ledger/payloads.js';
import { openMigratedDb } from './support/db.js';

function setup() {
  const lines: string[] = [];
  const log = createLogger('learning', {
    level: 'info',
    bootId: null,
    clock: createFakeClock(1_790_000_000_000),
    destination: { write: (chunk) => void lines.push(chunk) },
  });
  const metrics = createMetrics();
  return { lines, alarm: createIntegrityAlarm(log, metrics), metrics };
}

describe('createIntegrityAlarm', () => {
  it('UT-LR-064 로그 1줄 · 필드 목록 · payload 원문 0 [STD-ERR-14]', () => {
    const { lines, alarm } = setup();
    alarm.raise('chain_broken', {
      device_id: '01J00000000000000000000000',
      device_seq: 7,
      event_id: '01J00000000000000000000009',
      message: 'ledger import chain broken: hash_mismatch',
    });
    expect(lines).toHaveLength(1);
    const line: Record<string, unknown> = JSON.parse(lines[0] ?? '{}');
    expect(line).toMatchObject({
      level: 'error',
      svc: 'learning',
      msg: 'ledger import chain broken: hash_mismatch',
      event: 'ledger.integrity_alarm',
      kind: 'chain_broken',
      device_id: '01J00000000000000000000000',
      device_seq: 7,
      event_id: '01J00000000000000000000009',
    });
    expect(Object.keys(line).sort()).toEqual(
      [
        'device_id',
        'device_seq',
        'event',
        'event_id',
        'kind',
        'level',
        'msg',
        'pid',
        'boot_id',
        'req_id',
        'svc',
        'ts',
      ].sort(),
    );
  });

  it('UT-LR-064 writer 경로의 경보 로그에도 payload·답안 값이 없다 [STD-ERR-14][NFR-DATA-001]', async () => {
    const { lines, alarm } = setup();
    const secret = 'LEARNER-ANSWER-SECRET-TEXT';
    let n = 0;
    let broken = false;
    const db = await openMigratedDb();
    const clock = createFakeClock(1_790_000_000_000);
    const newId = (): string => {
      n += 1;
      return broken ? 'SHORT' : fixedUlid(n);
    };
    // 실제 writer의 경보 포트에 로그 경보를 단다 — end-to-end.
    const writer = createLedgerWriter({
      db,
      clock,
      newId,
      applier: NOOP_PROJECTION_APPLIER,
      alarm,
      policySet: () => GOLDEN_POLICY,
      studyDay: GOLDEN_STUDY_DAY,
      platform: 'linux-x64',
    });
    expect(writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
    broken = true; // event_id CHECK 위반 → OR IGNORE 묵살 → check_swallowed 경보
    const draft = fixtureDraft('self_assessment.recorded');
    const res = writer.append({ ...draft, payload: { ...draft.payload, target: { kind: 'concept', id: secret } } });
    expect(!res.ok && res.error.kind).toBe('check_swallowed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(secret);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ kind: 'check_swallowed', event: 'ledger.integrity_alarm' });
  });

  it('UT-LR-065 카운터 ledger_integrity_alarm_total{kind} 증가 [STD-ERR-14]', () => {
    const { alarm, metrics } = setup();
    alarm.raise('fsrs_validation', { message: 'm' });
    alarm.raise('fsrs_validation', { message: 'm' });
    alarm.raise('anchor_mismatch', { message: 'm' });
    const text = metrics.render();
    expect(text).toContain('ledger_integrity_alarm_total{kind="fsrs_validation"} 2');
    expect(text).toContain('ledger_integrity_alarm_total{kind="anchor_mismatch"} 1');
    const kinds: IntegrityAlarmKind[] = [
      'fsrs_validation',
      'chain_conflict',
      'check_swallowed',
      'chain_broken',
      'anchor_mismatch',
    ];
    expect(kinds).toHaveLength(5);
  });

  it('UT-LR-066 LEDGER_ERROR_MAP 8종 전부 LR-INTERNAL-001 [STD-ERR-14]', () => {
    const kinds: LedgerFaultKind[] = [
      'payload_invalid',
      'key_invalid',
      'schema_version_unsupported',
      'chain_conflict',
      'check_swallowed',
      'chain_broken',
      'anchor_mismatch',
      'projection_invalid',
    ];
    expect(Object.keys(LEDGER_ERROR_MAP).sort()).toEqual([...kinds].sort());
    for (const k of kinds) {
      expect(LEDGER_ERROR_MAP[k]).toBe('LR-INTERNAL-001');
    }
    expect(LR_ERRORS['LR-INTERNAL-001'].status).toBe(500);
  });
});
