import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { createCheckpoint, readLedgerHeads } from '../../../src/application/ledger/checkpoint.js';
import { inspectLedger, verifyLedger } from '../../../src/application/ledger/verify.js';
import { eventHash } from '../../../src/domain/ledger/chain/hash.js';
import { NODE_HASH_PORT } from '../../../src/infra/ledger/hash-port.js';
import { fixtureDraft } from '../../contract/ledger/ledger-fixtures.js';
import { envelopeChain } from './support/chains.js';
import { openMigratedDb } from './support/db.js';
import { makeHarness } from './support/harness.js';

const DEV_B = fixedUlid(2);
const checkpoints = (db: SqlitePort): Record<string, unknown>[] =>
  db.prepare('SELECT * FROM lr_checkpoint ORDER BY created_at, checkpoint_id').all();

/** 로컬 기기(append) 4건 + 원격 기기 B(import) 3건 + 체크포인트 1개. */
async function ledgerWithCheckpoint() {
  const h = await makeHarness();
  for (const type of ['card.enrolled', 'card.status_changed', 'lesson.completed'] as const) {
    h.clock.set(10_000);
    expect(h.writer.append(fixtureDraft(type)).ok).toBe(true);
  }
  h.db.tx(() => expect(h.writer.importInTx(envelopeChain(DEV_B, [1, 2, 3], 7)).ok).toBe(true));
  const cp = h.db.tx(() => createCheckpoint(h.db, { clock: h.clock, newId: h.newId }, 'local'));
  return { h, cp };
}

/** 테스트 전용: 불변 트리거를 잠시 풀고 변조한다(실제 변조자 모사). */
function tamper(db: SqlitePort, sql: string): void {
  db.exec('DROP TRIGGER lr_event_no_update');
  db.exec('DROP TRIGGER lr_event_no_delete');
  db.exec(sql);
}

describe('createCheckpoint', () => {
  it('UT-LR-050 devices_json·root_hash 기록, append-only 트리거 [FR-PRG-003][CR-27]', async () => {
    const { h, cp } = await ledgerWithCheckpoint();
    const heads = readLedgerHeads(h.db);
    expect(Object.keys(heads)).toEqual(expect.arrayContaining([fixedUlid(0), DEV_B]));
    expect(heads[DEV_B]?.seq).toBe(3);
    const [row] = checkpoints(h.db);
    expect(row).toMatchObject({
      checkpoint_id: cp.checkpoint_id,
      kind: 'local',
      root_hash: cp.root_hash,
      source_file_sha256: null,
      projection_hash: null,
    });
    expect(row?.devices_json).toBe(canonicalJson(heads));
    expect(cp.root_hash).toBe(sha256Hex(canonicalJson(heads)));
    expect(cp.devices).toEqual(heads);
    // append-only: UPDATE·DELETE 거부
    expect(() => h.db.prepare('UPDATE lr_checkpoint SET kind = ?').run('export')).toThrow(/append-only/);
    expect(() => h.db.prepare('DELETE FROM lr_checkpoint').run()).toThrow(/append-only/);
    // extras·kind
    const second = h.db.tx(() =>
      createCheckpoint(h.db, { clock: h.clock, newId: h.newId }, 'merge', {
        source_file_sha256: 'a'.repeat(64),
        projection_hash: 'b'.repeat(64),
      }),
    );
    const merged = checkpoints(h.db).find((r) => r.checkpoint_id === second.checkpoint_id);
    expect(merged).toMatchObject({
      kind: 'merge',
      source_file_sha256: 'a'.repeat(64),
      projection_hash: 'b'.repeat(64),
    });
  });

  it('UT-LR-050 빈 원장 체크포인트 = devices {} (root = sha256("{}")) [FR-PRG-003][CR-27]', async () => {
    const db = await openMigratedDb();
    const h = await makeHarness({ db });
    const cp = db.tx(() => createCheckpoint(db, { clock: h.clock, newId: h.newId }, 'epoch'));
    expect(cp.devices).toEqual({});
    expect(cp.root_hash).toBe(sha256Hex('{}'));
  });
});

