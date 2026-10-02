import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeClock } from '@fathom/testkit/clock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findForbiddenToken } from '../../../src/sqlite/migrate-lexer.js';
import type { MigrateOptions, MigrationDir, SqlitePort } from '../../../src/sqlite/sqlite.js';
import { migrate, openDb, readMigrationBundle, verifySchema } from '../../../src/sqlite/sqlite.js';

const INFRA_DIR = path.resolve(import.meta.dirname, '../../../infra-migrations');
const APP_ID = 0x46544354;
const clock = createFakeClock();

let sandbox = '';
const opened: SqlitePort[] = [];

function open(name = 'm.db'): SqlitePort {
  const db = openDb(path.join(sandbox, name), { synchronous: 'NORMAL' });
  opened.push(db);
  return db;
}

async function writeMigration(dir: string, file: string, body: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), body, 'utf8');
}

function opts(over: Partial<MigrateOptions> = {}): MigrateOptions {
  return { dryRun: false, profile: 'full', applicationId: APP_ID, clock, ...over };
}

function tableNames(db: SqlitePort): string[] {
  return db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => String(r.name));
}

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'fathom-sk-migrate-'));
});
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
  }
  await rm(sandbox, { recursive: true, force: true });
});

describe('금지 토큰 렉서', () => {
  it('UT-SK-082 CREATE TRIGGER … BEGIN … END; 본문(CASE 포함)은 통과한다 [FR-SET-007]', () => {
    const sql = `
CREATE TABLE t(a INTEGER, b INTEGER) STRICT;
CREATE TRIGGER t_no_update BEFORE UPDATE ON t
BEGIN
  SELECT RAISE(ABORT, 't is append-only');
END;
CREATE TEMP TRIGGER t_case AFTER INSERT ON t FOR EACH ROW
BEGIN
  UPDATE t SET b = CASE WHEN NEW.a > 1 THEN 1 ELSE 0 END WHERE a = NEW.a;
  INSERT INTO t(a) SELECT CASE WHEN 1 THEN 2 END WHERE 0;
END;
CREATE INDEX ix ON t(a);`;
    expect(findForbiddenToken(sql)).toBeNull();
    // 트리거 뒤 문장도 여전히 검사된다.
    expect(findForbiddenToken(`${sql}\nCOMMIT;`)).toMatchObject({ token: 'COMMIT', reason: 'forbidden' });
  });

  it('UT-SK-083 최상위 BEGIN·COMMIT·END·ROLLBACK·SAVEPOINT·RELEASE는 검출하고 대소문자를 무시한다 [FR-SET-007]', () => {
    for (const word of ['BEGIN', 'commit', 'End', 'ROLLBACK', 'savepoint', 'RELEASE']) {
      const v = findForbiddenToken(`CREATE TABLE t(a INTEGER);\n${word} x;\n`);
      expect(v, word).toMatchObject({ token: word, line: 2, reason: 'forbidden' });
    }
    expect(findForbiddenToken('BEGIN;\nCREATE TABLE t(a);')).toMatchObject({ token: 'BEGIN', line: 1 });
    // 문장 첫 키워드가 아니면 위반이 아니다: RAISE(ROLLBACK, …)·열 이름 end.
    expect(findForbiddenToken('CREATE TABLE t(end INTEGER, begin INTEGER);')).toBeNull();
    expect(findForbiddenToken(';;  ;\nCREATE TABLE t(a);')).toBeNull();
  });

  it('UT-SK-084 PRAGMA·ATTACH·DETACH·VACUUM·load_extension은 어디서든 검출한다 [FR-SET-007]', () => {
    expect(findForbiddenToken('PRAGMA foreign_keys=OFF;')).toMatchObject({ token: 'PRAGMA' });
    expect(findForbiddenToken('CREATE TABLE t(a);\nATTACH DATABASE x AS y;')).toMatchObject({
      token: 'ATTACH',
      line: 2,
    });
    expect(findForbiddenToken('DETACH y;')).toMatchObject({ token: 'DETACH' });
    expect(findForbiddenToken('VACUUM;')).toMatchObject({ token: 'VACUUM' });
    expect(findForbiddenToken('SELECT load_extension("x");')).toMatchObject({ token: 'load_extension' });
    expect(findForbiddenToken('SELECT 1 WHERE x IN (SELECT 1 FROM t WHERE vacuum = 1);')).toMatchObject({
      token: 'vacuum',
    });
    // 단독 토큰이 아닌 식별자는 통과한다.
    expect(findForbiddenToken('SELECT * FROM pragma_table_info("t");')).toBeNull();
    expect(findForbiddenToken('CREATE VIEW v AS SELECT 1 AS vacuum_count, 2 AS my_attach;')).toBeNull();
    // 주석·문자열·인용 식별자 안은 무시한다.
    const quiet = `-- PRAGMA x
/* VACUUM
   ATTACH */
CREATE TABLE t(a TEXT DEFAULT 'BEGIN; COMMIT; PRAGMA ''x''', "vacuum" TEXT, \`attach\` TEXT, [detach] TEXT);
INSERT INTO t(a) VALUES ('load_extension(');`;
    expect(findForbiddenToken(quiet)).toBeNull();
    // 닫히지 않은 따옴표·주석은 거부한다(뒤 토큰을 숨길 수 있다).
    expect(findForbiddenToken("SELECT 'abc; PRAGMA x;")).toMatchObject({ reason: 'unterminated' });
    expect(findForbiddenToken('/* never closed\nPRAGMA x;')).toMatchObject({ reason: 'unterminated' });
  });
});

