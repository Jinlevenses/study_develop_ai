import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildServiceApp } from '@fathom/shared-kernel/service/service';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { createFakePeer } from '@fathom/testkit/fakes/peers/peers';
import { describe, expect, it } from 'vitest';
import { serviceDefinition } from '../../../src/config.js';
import { learningDbOptions } from '../../../src/infra/db/open.js';
import { insightDbOptions } from '../../../src/infra/insight-db/open.js';
import { MAIN, runMode, SERVICE_DIR, withTempHome } from './helpers/boot.js';

const SQLITE_VALUE_IMPORT =
  /(?:import|export)\s+(?!type\b)[^;]*?from\s+['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]|import\s*\(\s*['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]\s*\)|import\s+['"](?:@fathom\/shared-kernel\/sqlite\/sqlite|node:sqlite)['"]/;

describe('learning 정적 규칙·골격', () => {
  it('IT-322 --disable-warning 없이 migrate → ExperimentalWarning 0 · src의 sqlite 값 import 0 [NFR-PORT-009]', async () => {
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

  it('IT-325 buildServiceApp: 공통 3 + admin 6 + inbox 1, peers 없으면 invariant [NFR-MAINT-001]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const learning = openDb(path.join(home.path, 'data', 'learning.db'), learningDbOptions(false));
      const insight = openDb(path.join(home.path, 'data', 'insight.db'), insightDbOptions(false));
      const clock = createFakeClock();
      const runtime = {
        callerTokens: TEST_CALLER_TOKENS,
        clock,
        home: home.path,
        dbs: { 'learning.db': learning, 'insight.db': insight },
      };
      try {
        // Act
        const app = await buildServiceApp(serviceDefinition(MAIN), {
          ...runtime,
          peers: { content: createFakePeer({ peer: 'content', clock, handlers: {} }) },
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
        await expect(buildServiceApp(serviceDefinition(MAIN), runtime)).rejects.toThrow(
          'invariant: peer client content missing',
        );
      } finally {
        learning.close();
        insight.close();
      }
    });
  });
});
