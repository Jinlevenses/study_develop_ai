import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DB_EXT_TABLES, DB_NAME_HOOKS } from '@fathom/contracts/db-hooks';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { describe, expect, it } from 'vitest';
import {
  bootServe,
  ddlBlock,
  docSql,
  INFRA_TABLES,
  REPO_ROOT,
  runMode,
  SERVICE_DIR,
  specTables,
  withTempHome,
} from './helpers/boot.js';

const AI_OPTS = { synchronous: 'NORMAL', recursiveTriggers: false } as const;
const dataFile = (home: string, file: string): string => path.join(home, 'data', file);
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

function withDb<T>(file: string, readOnly: boolean, fn: (db: SqlitePort) => T): T {
  const db = openDb(file, { ...AI_OPTS, readOnly });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
const readAi = <T>(home: string, fn: (db: SqlitePort) => T): T => withDb(dataFile(home, 'ai.db'), true, fn);
const readCache = <T>(home: string, fn: (db: SqlitePort) => T): T => withDb(dataFile(home, 'ai-cache.db'), true, fn);
const writeAi = <T>(home: string, fn: (db: SqlitePort) => T): T => withDb(dataFile(home, 'ai.db'), false, fn);

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

const AI_MODULES = ['_infra@1', '_infra@2', '_infra@3', 'control@1', 'judge@1', 'privacy@1', 'routing@1'];
const CACHE_MODULES = ['_infra@1', 'cache@1'];

describe('ai-gateway 마이그레이션', () => {
  it('IT-410 빈 HOME --mode=migrate → exit 0, 두 DB와 schema_migrations [FR-SET-007][NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      // Act
      const run = await runMode(home.path, ['--mode=migrate']);
      // Assert
      expect(run.code).toBe(0);
      expect(readAi(home.path, modules)).toEqual(AI_MODULES);
      expect(readCache(home.path, modules)).toEqual(CACHE_MODULES);
      expect(run.stdout.some((l) => l.includes('mode.migrate.completed'))).toBe(true);
    });
  });

  it('IT-411 DB-01 §17.1 #16~#25 · #64·#65 · #88~#90 [NFR-DATA-008]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const cases = [
        { read: readAi, appId: 0x46544149 },
        { read: readCache, appId: 0x46544143 },
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
      writeAi(home.path, (db) => {
        // #64 단일 행
        expect(() =>
          db.prepare("INSERT INTO ai_mode_state(id, mode, changed_at) VALUES (2, 'OFFLINE', 1)").run(),
        ).toThrow(/CHECK constraint failed: id = 1/);
        // #65 임계 비율
        expect(() =>
          db
            .prepare(
              "INSERT INTO ai_budget_alert(period_key, scope, provider_id, ratio, raised_at) VALUES ('2026-10', 'money', '*', 0.5, 1)",
            )
            .run(),
        ).toThrow(/CHECK constraint failed: ratio IN \(0\.8, 1\.0\)/);
        db.prepare(
          "INSERT INTO ai_budget_alert(period_key, scope, provider_id, ratio, raised_at) VALUES ('2026-10', 'money', '*', 0.8, 1)",
        ).run();
        // #88~#90 DB-01 §8 문장
        for (const name of ['CURRENT_CONSENT', 'USAGE_ADD', 'NEXT_BACKGROUND_JOB']) {
          expect(() => db.prepare(docSql(name)), name).not.toThrow();
        }
      });
    });
  });

  it('IT-412 테이블 집합 = 테이블정의서 + _infra, 이름 훅·ext 열, 키 저장 열 0 [DR-020][NFR-DATA-005][NFR-SEC-004]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const aiSpec = specTables('### 8.1 테이블정의서', '### 8.2 DDL');
      const cacheSpec = specTables('### 9.1 테이블정의서', '### 9.2 DDL');
      // Assert
      expect(aiSpec).toHaveLength(22);
      expect(cacheSpec).toHaveLength(1);
      expect(readAi(home.path, tableNames)).toEqual([...aiSpec, ...INFRA_TABLES].sort());
      expect(readCache(home.path, tableNames)).toEqual([...cacheSpec, 'schema_migrations'].sort());
      const columnsOf = (db: SqlitePort, table: string): string[] =>
        db
          .prepare('SELECT name FROM pragma_table_info(:t)')
          .all({ t: table })
          .map((r) => String(r.name));
      readAi(home.path, (db) => {
        const hooks = DB_NAME_HOOKS.filter((h) => h.file.startsWith('services/ai-gateway/'));
        expect(hooks.map((h) => h.table)).toEqual(['ai_judge_log']);
        for (const hook of hooks) {
          expect(columnsOf(db, hook.table)).toEqual(expect.arrayContaining([...hook.columns]));
          expect(hook.columns).toHaveLength(3);
        }
        const ext = DB_EXT_TABLES.filter((t) => t.db === 'ai.db');
        expect(ext.length).toBeGreaterThan(0);
        for (const t of ext) {
          expect(columnsOf(db, t.table), t.table).toEqual(expect.arrayContaining(['ext', 'ext_v']));
        }
        // 키 문자열 저장 열 0(DR-018)
        for (const table of tableNames(db)) {
          for (const column of columnsOf(db, table)) {
            expect(column.includes('api_key') || column.includes('secret_value'), `${table}.${column}`).toBe(false);
          }
        }
      });
    });
  });

  it('IT-413 DDL 5개 = DB-01 코드 블록 바이트 동일 [NFR-DATA-003]', () => {
    const files = [
      'services/ai-gateway/migrations/control/0001_control_core.sql',
      'services/ai-gateway/migrations/routing/0001_routing_core.sql',
      'services/ai-gateway/migrations/judge/0001_judge_core.sql',
      'services/ai-gateway/migrations/privacy/0001_privacy_core.sql',
      'services/ai-gateway/migrations-cache/0001_cache.sql',
    ];
    for (const rel of files) {
      // Act
      const bytes = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Assert
      expect(bytes, rel).toBe(ddlBlock(rel));
      expect(bytes.includes('\r'), rel).toBe(false);
      expect(bytes.endsWith('\n') && !bytes.endsWith('\n\n'), rel).toBe(true);
      const dir = path.basename(path.dirname(rel));
      const module = dir === 'migrations-cache' ? 'cache' : dir;
      expect(bytes.split('\n')[0], rel).toBe(`-- @fathom:module=${module} version=1 kind=additive`);
      expect(path.basename(rel).startsWith('0001_'), rel).toBe(true);
    }
    expect(readdirSync(path.join(SERVICE_DIR, 'migrations')).sort()).toEqual([
      'control',
      'judge',
      'privacy',
      'routing',
    ]);
  });

  it('IT-414 재실행·--dry-run·--db-copy-dir [FR-SET-007]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const count = (): unknown =>
        readAi(home.path, (db) => db.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n);
      const before = count();
      const hashes = (): string[] => ['ai.db', 'ai-cache.db'].map((f) => sha256(dataFile(home.path, f)));
      // Act / Assert: 재실행
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      expect(count()).toBe(before);
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
        ).toEqual(['ai-cache.db', 'ai.db']);
        expect(withDb(path.join(copyDir, 'ai.db'), true, modules)).toEqual(AI_MODULES);
      } finally {
        rmSync(copyDir, { recursive: true, force: true });
      }
    });
  });

  it('IT-415 sha 변조 → migrate·serve 78, DB 없음 serve → needs_migrate [FR-SET-007][FR-SET-002]', async () => {
    await withTempHome(async (home) => {
      // DB 없음
      const none = await bootServe(home.path);
      expect(none.fatal).toMatchObject({ type: 'fatal', exit_code: 78, code: 'needs_migrate' });
      expect(await none.exited).toBe(78);
      // sha 변조
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      expect(existsSync(dataFile(home.path, 'ai.db'))).toBe(true);
      writeAi(home.path, (db) => {
        db.prepare("UPDATE schema_migrations SET sha256 = :sha WHERE module = 'control'").run({ sha: '0'.repeat(64) });
      });
      const migrate = await runMode(home.path, ['--mode=migrate']);
      const served = await bootServe(home.path);
      expect(migrate.code).toBe(78);
      expect(served.fatal).toMatchObject({ type: 'fatal', exit_code: 78, code: 'schema_sha_mismatch' });
      expect(await served.exited).toBe(78);
    });
  });
});
