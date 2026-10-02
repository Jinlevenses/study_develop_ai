import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DB_EXT_TABLES } from '@fathom/contracts/db-hooks';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { describe, expect, it } from 'vitest';
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

const dataFile = (home: string, file = 'ops.db'): string => path.join(home, 'data', file);
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

function withDb<T>(file: string, readOnly: boolean, fn: (db: SqlitePort) => T): T {
  const db = openDb(file, { synchronous: 'NORMAL', recursiveTriggers: false, readOnly });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
const readOps = <T>(home: string, fn: (db: SqlitePort) => T): T => withDb(dataFile(home), true, fn);

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
const OPS_MODULES = ['_infra@1', '_infra@2', '_infra@3', 'backup@1', 'health@1', 'telemetry@1', 'upgrade@1'];

describe('ops-api 마이그레이션', () => {
  it('IT-510 빈 HOME --mode=migrate → exit 0, ops.db 모듈 · §17.1 #26~#30 [FR-SET-007][NFR-DATA-008]', async () => {
    await withTempHome(async (home) => {
      // Act
      const run = await runMode(home.path, ['--mode=migrate']);
      // Assert
      expect(run.code).toBe(0);
      expect(readOps(home.path, modules)).toEqual(OPS_MODULES);
      expect(run.stdout.some((l) => l.includes('mode.migrate.completed'))).toBe(true);
      const facts = readOps(home.path, (db) => ({
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
      expect(facts.integrity).toEqual([{ integrity_check: 'ok' }]);
      expect(facts.fk).toEqual([]);
      expect(facts.appId).toBe(0x46544f50);
      expect(facts.journal).toBe('wal');
      expect(facts.nonStrict).toEqual([]);
    });
  });

  it('IT-511 테이블 집합 = 테이블정의서 15 + _infra 7 · DB_EXT_TABLES ops 행 [NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const spec = specTables('### 10.1 테이블정의서', '### 10.2 DDL');
      // Assert
      expect(spec).toHaveLength(15);
      expect(readOps(home.path, tableNames)).toEqual([...spec, ...INFRA_TABLES].sort());
      readOps(home.path, (db) => {
        const ext = DB_EXT_TABLES.filter((t) => t.db === 'ops.db');
        expect(ext.map((t) => t.table)).toEqual(['op_backup', 'op_upgrade']);
        for (const t of ext) {
          const columns = db
            .prepare('SELECT name FROM pragma_table_info(:t)')
            .all({ t: t.table })
            .map((r) => String(r.name));
          expect(columns, t.table).toEqual(expect.arrayContaining(['ext', 'ext_v']));
        }
      });
    });
  });

  it('IT-512 DDL 4개 = DB-01 코드 블록 바이트 동일 [NFR-DATA-003]', () => {
    const files = [
      'services/ops/migrations/backup/0001_backup_core.sql',
      'services/ops/migrations/health/0001_health_core.sql',
      'services/ops/migrations/telemetry/0001_telemetry_core.sql',
      'services/ops/migrations/upgrade/0001_upgrade_core.sql',
    ];
    for (const rel of files) {
      // Act
      const bytes = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      // Assert
      expect(bytes, rel).toBe(ddlBlock(rel));
      expect(bytes.includes('\r'), rel).toBe(false);
      expect(bytes.endsWith('\n') && !bytes.endsWith('\n\n'), rel).toBe(true);
      expect(bytes.split('\n')[0], rel).toBe(
        `-- @fathom:module=${path.basename(path.dirname(rel))} version=1 kind=additive`,
      );
      expect(path.basename(rel).startsWith('0001_'), rel).toBe(true);
    }
    expect(readdirSync(path.join(SERVICE_DIR, 'migrations')).sort()).toEqual([
      'backup',
      'health',
      'telemetry',
      'upgrade',
    ]);
  });

  it('IT-513 재실행·--dry-run·--db-copy-dir [FR-SET-007]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const count = (): unknown =>
        readOps(home.path, (db) => db.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n);
      const before = count();
      // Act / Assert: 재실행
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      expect(count()).toBe(before);
      // dry-run 단독
      const hash = sha256(dataFile(home.path));
      expect((await runMode(home.path, ['--mode=migrate', '--dry-run'])).code).toBe(0);
      expect(sha256(dataFile(home.path))).toBe(hash);
      // dry-run + 사본 디렉터리
      const copyDir = mkdtempSync(path.join(tmpdir(), 'fathom-copy-'));
      try {
        expect((await runMode(home.path, ['--mode=migrate', '--dry-run', `--db-copy-dir=${copyDir}`])).code).toBe(0);
        expect(sha256(dataFile(home.path))).toBe(hash);
        expect(readdirSync(copyDir).filter((f) => f.endsWith('.db'))).toEqual(['ops.db']);
        expect(withDb(path.join(copyDir, 'ops.db'), true, modules)).toEqual(OPS_MODULES);
      } finally {
        rmSync(copyDir, { recursive: true, force: true });
      }
    });
  });

  it('IT-514 sha 변조 → migrate·serve 78, DB 없음 serve → needs_migrate [FR-SET-007][FR-SET-002]', async () => {
    await withTempHome(async (home) => {
      // DB 없음
      const none = await bootServe(home.path);
      expect(none.fatal).toMatchObject({ type: 'fatal', exit_code: 78, code: 'needs_migrate' });
      expect(await none.exited).toBe(78);
      // sha 변조
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      withDb(dataFile(home.path), false, (db) => {
        db.prepare("UPDATE schema_migrations SET sha256 = :sha WHERE module = 'backup'").run({ sha: '0'.repeat(64) });
      });
      const migrate = await runMode(home.path, ['--mode=migrate']);
      const served = await bootServe(home.path);
      expect(migrate.code).toBe(78);
      expect(served.fatal).toMatchObject({ type: 'fatal', exit_code: 78, code: 'schema_sha_mismatch' });
      expect(await served.exited).toBe(78);
    });
  });
});
