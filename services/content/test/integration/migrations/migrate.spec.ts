import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentDbPath, jsonLines, MIGRATIONS_ROOT, openWritable, queryRows, runMode, sha256File, withHome } from './support.js';

const MODULES = ['catalog', 'acquisition', 'itembank', 'grading', 'runner'] as const;
const INFRA_TABLES = [
  'idem_request',
  'inbox_dead',
  'inbox_dedupe',
  'inbox_watermark',
  'outbox',
  'outbox_delivery',
  'schema_migrations',
];

function migrationFiles(): { module: string; file: string; sql: string }[] {
  return MODULES.flatMap((module) =>
    readdirSync(path.join(MIGRATIONS_ROOT, module))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((file) => ({ module, file, sql: readFileSync(path.join(MIGRATIONS_ROOT, module, file), 'utf8') })),
  );
}

/** 주석 줄을 뺀 SQL에서 `CREATE <kind> [IF NOT EXISTS] <name>`의 이름을 센다. */
function createdNames(kind: string): string[] {
  const re = new RegExp(`^\\s*CREATE\\s+${kind}\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([A-Za-z_][A-Za-z0-9_]*)`, 'gim');
  return migrationFiles().flatMap((f) => {
    const code = f.sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    return [...code.matchAll(re)].map((m) => m[1] ?? '');
  });
}

