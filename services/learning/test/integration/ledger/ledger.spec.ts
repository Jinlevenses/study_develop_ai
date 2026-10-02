import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_SETS, readGoldenLedger, readGoldenMeta } from '@fathom/testkit/golden-ledgers/golden-ledgers';
import { createTempHome } from '@fathom/testkit/temp-home';
import { describe, expect, it } from 'vitest';
import { createCheckpoint } from '../../../src/application/ledger/checkpoint.js';
import { verifyLedger } from '../../../src/application/ledger/verify.js';
import { LEDGER_HEADS } from '../../../src/infra/ledger/ledger.sql.js';
import { ledgerGuardCheck } from '../../../src/jobs/integrity.js';
import { fixtureDraft } from '../../contract/ledger/ledger-fixtures.js';
import { openMigratedDb } from '../../unit/ledger/support/db.js';
import { makeHarness } from '../../unit/ledger/support/harness.js';
import { execArgvFor } from '../migrations/helpers/boot.js';

// IT-330~335 — 실제 파일 DB(LEARNING_DB 연결 규칙 = synchronous FULL + recursive_triggers ON, 실제 마이그레이션 적용).
const CHILD = fileURLToPath(new URL('./child-append.ts', import.meta.url));
const SERVICE_DIR = fileURLToPath(new URL('../../../', import.meta.url));

async function freshDbPath(): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const home = await createTempHome('fathom-ledger-it-');
  const dir = path.join(home.path, 'data');
  await mkdir(dir, { recursive: true });
  return { file: path.join(dir, 'learning.db'), cleanup: () => home.cleanup() };
}

