import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { createCheckpoint } from '../../../src/application/ledger/checkpoint.js';
import { parseLedgerJsonl, readExportEvents, serializeLedgerJsonl } from '../../../src/application/ledger/jsonl.js';
import { createLedgerReplayReader } from '../../../src/infra/ledger/replay-source.js';
import { fixtureDraft, LEDGER_TYPES } from '../../contract/ledger/ledger-fixtures.js';
import { envelopeChain } from './support/chains.js';
import { openMigratedDb } from './support/db.js';
import { makeHarness } from './support/harness.js';

const DEV_A = fixedUlid(1);
const DEV_B = fixedUlid(2);
const rowCount = (h: { db: { prepare(sql: string): { get(): Record<string, unknown> | undefined } } }): number =>
  Number(h.db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n);

describe('importInTx', () => {
  it('UT-LR-061 정상 체인 적재 + 재적재 멱등(duplicates = n), 투영 호출 0 [FR-SET-022][FR-PRG-003]', async () => {
    const h = await makeHarness();
    const a = envelopeChain(DEV_A, [1_000, 2_000, 3_000], 1);
    const b = envelopeChain(DEV_B, [1_000, 2_500], 2);
    const first = h.db.tx(() => h.writer.importInTx([...b, ...a]));
    expect(first).toEqual({ ok: true, value: { inserted: 5, duplicates: 0 } });
    expect(h.applied).toEqual([]); // 투영 호출 0 — 호출자가 rebuild
    const devices = h.db.prepare('SELECT device_id, is_local FROM lr_device ORDER BY device_id').all();
    expect(devices).toEqual([
      { device_id: DEV_A, is_local: 0 },
      { device_id: DEV_B, is_local: 0 },
    ]);
    const stored = h.db
      .prepare('SELECT event_id, hash, prev_hash, payload FROM lr_event WHERE device_id = ? ORDER BY device_seq')
      .all(DEV_A);
    expect(stored.map((r) => r.hash)).toEqual(a.map((e) => e.hash));
    expect(stored.map((r) => r.prev_hash)).toEqual(a.map((e) => e.prev_hash));
    const before = rowCount(h);

    const again = h.db.tx(() => h.writer.importInTx([...a, ...b]));
    expect(again).toEqual({ ok: true, value: { inserted: 0, duplicates: 5 } });
    expect(rowCount(h)).toBe(before);
    // 증분 import: 이미 가진 앞부분 + 새 꼬리 (연속성은 로컬의 직전 행에서 이어진다)
    const longer = envelopeChain(DEV_A, [1_000, 2_000, 3_000, 4_000, 5_000], 1);
    const inc = h.db.tx(() => h.writer.importInTx(longer.slice(3)));
    expect(inc).toEqual({ ok: true, value: { inserted: 2, duplicates: 0 } });
    expect(rowCount(h)).toBe(before + 2);
  });

  it('UT-LR-062 체인 끊김 = 쓰기 0 + chain_broken 경보(기기·seq 보고) [FR-PRG-003][FR-SET-022]', async () => {
    const h = await makeHarness();
    const a = envelopeChain(DEV_A, [1_000, 2_000, 3_000, 4_000], 1);
    const tampered = a.map((e) => (e.device_seq === 3 ? { ...e, payload: { ...e.payload, status: 'retired' } } : e));
    const res = h.db.tx(() => h.writer.importInTx([...envelopeChain(DEV_B, [1, 2], 2), ...tampered]));
    expect(!res.ok && res.error).toMatchObject({
      kind: 'chain_broken',
      detail: 'hash_mismatch',
      device_id: DEV_A,
      device_seq: 3,
    });
    expect(rowCount(h)).toBe(0);
    expect(h.alarms).toHaveLength(1);
    expect(h.alarms[0]).toMatchObject({ kind: 'chain_broken', device_id: DEV_A, device_seq: 3 });
    expect(h.db.prepare('SELECT count(*) AS n FROM lr_device').get()?.n).toBe(0);

    // 번호 공백(증분 import인데 로컬에 직전 행이 없다)
    const gap = h.db.tx(() => h.writer.importInTx(a.slice(2)));
    expect(!gap.ok && gap.error).toMatchObject({ kind: 'chain_broken', detail: 'seq_gap', device_seq: 3 });

    // 같은 키·다른 event_id의 행은 이미 있는 행과 충돌 = chain_broken
    h.db.tx(() => h.writer.importInTx(a));
    const clash = { ...a[0], event_id: fixedUlid(777) };
    const conflictRes = h.db.tx(() => h.writer.importInTx(a.length > 0 ? [clash as (typeof a)[number]] : []));
    expect(conflictRes.ok).toBe(false);
  });

  it('UT-LR-063 anchor 불일치 = err(anchor_mismatch) + 경보, 호출자 tx가 롤백 [FR-SET-022][FR-PRG-003]', async () => {
    const h = await makeHarness();
    const a = envelopeChain(DEV_A, [1_000, 2_000, 3_000], 1);
    const good = { [DEV_A]: { seq: 3, head_hash: a[2]?.hash ?? '' } };
    expect(h.db.tx(() => h.writer.importInTx(a, good))).toEqual({ ok: true, value: { inserted: 3, duplicates: 0 } });

    const h2 = await makeHarness();
    const bad = { [DEV_A]: { seq: 3, head_hash: 'f'.repeat(64) } };
    const outcome = (): unknown =>
      h2.db.tx(() => {
        const res = h2.writer.importInTx(a, bad);
        if (!res.ok) {
          throw new Error(`rollback:${res.error.kind}:${res.error.detail}`);
        }
        return res;
      });
    expect(outcome).toThrow('rollback:anchor_mismatch:head_mismatch');
    expect(rowCount(h2)).toBe(0);
    expect(h2.alarms.map((x) => x.kind)).toEqual(['anchor_mismatch']);

    const h3 = await makeHarness();
    const missing = { [DEV_B]: { seq: 1, head_hash: 'a'.repeat(64) } };
    const res = h3.db.tx(() => h3.writer.importInTx(a, missing));
    expect(!res.ok && res.error).toMatchObject({ kind: 'anchor_mismatch', detail: 'device_missing', device_id: DEV_B });
  });
});

