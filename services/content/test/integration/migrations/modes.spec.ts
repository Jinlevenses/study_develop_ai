import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { readMigrationBundle } from '@fathom/shared-kernel/sqlite/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTENT_MIGRATIONS } from '../../../src/infra/db/open.js';
import {
  contentDbPath,
  EXEC_ARGV,
  jsonLines,
  killAlive,
  MIGRATIONS_ROOT,
  openWritable,
  runMode,
  withHome,
} from './support.js';

afterEach(() => {
  expect(killAlive()).toBe(0);
});

describe('content 마이그레이션 번들 · 모드', () => {
  it('IT-217 readMigrationBundle(5모듈) ok·6파일·헤더 module/version = 경로, 금지 토큰 0 [ADR-002][DB-01 §11.1]', () => {
    // Act
    const bundle = readMigrationBundle([...CONTENT_MIGRATIONS]);
    // Assert
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) {
      return;
    }
    expect(CONTENT_MIGRATIONS.map((m) => m.module)).toEqual([
      'catalog',
      'acquisition',
      'itembank',
      'grading',
      'runner',
    ]);
    expect(bundle.value.map((f) => `${f.module}/${f.version}`)).toEqual([
      'catalog/1',
      'catalog/2',
      'acquisition/1',
      'itembank/1',
      'grading/1',
      'runner/1',
    ]);
    for (const f of bundle.value) {
      expect(path.basename(path.dirname(f.file))).toBe(f.module);
      expect(path.dirname(path.dirname(f.file))).toBe(path.resolve(MIGRATIONS_ROOT));
      expect(f.file.endsWith(`${String(f.version).padStart(4, '0')}_${f.name}.sql`)).toBe(true);
    }
  });

  it('IT-222 다른 application_id의 content.db → migrate exit 78 · --mode=verify → 64 [ADR-002][FR-SET-007]', async () => {
    await withHome(async (home) => {
      // Arrange: application_id만 다른 DB
      mkdirSync(path.join(home.path, 'data'), { recursive: true });
      const db = await openWritable(contentDbPath(home.path));
      db.exec('PRAGMA application_id = 1234567');
      db.exec('CREATE TABLE alien(x INTEGER)');
      db.close();
      // Act
      const migrate = await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      const verify = await runMode(['--mode=verify'], { FATHOM_HOME: home.path });
      // Assert
      expect(migrate.code).toBe(78);
      expect(jsonLines(migrate).find((l) => l.event === 'mode.migrate.failed')).toMatchObject({ level: 'fatal' });
      expect(verify.code).toBe(64);
    });
  }, 60_000);

  it('IT-223 --mode=job --job=bogus → 64 (인자 오류) [ADR-002][FR-SET-007]', async () => {
    await withHome(async (home) => {
      const result = await runMode(['--mode=job', '--job=bogus'], { FATHOM_HOME: home.path });
      expect(result.code).toBe(64);
    });
  }, 60_000);

  it('IT-224 --disable-warning 없이 --mode=migrate → stderr에 ExperimentalWarning 0줄 [NFR-PORT-002]', async () => {
    await withHome(async (home) => {
      // Arrange: 경고 억제 플래그를 뺀 execArgv
      const execArgv = EXEC_ARGV.filter((a) => !a.startsWith('--disable-warning'));
      // Act
      const result = await runMode(['--mode=migrate'], { FATHOM_HOME: home.path }, { execArgv });
      // Assert
      expect(result.code).toBe(0);
      expect(result.stderr.filter((l) => l.includes('ExperimentalWarning'))).toEqual([]);
    });
  }, 60_000);
});
