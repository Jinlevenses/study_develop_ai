import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { IntegrityResult, SnapshotResult } from '@fathom/contracts/admin/admin-routes';
import { createJobRunner } from '@fathom/shared-kernel/jobs/jobs';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { learningDbOptions } from '../../../src/infra/db/open.js';
import { ledgerGuardCheck } from '../../../src/jobs/integrity.js';
import { docSql, execArgvFor, MAIN, runMode, withTempHome } from './helpers/boot.js';

const DEVICE = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const runners: { shutdown(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of runners.splice(0)) {
    await r.shutdown();
  }
});
const jobRunner = (): ReturnType<typeof createJobRunner> => {
  const r = createJobRunner({
    entry: MAIN,
    execArgv: execArgvFor(),
    onStdoutLine: () => undefined,
    onStderrLine: () => undefined,
  });
  runners.push(r);
  return r;
};
const learningFile = (home: string): string => path.join(home, 'data', 'learning.db');

describe('learning job', () => {
  it('IT-320 snapshot·integrity job: learning.db만, ledger_head·projection_hash [NFR-DATA-012][IF-COM-006][IF-COM-010]', async () => {
    await withTempHome(async (home) => {
      // Arrange: 빈 DB
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const epoch = fixedUlid(41);
      const dir = path.join(home.path, 'backups', 'snap', epoch);
      mkdirSync(dir, { recursive: true });
      const runner = jobRunner();
      // Act
      const empty = await runner.run('snapshot', { epoch_id: epoch, dir, home: home.path }, { timeoutMs: 30_000 });
      // Assert
      expect(empty.ok).toBe(true);
      const emptyResult = SnapshotResult.parse(empty.ok ? empty.value : null);
      expect(emptyResult.files.map((f) => f.file)).toEqual(['learning.db']);
      expect(emptyResult.ledger_head).toEqual({});
      expect(emptyResult.projection_hash).toBeUndefined();
      expect(emptyResult.fsrs_impl).toBeUndefined();
      // Arrange: 기기 1개 이벤트 2행 + projection_meta
      const db = openDb(learningFile(home.path), learningDbOptions(false));
      try {
        for (const n of [1, 2]) {
          db.prepare(docSql('LEDGER_INSERT')).run({
            event_id: `01ARZ3NDEKTSV4RRFFQ69G5F${n}0`,
            device_id: DEVICE,
            device_seq: n,
            client_ts: 1000 + n,
            type: 'card.enrolled',
            schema_version: 1,
            idempotency_key: `k:${n}`,
            payload: '{"card_id":"a:b:p","concept_id":"a"}',
            prev_hash: '0'.repeat(64),
            hash: `${n}`.repeat(64),
            experiment_arm: null,
            recorded_at: 1,
            ext: '{}',
            ext_v: 1,
          });
        }
        db.prepare(
          "INSERT INTO lr_projection_meta(name, projection_hash, fsrs_impl, policy_version, event_count, last_order_json, computed_at) VALUES ('live', :h, 'ts-fsrs@5.4.2', 'ps_0', 2, '[1002,\"D\",2]', 1)",
        ).run({ h: 'c'.repeat(64) });
      } finally {
        db.close();
      }
      // Act
      const dir2 = path.join(home.path, 'backups', 'snap', fixedUlid(42));
      mkdirSync(dir2, { recursive: true });
      const filled = await runner.run(
        'snapshot',
        { epoch_id: fixedUlid(42), dir: dir2, home: home.path },
        { timeoutMs: 30_000 },
      );
      // Assert
      const filledResult = SnapshotResult.parse(filled.ok ? filled.value : null);
      expect(filledResult.ledger_head).toEqual({ [DEVICE]: { seq: 2, hash: '2'.repeat(64) } });
      expect(filledResult.projection_hash).toBe('c'.repeat(64));
      expect(filledResult.fsrs_impl).toBe('ts-fsrs@5.4.2');
      expect(filledResult.files.map((f) => f.file)).toEqual(['learning.db']);
      // integrity(full)
      const check = await runner.run('integrity', { level: 'full', home: home.path }, { timeoutMs: 30_000 });
      const integrity = IntegrityResult.parse(check.ok ? check.value : null);
      expect(integrity.ok).toBe(true);
      expect(integrity.files.map((f) => f.file)).toEqual(['learning.db']);
    });
  });

  it('IT-321 ledgerGuardCheck · restore: 불변 트리거가 빠진 사본은 78 [NFR-DATA-001][NFR-DATA-012]', async () => {
    await withTempHome(async (src) => {
      await withTempHome(async (dst) => {
        // Arrange: 정상 DB에서 사본 디렉터리
        expect((await runMode(src.path, ['--mode=migrate'])).code).toBe(0);
        const good = path.join(src.path, 'copy-good');
        const bad = path.join(src.path, 'copy-bad');
        mkdirSync(good, { recursive: true });
        mkdirSync(bad, { recursive: true });
        copyFileSync(learningFile(src.path), path.join(good, 'learning.db'));
        copyFileSync(learningFile(src.path), path.join(bad, 'learning.db'));
        const stripped = openDb(path.join(bad, 'learning.db'), learningDbOptions(false));
        stripped.exec('DROP TRIGGER lr_event_no_update');
        // Assert: ledgerGuardCheck
        expect(ledgerGuardCheck(stripped)).toEqual({
          ok: false,
          error: { code: 'ledger_guard_missing', detail: 'lr_event_no_update' },
        });
        stripped.close();
        const whole = openDb(path.join(good, 'learning.db'), learningDbOptions(true));
        expect(ledgerGuardCheck(whole)).toEqual({ ok: true, value: null });
        whole.close();
        // Act: restore
        expect((await runMode(dst.path, ['--mode=migrate'])).code).toBe(0);
        rmSync(path.join(dst.path, 'data', 'insight.db'));
        const cursors = JSON.stringify({ gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 });
        const restored = await runMode(dst.path, ['--mode=restore', `--from=${good}`, `--rewind-cursors=${cursors}`]);
        const rejected = await runMode(dst.path, ['--mode=restore', `--from=${bad}`, `--rewind-cursors=${cursors}`]);
        // Assert
        expect(restored.code).toBe(0);
        expect(readFileSync(path.join(dst.path, 'data', 'insight.db')).byteLength).toBeGreaterThan(0);
        expect(rejected.code).toBe(78);
      });
    });
  });
});