type Child = {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly lines: string[];
  readonly exited: Promise<number | null>;
  waitFor(pred: (lines: readonly string[]) => boolean): Promise<void>;
};
function startChild(args: readonly string[]): Child {
  const proc = spawn(process.execPath, [...execArgvFor(), CHILD, ...args], {
    cwd: SERVICE_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines: string[] = [];
  const errors: string[] = [];
  const waiters: (() => void)[] = [];
  let buffer = '';
  const wake = (): void => {
    for (const w of waiters.splice(0)) {
      w();
    }
  };
  proc.stdout.on('data', (c: Buffer) => {
    buffer += c.toString('utf8');
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    lines.push(...parts);
    wake();
  });
  proc.stderr.on('data', (c: Buffer) => void errors.push(c.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => {
    proc.once('close', (code) => {
      resolve(code);
      wake();
    });
  });
  let closed = false;
  void exited.then(() => {
    closed = true;
  });
  return {
    proc,
    lines,
    exited,
    async waitFor(pred): Promise<void> {
      const deadline = AbortSignal.timeout(50_000);
      while (!pred(lines)) {
        if (closed) {
          throw new Error(
            `child exited before condition: ${errors.join('').slice(0, 500)} | ${lines.slice(-3).join(' / ')}`,
          );
        }
        await new Promise<void>((resolve, reject) => {
          waiters.push(resolve);
          deadline.addEventListener('abort', () => reject(new Error('child wait timed out')), { once: true });
        });
      }
    },
  };
}

const count = (db: { prepare(sql: string): { get(): Record<string, unknown> | undefined } }): number =>
  Number(db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n);

describe('원장 통합(파일 DB)', () => {
  it('IT-330 REPLACE·INSERT OR REPLACE·UPDATE·DELETE 거부(recursive_triggers ON 연결) [NFR-DATA-001]', async () => {
    const t = await freshDbPath();
    try {
      const db = await openMigratedDb(t.file);
      const h = await makeHarness({ db });
      expect(h.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
      const row = db.prepare('SELECT * FROM lr_event WHERE device_seq = 2').get();
      if (row === undefined) {
        throw new Error('fixture');
      }
      const cols = [
        'event_id',
        'device_id',
        'device_seq',
        'client_ts',
        'type',
        'schema_version',
        'idempotency_key',
        'payload',
        'prev_hash',
        'hash',
        'experiment_arm',
        'recorded_at',
        'ext',
        'ext_v',
      ];
      const values = cols.map((c) => {
        const v = row[c];
        return v === null || typeof v === 'string' || typeof v === 'number' ? v : String(v);
      });
      const marks = cols.map(() => '?').join(', ');
      expect(() => db.prepare(`REPLACE INTO lr_event(${cols.join(', ')}) VALUES (${marks})`).run(...values)).toThrow(
        /append-only/,
      );
      expect(() =>
        db.prepare(`INSERT OR REPLACE INTO lr_event(${cols.join(', ')}) VALUES (${marks})`).run(...values),
      ).toThrow(/append-only/);
      expect(() => db.prepare('UPDATE lr_event SET type = ?').run('x')).toThrow(/append-only/);
      expect(() => db.prepare('DELETE FROM lr_event').run()).toThrow(/append-only/);
      expect(count(db)).toBe(2);
      db.close();
    } finally {
      await t.cleanup();
    }
  });

  it('IT-331 append 도중 SIGKILL → 재시작 후 부분 행 0·체인 정상·앵커 일치 [NFR-DATA-013][NFR-DATA-001]', async () => {
    const t = await freshDbPath();
    try {
      (await openMigratedDb(t.file)).close();
      const child = startChild([t.file, '100000', '0', 'free']);
      await child.waitFor((l) => l.filter((x) => x.startsWith('ack ')).length >= 60);
      child.proc.kill('SIGKILL');
      await child.exited;
      const acked = child.lines.filter((x) => x.startsWith('ack ')).length;
      expect(child.lines.some((l) => l.startsWith('fault'))).toBe(false);

      // 재시작: 같은 파일을 다시 연다(WAL 복구).
      const db = await openMigratedDb(t.file);
      const rows = count(db);
      expect(rows).toBeGreaterThanOrEqual(acked + 1); // ack된 건 + 초기 policy.switched, 응답 직전 커밋분은 더 있을 수 있다
      expect(rows).toBeLessThanOrEqual(acked + 2);
      const verified = verifyLedger(db);
      expect(verified.ok).toBe(true);
      expect(verified.ok && Object.values(verified.value.devices)[0]?.seq).toBe(rows);
      expect(
        db
          .prepare('SELECT count(*) AS n FROM lr_event WHERE hash IS NULL OR payload IS NULL OR prev_hash IS NULL')
          .get()?.n,
      ).toBe(0);
      // 이어서 append가 정상 동작한다(체인 이어짐)
      const h = await makeHarness({ db, idStart: 900_000 });
      expect(h.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
      expect(verifyLedger(db).ok).toBe(true);
      db.close();
    } finally {
      await t.cleanup();
    }
  }, 90_000);

  it('IT-332 두 연결(프로세스) 동시 append 200건 → seq 연속·경보 0 [NFR-DATA-013][NFR-DATA-001]', async () => {
    const t = await freshDbPath();
    try {
      (await openMigratedDb(t.file)).close();
      const a = startChild([t.file, '100', '0', 'wait']);
      const b = startChild([t.file, '100', '100000', 'wait']);
      await Promise.all([a.waitFor((l) => l.includes('ready')), b.waitFor((l) => l.includes('ready'))]);
      a.proc.stdin.end('go\n');
      b.proc.stdin.end('go\n');
      expect(await Promise.all([a.exited, b.exited])).toEqual([0, 0]);
      expect(a.lines.at(-1)).toBe('done alarms=0');
      expect(b.lines.at(-1)).toBe('done alarms=0');

      const db = await openMigratedDb(t.file);
      expect(count(db)).toBe(201); // 초기 policy.switched + 200
      const seqs = db.prepare('SELECT device_id, device_seq FROM lr_event ORDER BY device_seq').all();
      expect(new Set(seqs.map((r) => r.device_id)).size).toBe(1); // 한 로컬 기기
      expect(seqs.map((r) => Number(r.device_seq))).toEqual(Array.from({ length: 201 }, (_, i) => i + 1));
      expect(db.prepare('SELECT count(*) AS n FROM lr_device WHERE is_local = 1').get()?.n).toBe(1);
      expect(verifyLedger(db).ok).toBe(true);
      db.close();
    } finally {
      await t.cleanup();
    }
  }, 90_000);

  it('IT-333 FULL 동기 append 1,000건 p99 ≤ 100ms (관대, 실측 기록) [NFR-DATA-001]', async () => {
    const t = await freshDbPath();
    try {
      const db = await openMigratedDb(t.file);
      const h = await makeHarness({ db });
      const draft = fixtureDraft('lesson.completed');
      const samples: number[] = [];
      for (let i = 0; i < 1000; i += 1) {
        h.clock.advance(1000);
        const started = performance.now();
        const res = h.writer.append({ ...draft, idempotency_key: `cmd:${h.newId()}:theory` });
        samples.push(performance.now() - started);
        expect(res.ok).toBe(true);
      }
      samples.sort((x, y) => x - y);
      const p99 = samples[Math.floor(samples.length * 0.99) - 1] ?? Number.POSITIVE_INFINITY;
      const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
      process.stdout.write(
        `IT-333 append FULL n=1000 p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${(samples.at(-1) ?? 0).toFixed(2)}ms\n`,
      );
      expect(p99).toBeLessThanOrEqual(100);
      expect(count(db)).toBe(1001);
      db.close();
    } finally {
      await t.cleanup();
    }
  }, 90_000);

  it('IT-334 골든 3세트 importInTx 적재 → 헤드 = meta, 재적재 멱등, 헤더 앵커 통과 [FR-SET-022][FR-PRG-003]', async () => {
    for (const set of GOLDEN_SETS) {
      const t = await freshDbPath();
      try {
        const db = await openMigratedDb(t.file);
        const h = await makeHarness({ db });
        const { header, events } = readGoldenLedger(set);
        const meta = readGoldenMeta(set);
        const first = db.tx(() => h.writer.importInTx(events, header.devices));
        expect(first, set).toEqual({ ok: true, value: { inserted: meta.events, duplicates: 0 } });
        const heads: Record<string, { seq: number; head_hash: string }> = {};
        for (const r of db.prepare(LEDGER_HEADS).all()) {
          heads[String(r.device_id)] = { seq: Number(r.seq), head_hash: String(r.head_hash) };
        }
        expect(heads, set).toEqual(meta.devices);
        const cp = db.tx(() => createCheckpoint(db, { clock: h.clock, newId: h.newId }, 'merge'));
        expect(cp.root_hash, set).toBe(meta.root_hash);
        expect(verifyLedger(db, { anchor: header.devices }).ok, set).toBe(true);
        expect(verifyLedger(db).ok, set).toBe(true); // 방금 만든 체크포인트 자동 대조
        const again = db.tx(() => h.writer.importInTx(events, header.devices));
        expect(again, set).toEqual({ ok: true, value: { inserted: 0, duplicates: meta.events } });
        expect(count(db)).toBe(meta.events);
        expect(h.applied).toEqual([]);
        expect(h.alarms).toEqual([]);
        db.close();
      } finally {
        await t.cleanup();
      }
    }
  }, 90_000);

  it('IT-335 기존 ledgerGuardCheck 통과(append-only 트리거 4개), 트리거 제거 시 ledger_guard_missing [NFR-DATA-001]', async () => {
    const t = await freshDbPath();
    try {
      const db = await openMigratedDb(t.file);
      const h = await makeHarness({ db });
      const { events, header } = readGoldenLedger('corrections');
      expect(db.tx(() => h.writer.importInTx(events, header.devices)).ok).toBe(true);
      expect(ledgerGuardCheck(db)).toEqual({ ok: true, value: null });
      db.exec('DROP TRIGGER lr_checkpoint_no_delete');
      const res = ledgerGuardCheck(db);
      expect(!res.ok && res.error).toEqual({ code: 'ledger_guard_missing', detail: 'lr_checkpoint_no_delete' });
      db.close();
    } finally {
      await t.cleanup();
    }
  });
});
