import { describe, expect, it } from 'vitest';
import { fixtureDraft } from '../../contract/ledger/ledger-fixtures.js';
import { openMigratedDb } from './support/db.js';
import { makeHarness } from './support/harness.js';

// 테스트 전용 직접 SQL — 변조 시도가 거부되는지 본다(쓰기 경로 검사는 check:ledger-writer가 src만 대상으로 한다).
const ROW =
  'event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at, ext, ext_v';

describe('원장 불변성', () => {
  it('UT-LR-067 recursive_triggers=ON 연결: REPLACE·INSERT OR REPLACE·UPDATE·DELETE 거부 [NFR-DATA-001]', async () => {
    const h = await makeHarness();
    expect(h.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
    const existing = h.db.prepare(`SELECT ${ROW} FROM lr_event WHERE device_seq = 2`).get();
    if (existing === undefined) {
      throw new Error('fixture');
    }
    const values = Object.values(existing).map((v) => (v === null ? null : (v as string | number)));
    const cols = Object.keys(existing).join(', ');
    const marks = values.map(() => '?').join(', ');
    // 같은 event_id(PK 충돌)를 덮어쓰려는 시도 — 암묵 DELETE도 트리거가 거부한다.
    expect(() => h.db.prepare(`REPLACE INTO lr_event(${cols}) VALUES (${marks})`).run(...values)).toThrow(
      /append-only/,
    );
    expect(() => h.db.prepare(`INSERT OR REPLACE INTO lr_event(${cols}) VALUES (${marks})`).run(...values)).toThrow(
      /append-only/,
    );
    expect(() => h.db.prepare('UPDATE lr_event SET payload = ?').run('{}')).toThrow(/append-only/);
    expect(() => h.db.prepare('DELETE FROM lr_event').run()).toThrow(/append-only/);
    expect(h.db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n).toBe(2);
    // 같은 (device, seq)·다른 event_id 덮어쓰기도 동일
    const clash = [...values];
    clash[0] = `${String(values[0]).slice(0, 25)}Z`;
    expect(() => h.db.prepare(`INSERT OR REPLACE INTO lr_event(${cols}) VALUES (${marks})`).run(...clash)).toThrow(
      /append-only/,
    );
    expect(h.db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n).toBe(2);
  });

  it('UT-LR-067 대조군: recursive_triggers=OFF 연결은 REPLACE가 덮어쓴다 — ON이 필요함을 증명 [NFR-DATA-001]', async () => {
    const db = await openMigratedDb(':memory:', { recursiveTriggers: false });
    const h = await makeHarness({ db });
    expect(h.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
    const row = db.prepare(`SELECT ${ROW} FROM lr_event WHERE device_seq = 2`).get();
    if (row === undefined) {
      throw new Error('fixture');
    }
    const values = Object.values(row).map((v) => (v === null ? null : (v as string | number)));
    const cols = Object.keys(row).join(', ');
    const marks = values.map(() => '?').join(', ');
    const idx = Object.keys(row).indexOf('payload');
    const changed = [...values];
    changed[idx] = '{"overwritten":true}';
    db.prepare(`REPLACE INTO lr_event(${cols}) VALUES (${marks})`).run(...changed);
    expect(db.prepare('SELECT payload FROM lr_event WHERE device_seq = 2').get()?.payload).toBe('{"overwritten":true}');
  });
});