describe('JSONL', () => {
  it('UT-LR-068 export/parse 왕복(header·footer lines_sha256), payload는 저장 문자열 그대로 [FR-SET-022]', async () => {
    const h = await makeHarness();
    for (const [i, type] of LEDGER_TYPES.entries()) {
      h.clock.set(1_000_000 + i * 10);
      expect(h.writer.append(fixtureDraft(type)).ok).toBe(true);
    }
    const events = readExportEvents(h.db);
    expect(events.length).toBe(17); // 초기 policy.switched + 16종(policy.switched 표본은 같은 키 = duplicate)
    expect(events.map((e) => e.device_seq)).toEqual(events.map((_, i) => i + 1));
    const cp = h.db.tx(() => createCheckpoint(h.db, { clock: h.clock, newId: h.newId }, 'export'));
    const header = {
      kind: 'header' as const,
      format: 'fathom.ledger.v1' as const,
      app_version: '1.0.0',
      created_at: h.clock.now(),
      source_device_id: fixedUlid(0),
      since_checkpoint_id: null,
      checkpoint_id: cp.checkpoint_id,
      devices: cp.devices,
      root_hash: cp.root_hash,
    };
    const text = serializeLedgerJsonl(header, events);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')).toHaveLength(17 + 2 + 1); // header + 17(초기 policy + 16종) + footer + 끝 개행
    const parsed = parseLedgerJsonl(text);
    expect(parsed.header).toEqual(header);
    expect(parsed.events).toEqual(events);
    expect(parsed.footer.events).toBe(17);
    expect(serializeLedgerJsonl(parsed.header, parsed.events)).toBe(text); // 바이트 왕복
    // payload는 저장된 정준 JSON 문자열 그대로
    const stored = h.db.prepare('SELECT payload FROM lr_event ORDER BY device_seq').all();
    expect(parsed.events.map((e) => e.payload)).toEqual(stored.map((r) => r.payload));

    // 절단·변조 탐지(footer)
    const lines = text.split('\n');
    const cut = [...lines.slice(0, 5), ...lines.slice(-2)].join('\n');
    expect(() => parseLedgerJsonl(cut)).toThrow(/footer event count mismatch/);
    const flipped = text.replace('suspended', 'suspendeX');
    expect(flipped).not.toBe(text);
    expect(() => parseLedgerJsonl(flipped)).toThrow(/lines_sha256 mismatch/);
    expect(() => parseLedgerJsonl(lines.slice(0, 4).join('\n'))).toThrow(/footer missing or invalid/);

    // 증분: since 체크포인트 seq 이후만
    expect(readExportEvents(h.db, { [fixedUlid(0)]: { seq: 15 } }).map((e) => e.device_seq)).toEqual([16, 17]);

    // 다른 DB로 재적재 — 헤드가 같다(체인이 JSONL을 지나도 보존).
    const reader = createLedgerReplayReader();
    const target = await makeHarness({ db: await openMigratedDb(), idStart: 1000 });
    const envelopes = [...reader.replay(h.db)];
    const imported = target.db.tx(() => target.writer.importInTx(envelopes, header.devices));
    expect(imported).toEqual({ ok: true, value: { inserted: 17, duplicates: 0 } });
  });
});