describe('content migrate (자식 프로세스)', () => {
  it('IT-210 빈 HOME --mode=migrate → exit 0·application_id FTCT·wal·STRICT·무결성·테이블 53+7·뷰 7·FTS5 3·트리거 19·schema_migrations 9행 [ADR-002][DR-020][E0-4]', async () => {
    await withHome(async (home) => {
      // Arrange / Act
      const result = await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      // Assert
      expect(result.code).toBe(0);
      expect(jsonLines(result).find((l) => l.event === 'mode.migrate.completed')).toMatchObject({
        level: 'info',
        dry_run: false,
        databases: { 'content.db': { applied: 9, pending: 0 } },
      });
      const file = contentDbPath(home.path);
      expect(await queryRows(file, 'PRAGMA application_id')).toEqual([{ application_id: 0x46544354 }]);
      expect(await queryRows(file, 'PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
      expect(await queryRows(file, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      expect(await queryRows(file, 'PRAGMA foreign_key_check')).toEqual([]);
      const tables = await queryRows(
        file,
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      expect(tables.filter((t) => t.strict !== 1).map((t) => t.name)).toEqual([]); // 전 테이블 STRICT
      const fromFiles = createdNames('TABLE');
      expect(fromFiles).toHaveLength(53);
      expect(tables.map((t) => t.name)).toEqual([...fromFiles, ...INFRA_TABLES].sort());
      expect(await queryRows(file, "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'view'")).toEqual([{ n: 7 }]);
      expect(await queryRows(file, "SELECT count(*) AS n FROM sqlite_schema WHERE type = 'trigger'")).toEqual([
        { n: 19 },
      ]);
      expect(
        await queryRows(file, "SELECT count(*) AS n FROM sqlite_schema WHERE sql LIKE 'CREATE VIRTUAL TABLE%fts5%'"),
      ).toEqual([{ n: 3 }]);
      expect(createdNames('VIEW')).toHaveLength(7);
      expect(createdNames('TRIGGER')).toHaveLength(19);
      expect(createdNames('VIRTUAL TABLE')).toHaveLength(3);
      expect(await queryRows(file, 'SELECT module, version FROM schema_migrations ORDER BY module, version')).toEqual([
        { module: '_infra', version: 1 },
        { module: '_infra', version: 2 },
        { module: '_infra', version: 3 },
        { module: 'acquisition', version: 1 },
        { module: 'catalog', version: 1 },
        { module: 'catalog', version: 2 },
        { module: 'grading', version: 1 },
        { module: 'itembank', version: 1 },
        { module: 'runner', version: 1 },
      ]);
    });
  }, 60_000);

  it('IT-211 재실행 → 적용 0·exit 0 · --dry-run 단독 → DB 무변경 [ADR-002][E0-4]', async () => {
    await withHome(async (home) => {
      // Arrange: 빈 HOME dry-run은 파일을 만들지 않는다
      const dry = await runMode(['--mode=migrate', '--dry-run'], { FATHOM_HOME: home.path });
      expect(dry.code).toBe(0);
      expect(jsonLines(dry).find((l) => l.event === 'mode.migrate.completed')).toMatchObject({
        dry_run: true,
        databases: { 'content.db': { applied: 0, pending: 9 } },
      });
      expect(existsSync(path.join(home.path, 'data'))).toBe(false);
      // Act: 적용 후 재실행
      expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home.path })).code).toBe(0);
      const again = await runMode(['--mode=migrate'], { FATHOM_HOME: home.path });
      // Assert
      expect(again.code).toBe(0);
      expect(jsonLines(again).find((l) => l.event === 'mode.migrate.completed')).toMatchObject({
        databases: { 'content.db': { applied: 0, pending: 0 } },
      });
      // 적용된 DB에 dry-run → 바이트·mtime 불변
      const file = contentDbPath(home.path);
      const before = { hash: sha256File(file), mtime: statSync(file).mtimeMs };
      expect((await runMode(['--mode=migrate', '--dry-run'], { FATHOM_HOME: home.path })).code).toBe(0);
      expect(sha256File(file)).toBe(before.hash);
      expect(statSync(file).mtimeMs).toBe(before.mtime);
    });
  }, 60_000);

  it('IT-212 --db-copy-dir=<tmp> → 사본에만 적용·원본 sha256 불변 [ADR-002][E0-4]', async () => {
    await withHome(async (home) => {
      // Arrange: 원본은 catalog까지 적용된 상태가 아니라 완전 적용 상태 — 사본 실행이 원본을 건드리지 않는지만 본다
      expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home.path })).code).toBe(0);
      const live = contentDbPath(home.path);
      const before = sha256File(live);
      const copyDir = path.join(home.path, 'copy');
      mkdirSync(copyDir);
      // Act
      const copy = await runMode(['--mode=migrate', '--dry-run', `--db-copy-dir=${copyDir}`], {
        FATHOM_HOME: home.path,
      });
      // Assert
      expect(copy.code).toBe(0);
      expect(sha256File(live)).toBe(before);
      expect(await queryRows(path.join(copyDir, 'content.db'), 'SELECT count(*) AS n FROM schema_migrations')).toEqual([
        { n: 9 },
      ]);
    });
  }, 60_000);

  it('IT-213 적용 파일 변조(schema_migrations.sha256 불일치) → migrate exit 78 [DB-01 §11.3][E0-4]', async () => {
    await withHome(async (home) => {
      // Arrange
      expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home.path })).code).toBe(0);
      const db = await openWritable(contentDbPath(home.path));
      db.prepare("UPDATE schema_migrations SET sha256 = :s WHERE module = 'catalog' AND version = 1").run({
        s: 'f'.repeat(64),
      });
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
  }, 60_000);

  it('IT-215 DR-020 이름 훅 열 존재 + ext 열이 있는 테이블은 ext_v도 있다 [DR-020][E0-5]', async () => {
    await withHome(async (home) => {
      // Arrange
      expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home.path })).code).toBe(0);
      const file = contentDbPath(home.path);
      const columns = async (table: string): Promise<string[]> =>
        (await queryRows(file, `SELECT name FROM pragma_table_info('${table}')`)).map((r) => String(r.name));
      const hooks: Record<string, string[]> = {
        ct_pack: ['channel'],
        ct_track: ['offline_cap_level'],
        ct_concept: ['volatility', 'required_for_level'],
        ct_ku: ['valid_as_of', 'deprecated_by', 'scope'],
        ct_misconception: ['meta_family', 'status'],
        ct_case: ['variant_params', 'root_cause_pool', 'best_if', 'contested'],
        ct_overlay_event: ['base_version'],
        aq_inbox_item: ['source_kind'],
        ib_item: ['source_kind', 'stem_family', 'gate_status', 'defect_manifest'],
      };
      // Act / Assert
      for (const [table, expected] of Object.entries(hooks)) {
        const have = await columns(table);
        for (const column of expected) {
          expect(have, `${table}.${column}`).toContain(column);
        }
      }
      const tables = await queryRows(
        file,
        "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'",
      );
      for (const t of tables) {
        const have = await columns(String(t.name));
        if (have.includes('ext')) {
          expect(have, `${String(t.name)}.ext_v`).toContain('ext_v');
        }
      }
    });
  }, 60_000);

  it('IT-216 전사 충실도: DB-01 §5.5 SQL 블록 6개 = 마이그레이션 파일(끝 줄바꿈 정규화만) [DB-01 §5.5]', () => {
    // Arrange
    const doc = readFileSync(path.join(MIGRATIONS_ROOT, '../../../docs/02-design/03-database-design.md'), 'utf8');
    const section = doc.slice(doc.indexOf('### 5.5 DDL'), doc.indexOf('## 6. learning.db'));
    const blocks = [
      ...section.matchAll(/`(services\/content\/migrations\/[a-z]+\/\d{4}_[a-z_]+\.sql)`\n\n```sql\n([\s\S]*?)\n```/g),
    ];
    // Act / Assert
    expect(blocks).toHaveLength(6);
    for (const block of blocks) {
      const rel = block[1] ?? '';
      const onDisk = readFileSync(path.join(MIGRATIONS_ROOT, '../../../', rel), 'utf8');
      expect(onDisk.replace(/\n+$/, ''), rel).toBe(block[2] ?? '');
      expect(onDisk.endsWith('\n') && !onDisk.endsWith('\n\n'), `${rel} 끝 줄바꿈 1개`).toBe(true);
      expect(onDisk.includes('\r'), `${rel} LF`).toBe(false);
    }
  });

  it('IT-218 append-only 트리거(gr_verdict UPDATE·DELETE → ABORT)와 ct_search_doc → ct_fts_tri 동기화 스모크 [DR-019][FR-CUR-011]', async () => {
    await withHome(async (home) => {
      // Arrange
      expect((await runMode(['--mode=migrate'], { FATHOM_HOME: home.path })).code).toBe(0);
      const db = await openWritable(contentDbPath(home.path));
      try {
        db.exec('PRAGMA foreign_keys = OFF'); // 부모 행(gr_attempt·ct_pack) 없이 트리거만 본다
        const ulid26 = (n: number): string => String(n).padStart(26, '0');
        db.prepare(
          `INSERT INTO gr_verdict(verdict_id, attempt_id, item_id, item_content_hash, result, band, score, grader_engine,
             calibrated, pending, provisional, w_format, w_grader, gaming_factor, ai_mode, content_policy_version,
             verdict_json, issued_at)
           VALUES (:v, :a, 'i', :h, 'correct', 'right', 1, 'D', 0, 0, 0, 1, 1, 1, 'OFFLINE', 'ps_0000000000000000', '{}', 1)`,
        ).run({ v: ulid26(1), a: ulid26(2), h: 'a'.repeat(64) });
        // Act / Assert: append-only
        expect(() => db.prepare("UPDATE gr_verdict SET result = 'incorrect'").run()).toThrow(/append-only/);
        expect(() => db.prepare('DELETE FROM gr_verdict').run()).toThrow(/append-only/);
        expect(db.prepare('SELECT count(*) AS n FROM gr_verdict').get()).toEqual({ n: 1 });
        // FTS 동기화: 삽입 → MATCH 1건, 삭제 → 0건
        db.prepare(
          `INSERT INTO ct_search_doc(doc_id, install_id, kind, ref_id, concept_id, track_id, title, alias, body, ntext, compact)
           VALUES (1, :i, 'concept', 'k8s.probes', 'k8s.probes', 'k8s', 'readiness probe', '', '', 'readiness probe', 'readinessprobe')`,
        ).run({ i: ulid26(3) });
        expect(db.prepare("SELECT rowid AS r FROM ct_fts_tri WHERE ct_fts_tri MATCH 'readiness'").all()).toEqual([
          { r: 1 },
        ]);
        db.prepare('DELETE FROM ct_search_doc WHERE doc_id = 1').run();
        expect(db.prepare("SELECT rowid AS r FROM ct_fts_tri WHERE ct_fts_tri MATCH 'readiness'").all()).toEqual([]);
      } finally {
        db.close();
      }
    });
  }, 60_000);
});
