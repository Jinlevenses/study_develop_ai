import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DB_EXT_TABLES, DB_NAME_HOOKS } from '@fathom/contracts/db-hooks';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { describe, expect, it } from 'vitest';
import { learningDbOptions } from '../../../src/infra/db/open.js';
import { insightDbOptions } from '../../../src/infra/insight-db/open.js';
import {
  bootServe,
  ddlBlock,
  INFRA_TABLES,
  REPO_ROOT,
  runMode,
  SERVICE_DIR,
  specTables,
  withTempHome,
} from './helpers/boot.js';

const dataFile = (home: string, file: string): string => path.join(home, 'data', file);
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

function withDb<T>(file: string, opts: ReturnType<typeof learningDbOptions>, fn: (db: SqlitePort) => T): T {
  const db = openDb(file, opts);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
const readLearning = <T>(home: string, fn: (db: SqlitePort) => T): T =>
  withDb(dataFile(home, 'learning.db'), learningDbOptions(true), fn);
const readInsight = <T>(home: string, fn: (db: SqlitePort) => T): T =>
  withDb(dataFile(home, 'insight.db'), insightDbOptions(true), fn);

const MIGRATIONS = 'SELECT module, version FROM schema_migrations ORDER BY module, version';
const TABLES = "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name";
const modules = (db: SqlitePort): string[] =>
  db
    .prepare(MIGRATIONS)
    .all()
    .map((r) => `${String(r.module)}@${String(r.version)}`);
const tableNames = (db: SqlitePort): string[] =>
  db
    .prepare(TABLES)
    .all()
    .map((r) => String(r.name));

const LEARNING_MODULES = [
  '_infra@1',
  '_infra@2',
  '_infra@3',
  'curriculum-ref@1',
  'learner-model@1',
  'ledger@1',
  'practice@1',
];
const INSIGHT_MODULES = ['_infra@1', 'insight@1'];

describe('learning 마이그레이션', () => {
  it('IT-310 빈 HOME --mode=migrate → exit 0, 두 DB와 schema_migrations [FR-SET-007][NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      // Act
      const run = await runMode(home.path, ['--mode=migrate']);
      // Assert
      expect(run.code).toBe(0);
      expect(existsSync(dataFile(home.path, 'learning.db'))).toBe(true);
      expect(existsSync(dataFile(home.path, 'insight.db'))).toBe(true);
      expect(readLearning(home.path, modules)).toEqual(LEARNING_MODULES);
      expect(readInsight(home.path, modules)).toEqual(INSIGHT_MODULES);
      expect(run.stdout.some((l) => l.includes('mode.migrate.completed'))).toBe(true);
    });
  });

  it('IT-311 DB-01 §17.1 #6~#15 integrity·FK·application_id·WAL·STRICT [NFR-DATA-008]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const cases = [
        { read: readLearning, appId: 0x46544c52 },
        { read: readInsight, appId: 0x46544956 },
      ] as const;
      for (const c of cases) {
        // Act
        const facts = c.read(home.path, (db) => ({
          integrity: db.prepare('PRAGMA integrity_check').all(),
          fk: db.prepare('PRAGMA foreign_key_check').all(),
          appId: Number(db.prepare('PRAGMA application_id').get()?.application_id),
          journal: String(db.prepare('PRAGMA journal_mode').get()?.journal_mode),
          nonStrict: db
            .prepare(
              "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND strict = 0 AND name NOT GLOB 'sqlite_*'",
            )
            .all(),
        }));
        // Assert
        expect(facts.integrity).toEqual([{ integrity_check: 'ok' }]);
        expect(facts.fk).toEqual([]);
        expect(facts.appId).toBe(c.appId);
        expect(facts.journal).toBe('wal');
        expect(facts.nonStrict).toEqual([]);
      }
    });
  });

  it('IT-312 테이블 집합 = 테이블정의서 + _infra, DR-020 이름 훅·ext 열 [DR-020][NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const learningExpected = [...specTables('### 6.7 테이블정의서', '### 6.8 DDL'), ...INFRA_TABLES].sort();
      const insightExpected = [...specTables('### 7.1 테이블정의서', '### 7.2 DDL'), 'schema_migrations'].sort();
      // Assert
      expect(specTables('### 6.7 테이블정의서', '### 6.8 DDL')).toHaveLength(30);
      expect(specTables('### 7.1 테이블정의서', '### 7.2 DDL')).toHaveLength(9);
      expect(readLearning(home.path, tableNames)).toEqual(learningExpected);
      expect(readInsight(home.path, tableNames)).toEqual(insightExpected);
      const columnsOf = (db: SqlitePort, table: string): string[] =>
        db
          .prepare('SELECT name FROM pragma_table_info(:t)')
          .all({ t: table })
          .map((r) => String(r.name));
      readLearning(home.path, (db) => {
        const hooks = DB_NAME_HOOKS.filter((h) => h.file.startsWith('services/learning/'));
        expect(hooks.length).toBeGreaterThan(0);
        for (const hook of hooks) {
          expect(columnsOf(db, hook.table), hook.table).toEqual(expect.arrayContaining([...hook.columns]));
        }
        const ext = DB_EXT_TABLES.filter((t) => t.db === 'learning.db');
        expect(ext.length).toBeGreaterThan(0);
        for (const t of ext) {
          expect(columnsOf(db, t.table), t.table).toEqual(expect.arrayContaining(['ext', 'ext_v']));
        }
      });
    });
  });

  it('IT-313 DDL 5개 = DB-01 코드 블록 바이트 동일 [NFR-DATA-003]', () => {
    const files = [
      'services/learning/migrations/ledger/0001_ledger_core.sql',
      'services/learning/migrations/learner-model/0001_projections.sql',
      'services/learning/migrations/practice/0001_practice_core.sql',
      'services/learning/migrations/curriculum-ref/0001_curriculum_ref.sql',
      'services/learning/migrations-insight/0001_insight_views.sql',
    ];
    for (const rel of files) {
      // Act
      const bytes = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Assert
      expect(bytes, rel).toBe(ddlBlock(rel));
      expect(bytes.includes('\r'), rel).toBe(false);
      expect(bytes.endsWith('\n') && !bytes.endsWith('\n\n'), rel).toBe(true);
      const module = path.basename(path.dirname(rel));
      const expectedModule = module === 'migrations-insight' ? 'insight' : module;
      expect(bytes.split('\n')[0], rel).toBe(`-- @fathom:module=${expectedModule} version=1 kind=additive`);
      expect(path.basename(rel).startsWith('0001_'), rel).toBe(true);
    }
    expect(readdirSync(path.join(SERVICE_DIR, 'migrations')).sort()).toEqual([
      'curriculum-ref',
      'learner-model',
      'ledger',
      'practice',
    ]);
  });

  it('IT-314 재실행·--dry-run·--db-copy-dir [FR-SET-007]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const before = readLearning(
        home.path,
        (db) => db.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n,
      );
      const hashes = (): string[] => ['learning.db', 'insight.db'].map((f) => sha256(dataFile(home.path, f)));
      // Act / Assert: 재실행
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      expect(readLearning(home.path, (db) => db.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n)).toBe(
        before,
      );
      // dry-run 단독
      const afterRerun = hashes();
      expect((await runMode(home.path, ['--mode=migrate', '--dry-run'])).code).toBe(0);
      expect(hashes()).toEqual(afterRerun);
      // dry-run + 사본 디렉터리
      const copyDir = mkdtempSync(path.join(tmpdir(), 'fathom-copy-'));
      try {
        expect((await runMode(home.path, ['--mode=migrate', '--dry-run', `--db-copy-dir=${copyDir}`])).code).toBe(0);
        expect(hashes()).toEqual(afterRerun);
        expect(
          readdirSync(copyDir)
            .filter((f) => f.endsWith('.db'))
            .sort(),
        ).toEqual(['insight.db', 'learning.db']);
        expect(withDb(path.join(copyDir, 'learning.db'), learningDbOptions(true), modules)).toEqual(LEARNING_MODULES);
      } finally {
        rmSync(copyDir, { recursive: true, force: true });
      }
    });
  });

  it('IT-315 sha 변조·모르는 모듈 → migrate·serve 78 [FR-SET-007][NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      withDb(dataFile(home.path, 'learning.db'), learningDbOptions(false), (db) => {
        db.prepare("UPDATE schema_migrations SET sha256 = :sha WHERE module = 'ledger'").run({ sha: '0'.repeat(64) });
      });
      // Act
      const migrate = await runMode(home.path, ['--mode=migrate']);
      const served = await bootServe(home.path);
      // Assert
      expect(migrate.code).toBe(78);
      expect(served.fatal).toMatchObject({ type: 'fatal', exit_code: 78, code: 'schema_sha_mismatch' });
      expect(await served.exited).toBe(78);
    });
    await withTempHome(async (home) => {
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      withDb(dataFile(home.path, 'learning.db'), learningDbOptions(false), (db) => {
        db.prepare(
          "INSERT INTO schema_migrations(module, version, name, sha256, applied_at) VALUES ('future-module', 1, 'x', :sha, 0)",
        ).run({ sha: 'e'.repeat(64) });
      });
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(78);
    });
  });

  it('IT-316 serve: DB 없음 → needs_migrate, 모듈 행 없음 → schema_needs_migrate [FR-SET-002][NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      // Act
      const none = await bootServe(home.path);
      // Assert
      expect(none.fatal).toMatchObject({ type: 'fatal', exit_code: 78, code: 'needs_migrate' });
      expect(await none.exited).toBe(78);
      // Arrange: 모듈 행 삭제
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      withDb(dataFile(home.path, 'learning.db'), learningDbOptions(false), (db) => {
        db.prepare("DELETE FROM schema_migrations WHERE module = 'curriculum-ref'").run();
      });
      const behind = await bootServe(home.path);
      expect(behind.fatal).toMatchObject({ type: 'fatal', exit_code: 78, code: 'schema_needs_migrate' });
      expect(await behind.exited).toBe(78);
    });
  });
});
