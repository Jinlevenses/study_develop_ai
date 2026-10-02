import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { IntegrityResult, SnapshotResult } from '@fathom/contracts/admin/admin-routes';
import { createJobRunner } from '@fathom/shared-kernel/jobs/jobs';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { execArgvFor, MAIN, runMode, withTempHome } from './helpers/boot.js';

const runners: { shutdown(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of runners.splice(0)) {
    await r.shutdown();
  }
});

describe('ai-gateway job', () => {
  it('IT-422 snapshot → files = [ai.db], learning 전용 키 0 · integrity full → ok [NFR-DATA-012][IF-COM-006][IF-COM-010]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const runner = createJobRunner({
        entry: MAIN,
        execArgv: execArgvFor(),
        onStdoutLine: () => undefined,
        onStderrLine: () => undefined,
      });
      runners.push(runner);
      const epoch = fixedUlid(51);
      const dir = path.join(home.path, 'backups', 'snap', epoch);
      mkdirSync(dir, { recursive: true });
      // Act
      const snap = await runner.run('snapshot', { epoch_id: epoch, dir, home: home.path }, { timeoutMs: 30_000 });
      const check = await runner.run('integrity', { level: 'full', home: home.path }, { timeoutMs: 30_000 });
      // Assert
      expect(snap.ok).toBe(true);
      const result = SnapshotResult.parse(snap.ok ? snap.value : null);
      expect(result.files.map((f) => f.file)).toEqual(['ai.db']);
      expect(result.svc).toBe('ai-gateway');
      expect(result.ledger_head).toBeUndefined();
      expect(result.projection_hash).toBeUndefined();
      expect(result.fsrs_impl).toBeUndefined();
      expect(check.ok).toBe(true);
      const integrity = IntegrityResult.parse(check.ok ? check.value : null);
      expect(integrity.ok).toBe(true);
      expect(integrity.files.map((f) => f.file)).toEqual(['ai.db']);
    });
  });
});