describe('번들 읽기', () => {
  it('UT-SK-085 헤더 정규식: 모듈·version 불일치와 destructive+adr 없음은 header_invalid(78)다 [FR-SET-007]', async () => {
    const dir = path.join(sandbox, 'mod');
    const dirs: MigrationDir[] = [{ module: 'mod', dir }];
    const cases: [string, string][] = [
      ['-- @fathom:module=other version=1 kind=additive\nSELECT 1;\n', 'module'],
      ['-- @fathom:module=mod version=2 kind=additive\nSELECT 1;\n', 'version'],
      ['-- @fathom:module=mod version=1 kind=destructive\nSELECT 1;\n', 'adr'],
      ['-- @fathom:module=mod version=1 kind=other\nSELECT 1;\n', 'kind'],
      ['SELECT 1;\n-- @fathom:module=mod version=1 kind=additive\n', 'not first line'],
      ['-- @fathom:module=mod version=1 kind=additive profile=x\nSELECT 1;\n', 'profile'],
      ['-- @fathom:module=mod version=1 kind=additive fk=on\nSELECT 1;\n', 'fk'],
      ['-- @fathom:module=mod version=1 kind=additive  \nSELECT 1;\n', 'trailing blanks'],
    ];
    for (const [body, label] of cases) {
      await rm(dir, { recursive: true, force: true });
      await writeMigration(dir, '0001_a.sql', body);
      const r = readMigrationBundle(dirs);
      expect(r.ok, label).toBe(false);
      if (!r.ok) {
        expect(r.error, label).toMatchObject({ reason: 'header_invalid', exitCode: 78 });
        expect(r.error.file, label).toContain('0001_a.sql');
      }
    }
  });

  it('UT-SK-086 파일명 규칙 위반은 name_invalid, 번호 빈틈·중복은 gap이다(모두 78) [FR-SET-007]', async () => {
    const dir = path.join(sandbox, 'mod');
    const dirs: MigrationDir[] = [{ module: 'mod', dir }];
    const header = (n: number): string => `-- @fathom:module=mod version=${n} kind=additive\nSELECT ${n};\n`;
    for (const bad of ['1_a.sql', '0001-a.sql', '0001_A.sql', '0001_a b.sql', '00001_a.sql', '0001_.sql']) {
      await rm(dir, { recursive: true, force: true });
      await writeMigration(dir, bad, header(1));
      const r = readMigrationBundle(dirs);
      expect(r, bad).toMatchObject({ ok: false, error: { reason: 'name_invalid', exitCode: 78 } });
    }
    await rm(dir, { recursive: true, force: true });
    await writeMigration(dir, '0001_a.sql', header(1));
    await writeMigration(dir, '0003_c.sql', header(3));
    expect(readMigrationBundle(dirs)).toMatchObject({ ok: false, error: { reason: 'gap', exitCode: 78 } });
    await rm(dir, { recursive: true, force: true });
    await writeMigration(dir, '0002_b.sql', header(2));
    expect(readMigrationBundle(dirs)).toMatchObject({ ok: false, error: { reason: 'gap' } });
    await rm(dir, { recursive: true, force: true });
    await writeMigration(dir, '0001_a.sql', header(1));
    await writeMigration(dir, '0001_b.sql', header(1));
    expect(readMigrationBundle(dirs)).toMatchObject({ ok: false, error: { reason: 'gap' } });
    // .sql이 아닌 파일은 무시한다.
    await rm(dir, { recursive: true, force: true });
    await writeMigration(dir, '0001_a.sql', header(1));
    await writeMigration(dir, 'README.md', '# not a migration');
    expect(readMigrationBundle(dirs).ok).toBe(true);
    // 읽을 수 없는 디렉터리는 번호 빈틈(gap)이 아니라 I/O 오류(io_error)다(CO-14 d, T-01-01 §4.2-7).
    expect(readMigrationBundle([{ module: 'mod', dir: path.join(sandbox, 'absent') }])).toMatchObject({
      ok: false,
      error: { reason: 'io_error', exitCode: 78 },
    });
  });

  it('UT-SK-087 헤더 옵션(adr·fk=off·profile)을 파싱하고 금지 토큰은 forbidden_token이다 [FR-SET-007]', async () => {
    const dir = path.join(sandbox, 'mod');
    const dirs: MigrationDir[] = [{ module: 'mod', dir }];
    await writeMigration(
      dir,
      '0001_a.sql',
      '-- @fathom:module=mod version=1 kind=destructive adr=ADR-016 fk=off profile=meta,full\nSELECT 1;\n',
    );
    await writeMigration(dir, '0002_b.sql', '-- @fathom:module=mod version=2 kind=additive profile=full\nSELECT 2;\n');
    await writeMigration(dir, '0003_c.sql', '-- @fathom:module=mod version=3 kind=additive\nSELECT 3;\n');
    const bundle = readMigrationBundle(dirs);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) {
      return;
    }
    expect(bundle.value.map((f) => [f.version, f.name, f.kind, f.adr, f.fkOff, f.profiles])).toEqual([
      [1, 'a', 'destructive', 'ADR-016', true, ['meta', 'full']],
      [2, 'b', 'additive', null, false, ['full']],
      [3, 'c', 'additive', null, false, null],
    ]);

    await writeMigration(
      dir,
      '0004_d.sql',
      '-- @fathom:module=mod version=4 kind=additive\n\nCREATE TABLE d(a);\nPRAGMA x;\n',
    );
    const bad = readMigrationBundle(dirs);
    expect(bad).toMatchObject({ ok: false, error: { reason: 'forbidden_token', exitCode: 78 } });
    if (!bad.ok) {
      expect(bad.error.detail).toBe('PRAGMA at line 4');
    }
  });

  it('UT-SK-088 sha256은 파일 바이트 해시이고 디렉터리 배열 순서가 적용 순서다 [FR-SET-007]', async () => {
    const a = path.join(sandbox, 'a');
    const b = path.join(sandbox, 'b');
    const bodyA = '-- @fathom:module=ma version=1 kind=additive\nCREATE TABLE ta(x);\n';
    const bodyB = '-- @fathom:module=mb version=1 kind=additive\nCREATE TABLE tb(x);\n';
    await writeMigration(a, '0001_ta.sql', bodyA);
    await writeMigration(b, '0001_tb.sql', bodyB);
    const bundle = readMigrationBundle([
      { module: 'mb', dir: b },
      { module: 'ma', dir: a },
    ]);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) {
      return;
    }
    expect(bundle.value.map((f) => f.module)).toEqual(['mb', 'ma']);
    const { createHash } = await import('node:crypto');
    expect(bundle.value[1]?.sha256).toBe(createHash('sha256').update(bodyA).digest('hex'));
    expect(bundle.value[1]?.sql).toBe(bodyA);
  });
});

