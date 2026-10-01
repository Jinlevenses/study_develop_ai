import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createFakeClock } from '@fathom/testkit/clock';
import { describe, expect, it } from 'vitest';
import { rewindCursors } from '../../../src/eventing/rewind.js';
import { createJobRunner } from '../../../src/jobs/jobs.js';
import { migrate, openDb, vacuumInto } from '../../../src/sqlite/sqlite.js';
import { EXEC_ARGV, FIXTURE_MIGRATIONS, FULL, MAIN } from './fixtures/def.js';
import { jsonLines, runMode, withHome } from './harness.js';

const infra = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../infra-migrations');
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
const rows = (file: string, sql: string): Record<string, unknown>[] => {
  const db = openDb(file, { readOnly: true, synchronous: 'NORMAL' });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};

describe('--mode=migrate (자식 프로세스)', () => {
  it('UT-SK-191 빈 HOME → 파일 생성·_infra 3 + fixture 적용·exit 0, 재실행 적용 0 [FR-SET-007][NFR-DATA-012]', async () => {
    await withHome(async (home) => {
      // Arrange / Act
      const first = await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      // Assert
      expect(first.code).toBe(0);
      const done = jsonLines(first).find((l) => l.event === 'mode.migrate.completed');
      expect(done).toMatchObject({
        level: 'info',
        dry_run: false,
        databases: { 'content.db': { applied: 4, pending: 0 }, 'derived.db': { applied: 1, pending: 0 } },
      });
      const content = path.join(home.path, 'data', 'content.db');
      expect(rows(content, 'SELECT module, version FROM schema_migrations ORDER BY module, version')).toEqual([
        { module: '_infra', version: 1 },
        { module: '_infra', version: 2 },
        { module: '_infra', version: 3 },
        { module: 'fixture', version: 1 },
      ]);
      expect(rows(path.join(home.path, 'data', 'derived.db'), 'SELECT module FROM schema_migrations')).toEqual([
        { module: '_infra' },
      ]); // meta = 0001만
      // 재실행: 적용 0
      const again = await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      expect(again.code).toBe(0);
      expect(jsonLines(again).find((l) => l.event === 'mode.migrate.completed')).toMatchObject({
        databases: { 'content.db': { applied: 0, pending: 0 } },
      });
    });
  });

  it('UT-SK-191 --dry-run 단독 = DB 무변경(파일 생성도 없음), --db-copy-dir = 원본 무변경·사본에 적용 [FR-SET-007][NFR-DATA-012]', async () => {
    await withHome(async (home) => {
      // Arrange / Act: 빈 HOME에서 dry-run
      const dry = await runMode(['--mode=migrate', '--dry-run'], { FATHOM_HOME: home.path });
      // Assert
      expect(dry.code).toBe(0);
      expect(jsonLines(dry).find((l) => l.event === 'mode.migrate.completed')).toMatchObject({
        dry_run: true,
        databases: { 'content.db': { applied: 0, pending: 4 } },
      });
      expect(existsSync(path.join(home.path, 'data'))).toBe(false);
      // 사본 실행: 원본은 만들어지지 않고 사본에만 적용된다
      const copyDir = path.join(home.path, 'copy');
      mkdirSync(copyDir);
      const copy = await runMode(['--mode=migrate', '--dry-run', `--db-copy-dir=${copyDir}`], {
        FATHOM_HOME: home.path,
      });
      expect(copy.code).toBe(0);
      expect(existsSync(path.join(home.path, 'data', 'content.db'))).toBe(false);
      expect(rows(path.join(copyDir, 'content.db'), 'SELECT count(*) AS n FROM schema_migrations')).toEqual([{ n: 4 }]);
      // 이미 적용된 DB에 dry-run → 바이트 불변
      await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      const file = path.join(home.path, 'data', 'content.db');
      const before = { hash: sha(file), mtime: statSync(file).mtimeMs };
      const noop = await runMode(['--mode=migrate', '--dry-run'], { FATHOM_HOME: home.path });
      expect(noop.code).toBe(0);
      expect(sha(file)).toBe(before.hash);
      expect(statSync(file).mtimeMs).toBe(before.mtime);
    });
  });

  it('UT-SK-191 적용 파일 변조(sha 불일치) → 78 + fatal 로그 [FR-SET-007][NFR-DATA-012]', async () => {
    await withHome(async (home) => {
      // Arrange
      await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      const db = openDb(path.join(home.path, 'data', 'content.db'), { synchronous: 'NORMAL' });
      db.prepare("UPDATE schema_migrations SET sha256 = :s WHERE module = 'fixture'").run({ s: 'f'.repeat(64) });
      db.close();
      // Act
      const result = await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      // Assert
      expect(result.code).toBe(78);
      expect(jsonLines(result).find((l) => l.event === 'mode.migrate.failed')).toMatchObject({
        level: 'fatal',
        reason: 'sha_mismatch',
        db: 'content.db',
      });
    });
  });
});