describe('verifyLedger', () => {
  it('UT-LR-051 최신 체크포인트를 자동 대조: 정상·이후 정상 append는 통과 [FR-PRG-003][CR-27]', async () => {
    const { h, cp } = await ledgerWithCheckpoint();
    const ok = verifyLedger(h.db);
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.value.devices[DEV_B]?.seq).toBe(3);
    expect(inspectLedger(h.db).anchor).toBe('checkpoint');
    h.clock.set(20_000);
    expect(h.writer.append(fixtureDraft('profile.setting_changed')).ok).toBe(true); // 앵커 이후 append
    expect(verifyLedger(h.db).ok).toBe(true);
    expect(cp.checkpoint_id).toHaveLength(26);
  });

  it('UT-LR-051 꼬리 재해시 변조·꼬리 절단 → anchor_mismatch(head_mismatch·truncated) [FR-PRG-003][CR-27]', async () => {
    const { h } = await ledgerWithCheckpoint();
    const last = h.db
      .prepare('SELECT * FROM lr_event WHERE device_id = ? ORDER BY device_seq DESC LIMIT 1')
      .get(fixedUlid(0));
    if (last === undefined) {
      throw new Error('fixture');
    }
    // 마지막 행 payload 변조 + hash 재계산 — 체인은 자기 일관적이다.
    const payload = '{"card_id":"k8s.probes:definition:p","concept_id":"k8s.probes","study_day":"2026-09-21"}';
    const forged = eventHash(NODE_HASH_PORT, {
      event_id: String(last.event_id),
      device_id: String(last.device_id),
      device_seq: Number(last.device_seq),
      client_ts: Number(last.client_ts),
      type: String(last.type),
      schema_version: Number(last.schema_version),
      idempotency_key: String(last.idempotency_key),
      payload: JSON.parse(payload),
      prev_hash: String(last.prev_hash),
    });
    tamper(
      h.db,
      `UPDATE lr_event SET payload = '${payload}', hash = '${forged}' WHERE event_id = '${String(last.event_id)}'`,
    );
    const inspected = inspectLedger(h.db);
    expect(inspected.report.breaks).toEqual([]); // 체인만으로는 못 잡는다
    expect(inspected.anchor_violations).toEqual([{ device_id: fixedUlid(0), reason: 'head_mismatch' }]);
    const res = verifyLedger(h.db);
    expect(!res.ok && res.error).toMatchObject({
      kind: 'anchor_mismatch',
      detail: 'head_mismatch',
      device_id: fixedUlid(0),
    });

    // 꼬리 절단(원격 기기 B의 마지막 2건 삭제)
    h.db.exec(`DELETE FROM lr_event WHERE device_id = '${DEV_B}' AND device_seq >= 2`);
    const truncated = verifyLedger(h.db);
    expect(truncated.ok).toBe(false);
    expect(inspectLedger(h.db).anchor_violations).toEqual([
      { device_id: fixedUlid(0), reason: 'head_mismatch' },
      { device_id: DEV_B, reason: 'truncated' },
    ]);
  });

  it('UT-LR-052 원격 기기 누락 = device_missing [FR-PRG-003][CR-27]', async () => {
    const { h } = await ledgerWithCheckpoint();
    tamper(h.db, `DELETE FROM lr_event WHERE device_id = '${DEV_B}'`);
    const res = verifyLedger(h.db);
    expect(!res.ok && res.error).toMatchObject({ kind: 'anchor_mismatch', detail: 'device_missing', device_id: DEV_B });
  });

  it('UT-LR-053 anchor 인자가 체크포인트보다 우선, 앵커 없으면 체인만 검사 [FR-PRG-003][CR-27]', async () => {
    const { h, cp } = await ledgerWithCheckpoint();
    const given = { [DEV_B]: { seq: 3, head_hash: 'f'.repeat(64) } };
    const res = verifyLedger(h.db, { anchor: given });
    expect(!res.ok && res.error.detail).toBe('head_mismatch');
    expect(inspectLedger(h.db, { anchor: given }).anchor).toBe('given');
    expect(verifyLedger(h.db, { anchor: cp.devices }).ok).toBe(true);

    const empty = await makeHarness();
    empty.writer.append(fixtureDraft('card.enrolled'));
    expect(inspectLedger(empty.db).anchor).toBe('none');
    expect(verifyLedger(empty.db).ok).toBe(true);
  });

  it('UT-LR-054 최신 체크포인트가 기준(오래된 것이 아니다) [FR-PRG-003][CR-27]', async () => {
    const { h } = await ledgerWithCheckpoint();
    h.clock.set(30_000);
    expect(h.writer.append(fixtureDraft('profile.setting_changed')).ok).toBe(true);
    h.clock.set(40_000);
    h.db.tx(() => createCheckpoint(h.db, { clock: h.clock, newId: h.newId }, 'export'));
    // 가장 최근 행 삭제 → 최신 체크포인트와 어긋남. (첫 번째 체크포인트만 보면 놓친다)
    tamper(h.db, `DELETE FROM lr_event WHERE device_id = '${fixedUlid(0)}' AND device_seq = 5`);
    const res = verifyLedger(h.db);
    expect(!res.ok && res.error.detail).toBe('truncated');
  });
});