describe('프로파일 필터', () => {
  it('UT-SK-089 헤더 profile에 없는 파일은 건너뛰고 profile 없는 파일은 항상 적용한다 [FR-SET-007][NFR-DATA-003]', async () => {
    const dir = path.join(sandbox, 'mod');
    await writeMigration(
      dir,
      '0001_a.sql',
      '-- @fathom:module=mod version=1 kind=additive\nCREATE TABLE a(x) STRICT;\n'.replace('(x)', '(x INTEGER)'),
    );
    await writeMigration(
      dir,
      '0002_b.sql',
      '-- @fathom:module=mod version=2 kind=additive profile=full\nCREATE TABLE b(x INTEGER) STRICT;\n',
    );
    await writeMigration(
      dir,
      '0003_c.sql',
      '-- @fathom:module=mod version=3 kind=additive\nCREATE TABLE c(x INTEGER) STRICT;\n',
    );
    const dirs: MigrationDir[] = [
      { module: '_infra', dir: INFRA_DIR },
      { module: 'mod', dir },
    ];
    const db = open();
    const r = migrate(db, dirs, opts({ profile: 'meta' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.applied.map((a) => `${a.module}@${a.version}`)).toEqual(['_infra@1', 'mod@1', 'mod@3']);
      expect(r.value.schemaVersions).toEqual({ _infra: 1, mod: 3 });
    }
    expect(tableNames(db)).toEqual(['a', 'c', 'schema_migrations']);
    // 같은 프로파일로 다시 실행하면 적용 0, verifySchema도 같음
    expect(migrate(db, dirs, opts({ profile: 'meta' }))).toMatchObject({ ok: true, value: { applied: [] } });
    expect(verifySchema(db, dirs, { profile: 'meta' })).toMatchObject({ ok: true });
    // 프로파일 full을 가진 파일 목록은 같은 DB에서 필터가 다르다: 3이 먼저 적용돼 있으므로 2는 빈틈이다.
    expect(migrate(db, dirs, opts({ profile: 'full' }))).toMatchObject({
      ok: false,
      error: { reason: 'gap', exitCode: 78 },
    });
  });
});

describe('_infra DDL', () => {
  it('UT-SK-090 infra-migrations 0001~0003은 헤더·렉서 검사를 통과한다 [FR-SET-007][NFR-DATA-003]', () => {
    const bundle = readMigrationBundle([{ module: '_infra', dir: INFRA_DIR }]);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) {
      return;
    }
    expect(bundle.value.map((f) => [f.version, f.name, f.profiles])).toEqual([
      [1, 'schema_migrations', ['meta', 'full']],
      [2, 'eventing', ['full']],
      [3, 'idempotency', ['full']],
    ]);
    for (const f of bundle.value) {
      expect(f.kind).toBe('additive');
      expect(f.sql.endsWith('\n')).toBe(true);
      expect(f.sql.endsWith('\n\n')).toBe(false);
      expect(f.sql).not.toContain('\r');
    }
  });

  it('UT-SK-091 빈 DB에 _infra를 적용하면 STRICT 테이블 7개·schema_migrations 3행·application_id·WAL이 된다 [FR-SET-007][NFR-DATA-003]', () => {
    // Arrange
    const db = open();
    // Act
    const r = migrate(db, [{ module: '_infra', dir: INFRA_DIR }], opts());
    // Assert
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.applied.map((a) => a.version)).toEqual([1, 2, 3]);
    expect(r.value.pending).toEqual([]);
    expect(r.value.schemaVersions).toEqual({ _infra: 3 });
    expect(tableNames(db)).toEqual([
      'idem_request',
      'inbox_dead',
      'inbox_dedupe',
      'inbox_watermark',
      'outbox',
      'outbox_delivery',
      'schema_migrations',
    ]);
    const strict = db.prepare('SELECT name, strict FROM pragma_table_list WHERE schema = ?').all('main');
    for (const t of strict.filter((t) => !String(t.name).startsWith('sqlite_'))) {
      expect(t.strict, String(t.name)).toBe(1);
    }
    const rows = db.prepare('SELECT module, version, name, applied_at FROM schema_migrations ORDER BY version').all();
    expect(rows).toEqual([
      { module: '_infra', version: 1, name: 'schema_migrations', applied_at: clock.now() },
      { module: '_infra', version: 2, name: 'eventing', applied_at: clock.now() },
      { module: '_infra', version: 3, name: 'idempotency', applied_at: clock.now() },
    ]);
    expect(db.prepare('PRAGMA application_id').get()).toEqual({ application_id: APP_ID });
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    // 인덱스 4개 + idem 1개가 생겼다.
    const indexes = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'ix_%' ORDER BY name")
      .all();
    expect(indexes.length).toBe(5);
  });

  it('UT-SK-092 재실행은 적용 0이고 profile=meta는 0001만 적용한다 [FR-SET-007][NFR-DATA-003]', () => {
    const dirs = [{ module: '_infra', dir: INFRA_DIR }];
    const full = open('full.db');
    expect(migrate(full, dirs, opts()).ok).toBe(true);
    const again = migrate(full, dirs, opts());
    expect(again).toMatchObject({ ok: true, value: { applied: [], pending: [], schemaVersions: { _infra: 3 } } });

    const meta = open('meta.db');
    const r = migrate(meta, dirs, opts({ profile: 'meta' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.applied.map((a) => a.version)).toEqual([1]);
      expect(r.value.schemaVersions).toEqual({ _infra: 1 });
    }
    expect(tableNames(meta)).toEqual(['schema_migrations']);
    expect(migrate(meta, dirs, opts({ profile: 'meta' }))).toMatchObject({ ok: true, value: { applied: [] } });
  });
});