describe('--mode=restore (자식 프로세스)', () => {
  /** 백업 사본 `<snap>/content.db`(커서·행 포함)와 라이브 DB(다른 내용 + wal/shm 잔재)를 만든다. */
  async function setup(home: string): Promise<{ snap: string; live: string }> {
    expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home })).code).toBe(0);
    const live = path.join(home, 'data', 'content.db');
    // 백업 원본: fx_item 1행, learning durable 커서 50
    const src = openDb(live, { synchronous: 'NORMAL' });
    src.prepare("INSERT INTO fx_item(id, name) VALUES (1, 'from-backup')").run();
    src
      .prepare(
        "INSERT INTO outbox_delivery(dest, mode, last_acked_seq, attempts, updated_at) VALUES ('learning', 'durable', 50, 3, 0)",
      )
      .run();
    src
      .prepare("INSERT INTO outbox_delivery(dest, mode, last_acked_seq, updated_at) VALUES ('gateway', 'notify', 9, 0)")
      .run();
    const snap = path.join(home, 'backups', 'snap', 'E1');
    mkdirSync(snap, { recursive: true });
    const copied = await vacuumInto(src, path.join(snap, 'content.db'));
    expect(copied.ok).toBe(true);
    // 라이브는 백업 이후 달라진다
    src.prepare("INSERT INTO fx_item(id, name) VALUES (2, 'after-backup')").run();
    src.close();
    writeFileSync(`${live}-wal`, 'stale wal');
    writeFileSync(`${live}-shm`, 'stale shm');
    // 파생 DB(meta)에는 흔적 표를 남긴다
    const derived = openDb(path.join(home, 'data', 'derived.db'), { synchronous: 'NORMAL' });
    derived.exec('CREATE TABLE leftover(x INTEGER)');
    derived.close();
    return { snap, live };
  }

  it('UT-SK-192 사본 교체·wal/shm 삭제·커서 되감기·meta DB 재생성 [FR-SET-007][NFR-DATA-012]', async () => {
    await withHome(async (home) => {
      // Arrange
      const { snap, live } = await setup(home.path);
      // Act
      const result = await runMode(
        ['--mode=restore', `--from=${snap}`, '--rewind-cursors={"learning":7,"gateway":0}'],
        { FATHOM_HOME: home.path },
      );
      // Assert
      expect(result.code).toBe(0);
      expect(jsonLines(result).find((l) => l.event === 'mode.restore.completed')).toMatchObject({ level: 'info' });
      expect(existsSync(`${live}-wal`)).toBe(false); // 읽기 연결을 열기 전에 본다(열면 -shm이 다시 생긴다)
      expect(existsSync(`${live}-shm`)).toBe(false);
      expect(existsSync(`${live}.restore-tmp`)).toBe(false);
      expect(rows(live, 'SELECT id, name FROM fx_item ORDER BY id')).toEqual([{ id: 1, name: 'from-backup' }]);
      expect(rows(live, 'SELECT dest, last_acked_seq, attempts FROM outbox_delivery ORDER BY dest')).toEqual([
        { dest: 'gateway', last_acked_seq: 9, attempts: 0 }, // notify는 되감기 대상이 아니다
        { dest: 'learning', last_acked_seq: 7, attempts: 0 },
      ]);
      expect(
        rows(path.join(home.path, 'data', 'derived.db'), "SELECT name FROM sqlite_schema WHERE name = 'leftover'"),
      ).toEqual([]);
      expect(rows(path.join(home.path, 'data', 'derived.db'), 'SELECT module FROM schema_migrations')).toEqual([
        { module: '_infra' },
      ]);
    });
  });

  it('UT-SK-192 원본 없음 → 78, 원본 application_id 불일치 → 78, 인자 오류 → 64 [FR-SET-007][NFR-DATA-012]', async () => {
    await withHome(async (home) => {
      // Arrange
      const { snap, live } = await setup(home.path);
      const before = sha(live);
      // Act / Assert: 원본 없음
      const missing = await runMode(['--mode=restore', `--from=${path.join(home.path, 'nowhere')}`], {
        FATHOM_HOME: home.path,
      });
      expect(missing.code).toBe(78);
      expect(jsonLines(missing).find((l) => l.event === 'mode.restore.failed')).toMatchObject({
        reason: 'source_missing',
      });
      expect(sha(live)).toBe(before); // 라이브는 건드리지 않았다
      // 다른 DB 파일(application_id 다름)
      const alien = path.join(home.path, 'alien');
      mkdirSync(alien);
      const other = openDb(path.join(alien, 'content.db'), { synchronous: 'NORMAL' });
      expect(
        migrate(other, [{ module: '_infra', dir: infra }], {
          dryRun: false,
          profile: 'full',
          applicationId: 1_234_567,
          clock: createFakeClock(),
        }).ok,
      ).toBe(true);
      other.close();
      const mismatch = await runMode(['--mode=restore', `--from=${alien}`], { FATHOM_HOME: home.path });
      expect(mismatch.code).toBe(78);
      expect(jsonLines(mismatch).find((l) => l.event === 'mode.restore.failed')).toMatchObject({
        reason: 'application_id_mismatch',
      });
      // 인자 오류
      for (const argv of [
        ['--mode=restore'],
        ['--mode=restore', '--from=relative'],
        ['--mode=restore', `--from=${snap}`, '--rewind-cursors=oops'],
      ]) {
        expect((await runMode(argv, { FATHOM_HOME: home.path })).code, argv.join(' ')).toBe(64);
      }
    });
  });
});

