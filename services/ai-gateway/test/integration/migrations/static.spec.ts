import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildServiceApp } from '@fathom/shared-kernel/service/service';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { describe, expect, it } from 'vitest';
import { ASSETS_DIR, serviceDefinition } from '../../../src/config.js';
import { AI_CACHE_DB, AI_DB, seedFirstBoot } from '../../../src/infra/db/open.js';
import { MAIN, runMode, SERVICE_DIR, withTempHome } from './helpers/boot.js';

const SQLITE_VALUE_IMPORT =
  /(?:import|export)\s+(?!type\b)[^;]*?from\s+['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]|import\s*\(\s*['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]\s*\)|import\s+['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]/;
const NORMAL = { synchronous: 'NORMAL', recursiveTriggers: false } as const;

describe('ai-gateway 정적 규칙·골격', () => {
  it('IT-419 --disable-warning 없이 migrate → ExperimentalWarning 0 · src의 sqlite 값 import 0 [NFR-PORT-009]', async () => {
    await withTempHome(async (home) => {
      // Act
      const run = await runMode(home.path, ['--mode=migrate'], { noWarningFlag: true });
      // Assert
      expect(run.code).toBe(0);
      expect(run.stderr.filter((l) => l.includes('ExperimentalWarning'))).toEqual([]);
      const files = readdirSync(path.join(SERVICE_DIR, 'src'), { recursive: true, encoding: 'utf8' }).filter((f) =>
        f.endsWith('.ts'),
      );
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(SQLITE_VALUE_IMPORT.test(readFileSync(path.join(SERVICE_DIR, 'src', f), 'utf8')), f).toBe(false);
      }
    });
  });

  it('IT-423 buildServiceApp: 공통 3 + admin 6 + inbox 1, openInfra.assetsDir에 tasks.yaml [NFR-MAINT-001]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const ai = openDb(path.join(home.path, 'data', 'ai.db'), NORMAL);
      const cache = openDb(path.join(home.path, 'data', 'ai-cache.db'), NORMAL);
      const clock = createFakeClock();
      try {
        // Act
        const app = await buildServiceApp(serviceDefinition(MAIN), {
          callerTokens: TEST_CALLER_TOKENS,
          clock,
          home: home.path,
          dbs: { 'ai.db': ai, 'ai-cache.db': cache },
        });
        const routes = app
          .registeredRoutes()
          .map((r) => `${r.method} ${r.url}`)
          .sort();
        await app.close();
        // Assert
        expect(routes).toEqual(
          [
            'GET /healthz',
            'GET /readyz',
            'GET /internal/v1/metrics',
            'POST /internal/v1/admin/quiesce',
            'POST /internal/v1/admin/snapshot',
            'POST /internal/v1/admin/resume',
            'POST /internal/v1/admin/shutdown',
            'GET /internal/v1/admin/events',
            'POST /internal/v1/admin/integrity',
            'POST /internal/v1/inbox',
          ].sort(),
        );
        expect(existsSync(path.join(ASSETS_DIR, 'tasks.yaml'))).toBe(true);
        expect(AI_DB.migrations.map((m) => m.module)).toEqual(['control', 'routing', 'judge', 'privacy']);
        expect(AI_CACHE_DB.migrations.map((m) => m.module)).toEqual(['cache']);
        // seedFirstBoot 직접 호출: 앞 buildServiceApp이 이미 시드했으므로 present
        expect(seedFirstBoot(ai, clock)).toBe('present');
      } finally {
        ai.close();
        cache.close();
      }
    });
  });

  it('IT-417 seedFirstBoot 2회 호출 = seeded → present [FR-AI-003]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const ai = openDb(path.join(home.path, 'data', 'ai.db'), NORMAL);
      const cache = openDb(path.join(home.path, 'data', 'ai-cache.db'), NORMAL);
      const clock = createFakeClock();
      try {
        // Act / Assert
        expect(seedFirstBoot(ai, clock)).toBe('seeded');
        expect(seedFirstBoot(ai, clock)).toBe('present');
      } finally {
        ai.close();
        cache.close();
      }
    });
  });
});