describe('migrate 실패 경로', () => {
  const INFRA: MigrationDir = { module: '_infra', dir: INFRA_DIR };
  const mo = (over: Partial<MigrateOptions> = {}): MigrateOptions => opts({ profile: 'meta', ...over });

  async function twoFiles(): Promise<MigrationDir[]> {
    const dir = path.join(sandbox, 'mod');
    await writeMigration(
      dir,
      '0001_a.sql',
      '-- @fathom:module=mod version=1 kind=additive\nCREATE TABLE a(x INTEGER) STRICT;\n',
    );
    await writeMigration(
      dir,
      '0002_b.sql',
      '-- @fathom:module=mod version=2 kind=additive\nCREATE TABLE b(x INTEGER) STRICT;\n',
    );
    return [INFRA, { module: 'mod', dir }];
  }

  it('UT-SK-005 적용된 파일 바이트 1개 변조 → sha_mismatch(78), 번호 빈틈 번들 → gap [FR-SET-007]', async () => {
    // Arrange
    const dirs = await twoFiles();
    const db = open();
    expect(migrate(db, dirs, mo()).ok).toBe(true);
    // Act: 파일 끝에 공백 1바이트(주석)를 덧붙인다.
    await appendFile(path.join(sandbox, 'mod', '0001_a.sql'), ' ', 'utf8');
    const tampered = migrate(db, dirs, mo());
    // Assert
    expect(tampered).toMatchObject({ ok: false, error: { reason: 'sha_mismatch', exitCode: 78 } });
    expect(verifySchema(db, dirs, { profile: 'meta' })).toMatchObject({ ok: false, error: { reason: 'sha_mismatch' } });
    // 번호 빈틈 번들
    await rm(path.join(sandbox, 'mod', '0001_a.sql'));
    expect(migrate(db, dirs, mo())).toMatchObject({ ok: false, error: { reason: 'gap', exitCode: 78 } });
  });

  it('UT-SK-093 application_id 불일치는 78이고 DB에만 있는 행은 downgrade(78)다 [FR-SET-007]', async () => {
    const dirs = await twoFiles();
    const wrong = open('wrong.db');
    wrong.exec('PRAGMA application_id = 12345');
    expect(migrate(wrong, dirs, mo())).toMatchObject({
      ok: false,
      error: { reason: 'application_id_mismatch', exitCode: 78 },
    });
    expect(wrong.prepare('SELECT count(*) AS c FROM sqlite_schema').get()).toEqual({ c: 0 });

    const db = open();
    expect(migrate(db, dirs, mo()).ok).toBe(true);
    db.prepare('INSERT INTO schema_migrations(module, version, name, sha256, applied_at) VALUES (?, ?, ?, ?, ?)').run(
      'mod',
      3,
      'future',
      'a'.repeat(64),
      1,
    );
    expect(migrate(db, dirs, mo())).toMatchObject({ ok: false, error: { reason: 'downgrade', exitCode: 78 } });
    expect(verifySchema(db, dirs, { profile: 'meta' })).toMatchObject({ ok: false, error: { reason: 'downgrade' } });
    // DB 행이 중간부터 비어 있으면 gap이다.
    db.prepare('DELETE FROM schema_migrations WHERE version IN (1, 3)').run();
    expect(migrate(db, dirs, mo())).toMatchObject({ ok: false, error: { reason: 'gap', exitCode: 78 } });
  });

  it('UT-SK-094 fk=off 경로: FK 위반 → ROLLBACK + apply_failed(1)이고 foreign_keys는 ON으로 복구된다 [FR-SET-007]', async () => {
    const dir = path.join(sandbox, 'mod');
    await writeMigration(
      dir,
      '0001_base.sql',
      '-- @fathom:module=mod version=1 kind=additive\nCREATE TABLE p(id INTEGER PRIMARY KEY) STRICT;\nCREATE TABLE c(id INTEGER PRIMARY KEY, pid INTEGER REFERENCES p(id)) STRICT;\n',
    );
    await writeMigration(
      dir,
      '0002_orphan.sql',
      '-- @fathom:module=mod version=2 kind=destructive adr=ADR-016 fk=off\nINSERT INTO c(id, pid) VALUES (1, 99);\n',
    );
    const dirs: MigrationDir[] = [INFRA, { module: 'mod', dir }];
    const db = open();
    const r = migrate(db, dirs, mo());
    expect(r).toMatchObject({ ok: false, error: { reason: 'apply_failed', exitCode: 1 } });
    expect(db.prepare('SELECT count(*) AS c FROM c').get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT module, version FROM schema_migrations WHERE module = 'mod'").all()).toEqual([
      { module: 'mod', version: 1 },
    ]);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });

    // 위반이 없는 fk=off 파일은 적용된다.
    await writeMigration(
      dir,
      '0002_orphan.sql',
      '-- @fathom:module=mod version=2 kind=destructive adr=ADR-016 fk=off\nINSERT INTO p(id) VALUES (1);\nINSERT INTO c(id, pid) VALUES (1, 1);\n',
    );
    const ok = migrate(db, dirs, mo());
    expect(ok).toMatchObject({ ok: true, value: { schemaVersions: { mod: 2 } } });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('UT-SK-095 적용 실패 시 그 파일만 ROLLBACK되고 앞 파일은 남는다(exit 1) [FR-SET-007]', async () => {
    const dir = path.join(sandbox, 'mod');
    await writeMigration(
      dir,
      '0001_a.sql',
      '-- @fathom:module=mod version=1 kind=additive\nCREATE TABLE a(x INTEGER) STRICT;\n',
    );
    await writeMigration(
      dir,
      '0002_bad.sql',
      '-- @fathom:module=mod version=2 kind=additive\nCREATE TABLE b(x INTEGER) STRICT;\nCREATE TABLE a(x INTEGER) STRICT;\n',
    );
    const db = open();
    const r = migrate(db, [INFRA, { module: 'mod', dir }], mo());
    expect(r).toMatchObject({ ok: false, error: { reason: 'apply_failed', exitCode: 1 } });
    if (!r.ok) {
      expect(r.error.file).toContain('0002_bad.sql');
      expect(r.error.detail).toMatch(/already exists/);
    }
    expect(tableNames(db)).toEqual(['a', 'schema_migrations']);
    expect(db.prepare("SELECT module, version FROM schema_migrations WHERE module = 'mod'").all()).toEqual([
      { module: 'mod', version: 1 },
    ]);
  });

  it('UT-SK-096 dryRun은 DB를 바꾸지 않고 pending 목록을 돌려준다 [FR-SET-007]', async () => {
    const dirs = await twoFiles();
    const db = open();
    const before = migrate(db, dirs, mo({ dryRun: true }));
    expect(before).toMatchObject({
      ok: true,
      value: {
        dryRun: true,
        applied: [],
        pending: [
          { module: '_infra', version: 1, name: 'schema_migrations' },
          { module: 'mod', version: 1, name: 'a' },
          { module: 'mod', version: 2, name: 'b' },
        ],
        schemaVersions: {},
      },
    });
    expect(db.prepare('SELECT count(*) AS c FROM sqlite_schema').get()).toEqual({ c: 0 });
    expect(db.prepare('PRAGMA application_id').get()).toEqual({ application_id: 0 });
    // 일부만 적용된 DB에서도 같다.
    const first = dirs[0];
    expect(first).toBeDefined();
    await rm(path.join(sandbox, 'mod', '0002_b.sql'));
    expect(migrate(db, dirs, mo()).ok).toBe(true);
    await writeMigration(
      path.join(sandbox, 'mod'),
      '0002_b.sql',
      '-- @fathom:module=mod version=2 kind=additive\nCREATE TABLE b(x INTEGER) STRICT;\n',
    );
    const mid = migrate(db, dirs, mo({ dryRun: true }));
    expect(mid).toMatchObject({
      ok: true,
      value: { pending: [{ version: 2 }], schemaVersions: { _infra: 1, mod: 1 } },
    });
    expect(tableNames(db)).toEqual(['a', 'schema_migrations']);
    // application_id가 다르면 dryRun도 거부한다.
    const other = open('other.db');
    other.exec('PRAGMA application_id = 7');
    expect(migrate(other, dirs, mo({ dryRun: true }))).toMatchObject({
      ok: false,
      error: { reason: 'application_id_mismatch' },
    });
  });

  it('UT-SK-097 verifySchema 4분기: 같음·needs_migrate·downgrade·sha_mismatch [FR-SET-007][NFR-DATA-003]', async () => {
    const dirs = await twoFiles();
    const db = open();
    // 비어 있는 DB = 뒤처짐
    expect(verifySchema(db, dirs, { profile: 'meta' })).toMatchObject({
      ok: false,
      error: { reason: 'needs_migrate', exitCode: 78 },
    });
    expect(migrate(db, dirs, mo()).ok).toBe(true);
    expect(verifySchema(db, dirs, { profile: 'meta' })).toEqual({
      ok: true,
      value: { schemaVersions: { _infra: 1, mod: 2 } },
    });
    // 번들이 새로워지면 뒤처짐
    await writeMigration(
      path.join(sandbox, 'mod'),
      '0003_c.sql',
      '-- @fathom:module=mod version=3 kind=additive\nCREATE TABLE c(x INTEGER) STRICT;\n',
    );
    expect(verifySchema(db, dirs, { profile: 'meta' })).toMatchObject({
      ok: false,
      error: { reason: 'needs_migrate' },
    });
    // 번들이 더 오래되면 downgrade
    await rm(path.join(sandbox, 'mod', '0003_c.sql'));
    await rm(path.join(sandbox, 'mod', '0002_b.sql'));
    expect(verifySchema(db, dirs, { profile: 'meta' })).toMatchObject({ ok: false, error: { reason: 'downgrade' } });
    // 프로파일 필터: meta DB는 _infra 0001만으로 같음이다.
    const meta = open('meta.db');
    const infra = [{ module: '_infra', dir: INFRA_DIR }];
    expect(migrate(meta, infra, opts({ profile: 'meta' })).ok).toBe(true);
    expect(verifySchema(meta, infra, { profile: 'meta' })).toEqual({
      ok: true,
      value: { schemaVersions: { _infra: 1 } },
    });
    expect(verifySchema(meta, infra, { profile: 'full' })).toMatchObject({
      ok: false,
      error: { reason: 'needs_migrate' },
    });
    // 원본 파일을 읽어 둔 바이트와 같은지 확인(변조 검출은 UT-SK-005)
    expect(
      (await readFile(path.join(INFRA_DIR, '0001_schema_migrations.sql'), 'utf8')).startsWith(
        '-- @fathom:module=_infra',
      ),
    ).toBe(true);
  });
});