describe('--mode=job (자식 프로세스)', () => {
  it('UT-SK-193 integrity job은 정상 종료(0)하고 모르는 job은 64다 [FR-SET-007][NFR-DATA-012]', async () => {
    await withHome(async (home) => {
      // Arrange
      expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home.path })).code).toBe(0);
      const runner = createJobRunner({
        entry: MAIN,
        execArgv: EXEC_ARGV,
        onStdoutLine: () => undefined,
        onStderrLine: () => undefined,
      });
      // Act
      const result = await runner.run('integrity', { level: 'quick', home: home.path }, { timeoutMs: 30_000 });
      // Assert
      expect(result).toMatchObject({
        ok: true,
        value: {
          svc: 'content',
          level: 'quick',
          ok: true,
          files: [{ file: 'content.db', check: 'ok', foreign_key_violations: 0 }],
        },
      });
      await runner.shutdown();
      // 모르는 job 이름은 argv 검증에서 64
      expect((await runMode(['--mode=job', '--job=no-such-job'], { FATHOM_HOME: home.path })).code).toBe(64);
      // 정의에 없는 job(JobName에는 있음)은 프로토콜 오류 → 자식이 64로 끝난다
      const other = createJobRunner({
        entry: MAIN,
        execArgv: EXEC_ARGV,
        onStdoutLine: () => undefined,
        onStderrLine: () => undefined,
      });
      const unknown = await other.run('merge', {}, { timeoutMs: 30_000 });
      expect(unknown).toMatchObject({ ok: false, error: { kind: 'job_error', code: 'protocol', exitCode: 64 } });
      await other.shutdown();
      expect(FULL.file).toBe('content.db');
      expect(FIXTURE_MIGRATIONS.endsWith('fixture/')).toBe(true);
    });
  }, 60_000);
});

describe('경고 필터', () => {
  it('UT-SK-194 --disable-warning 없이 migrate: stderr에 ExperimentalWarning 0줄, 다른 경고는 그대로 통과 [NFR-PORT-009]', async () => {
    await withHome(async (home) => {
      // Arrange / Act
      const result = await runMode(
        ['--mode=migrate'],
        { FATHOM_HOME: home.path },
        { execArgv: ['--import', 'tsx', '--conditions=source'], entry: path.join(path.dirname(MAIN), 'warn-main.ts') },
      );
      // Assert
      expect(result.code).toBe(0);
      expect(result.stderr.filter((l) => l.includes('ExperimentalWarning'))).toEqual([]);
      expect(result.stderr.filter((l) => l.includes('DeprecationWarning: x'))).toHaveLength(1);
      expect(existsSync(path.join(home.path, 'data', 'content.db'))).toBe(true);
    });
  });

  it('UT-SK-194 대조군: 필터 없이 node:sqlite를 직접 불러오면 ExperimentalWarning이 나온다(필터가 실제로 일한다는 증거) [NFR-PORT-009]', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['-e', "import('node:sqlite')"], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    });
    expect(r.stderr).toContain('ExperimentalWarning');
    expect(rewindCursors).toBeTypeOf('function');
  });
});
