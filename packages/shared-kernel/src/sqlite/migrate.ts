import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { sqlInt } from './fragments.js';
import { findForbiddenToken } from './migrate-lexer.js';
import type { SqlitePort } from './sqlite.js';

// DB-01 §11 — 마이그레이션 실행기. 번들(파일 → 검증된 `MigrationFile`) 읽기는 기동 시 1회라 동기 fs를 쓴다.

export type MigrationDir = { readonly module: string; readonly dir: string };
export type MigrationFile = {
  readonly module: string;
  readonly version: number;
  readonly name: string;
  readonly file: string;
  readonly sha256: string;
  readonly kind: 'additive' | 'destructive';
  readonly adr: string | null;
  readonly fkOff: boolean;
  readonly profiles: readonly ('meta' | 'full')[] | null;
  readonly sql: string;
};
export type MigrateFailure = {
  readonly reason:
    | 'header_invalid'
    | 'name_invalid'
    | 'gap'
    | 'forbidden_token'
    | 'application_id_mismatch'
    | 'sha_mismatch'
    | 'downgrade'
    | 'needs_migrate'
    | 'apply_failed'
    | 'integrity_failed';
  readonly exitCode: 1 | 78;
  readonly file: string | null;
  readonly detail: string;
};
export type MigrateOptions = {
  readonly dryRun: boolean;
  readonly profile: 'meta' | 'full';
  readonly applicationId: number;
  readonly clock: Clock;
};
export type MigrateReport = {
  readonly dryRun: boolean;
  readonly applied: readonly { module: string; version: number; name: string; sha256: string }[];
  readonly pending: readonly { module: string; version: number; name: string }[];
  readonly schemaVersions: Readonly<Record<string, number>>;
};

const FILE_NAME_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const HEADER_RE =
  /^-- @fathom:module=([a-z_][a-z0-9_-]*) version=(\d+) kind=(additive|destructive)( adr=ADR-\d{3})?( fk=off)?( profile=(meta|full)(,(meta|full))*)?$/;

const PRAGMA_APPLICATION_ID_READ = 'PRAGMA application_id';
const PRAGMA_JOURNAL_MODE_WAL = 'PRAGMA journal_mode=WAL';
const PRAGMA_FK_OFF = 'PRAGMA foreign_keys=OFF';
const PRAGMA_FK_ON = 'PRAGMA foreign_keys=ON';
const PRAGMA_FK_CHECK = 'PRAGMA foreign_key_check';
const PRAGMA_INTEGRITY_CHECK = 'PRAGMA integrity_check';
const PRAGMA_OPTIMIZE = 'PRAGMA optimize';
const SELECT_HAS_SCHEMA_MIGRATIONS =
  "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'";
const SELECT_APPLIED = 'SELECT module, version, sha256 FROM schema_migrations ORDER BY module, version';
const INSERT_APPLIED =
  'INSERT INTO schema_migrations(module, version, name, sha256, applied_at) VALUES (?, ?, ?, ?, ?)';

function fail(
  reason: MigrateFailure['reason'],
  exitCode: 1 | 78,
  file: string | null,
  detail: string,
): Result<never, MigrateFailure> {
  return err({ reason, exitCode, file, detail });
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseProfiles(raw: string | undefined): readonly ('meta' | 'full')[] | null {
  if (raw === undefined) {
    return null;
  }
  const list = raw.trim().slice('profile='.length).split(',');
  const profiles: ('meta' | 'full')[] = [];
  for (const item of list) {
    if (item === 'meta' || item === 'full') {
      profiles.push(item);
    }
  }
  return profiles;
}

function readOneFile(
  dir: MigrationDir,
  fileName: string,
  fileNumber: number,
  desc: string,
): Result<MigrationFile, MigrateFailure> {
  const fullPath = path.join(dir.dir, fileName);
  let bytes: Buffer;
  try {
    bytes = readFileSync(fullPath);
  } catch (e) {
    return fail('name_invalid', 78, fullPath, `unreadable: ${messageOf(e)}`);
  }
  const text = bytes.toString('utf8');
  const firstLine = (text.split('\n', 1)[0] ?? '').replace(/\r$/, '');
  const m = HEADER_RE.exec(firstLine);
  if (m === null) {
    return fail('header_invalid', 78, fullPath, 'first line is not a valid @fathom header');
  }
  const module = m[1] ?? '';
  const version = Number(m[2]);
  const kind = m[3] === 'destructive' ? 'destructive' : 'additive';
  const adr = m[4] === undefined ? null : m[4].trim().slice('adr='.length);
  if (module !== dir.module) {
    return fail('header_invalid', 78, fullPath, `header module ${module} != directory module ${dir.module}`);
  }
  if (version !== fileNumber) {
    return fail('header_invalid', 78, fullPath, `header version ${version} != file number ${fileNumber}`);
  }
  if (kind === 'destructive' && adr === null) {
    return fail('header_invalid', 78, fullPath, 'destructive migration requires adr=ADR-nnn');
  }
  const violation = findForbiddenToken(text);
  if (violation !== null) {
    return fail('forbidden_token', 78, fullPath, `${violation.token} at line ${violation.line}`);
  }
  return ok({
    module,
    version,
    name: desc,
    file: fullPath,
    sha256: sha256Hex(bytes),
    kind,
    adr,
    fkOff: m[5] !== undefined,
    profiles: parseProfiles(m[6]),
    sql: text,
  });
}

/** 디렉터리마다 `NNNN_<desc>.sql`을 읽고 파일명·번호 연속·헤더·금지 토큰을 검사한다. 배열 순서 = 적용 순서. */
export function readMigrationBundle(dirs: readonly MigrationDir[]): Result<MigrationFile[], MigrateFailure> {
  const bundle: MigrationFile[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir.dir).filter((f) => f.endsWith('.sql'));
    } catch (e) {
      return fail('gap', 78, dir.dir, `migration directory unreadable: ${messageOf(e)}`);
    }
    entries.sort();
    const parsed: { fileName: string; number: number; desc: string }[] = [];
    for (const fileName of entries) {
      const nm = FILE_NAME_RE.exec(fileName);
      if (nm === null) {
        return fail('name_invalid', 78, path.join(dir.dir, fileName), 'file name must match NNNN_<desc>.sql');
      }
      parsed.push({ fileName, number: Number(nm[1]), desc: nm[2] ?? '' });
    }
    for (const [index, entry] of parsed.entries()) {
      if (entry.number !== index + 1) {
        return fail(
          'gap',
          78,
          path.join(dir.dir, entry.fileName),
          `expected version ${index + 1}, found ${entry.number}`,
        );
      }
    }
    for (const entry of parsed) {
      const file = readOneFile(dir, entry.fileName, entry.number, entry.desc);
      if (!file.ok) {
        return file;
      }
      bundle.push(file.value);
    }
  }
  return ok(bundle);
}

type AppliedRow = { module: string; version: number; sha256: string };

function readAppliedRows(db: SqlitePort): AppliedRow[] {
  if (db.prepare(SELECT_HAS_SCHEMA_MIGRATIONS).get() === undefined) {
    return [];
  }
  return db
    .prepare(SELECT_APPLIED)
    .all()
    .map((row) => ({ module: String(row.module), version: Number(row.version), sha256: String(row.sha256) }));
}

function inProfile(file: MigrationFile, profile: 'meta' | 'full'): boolean {
  return file.profiles === null || file.profiles.includes(profile);
}

type Comparison = { readonly pending: MigrationFile[]; readonly appliedRows: AppliedRow[] };

/** 번들(프로파일 필터 적용)과 DB 행을 대조한다: downgrade → sha_mismatch → gap 순서. */
function compare(
  bundle: readonly MigrationFile[],
  rows: readonly AppliedRow[],
  profile: 'meta' | 'full',
): Result<Comparison, MigrateFailure> {
  const filtered = bundle.filter((f) => inProfile(f, profile));
  const byKey = new Map<string, MigrationFile>();
  for (const f of filtered) {
    byKey.set(`${f.module}\u0000${f.version}`, f);
  }
  for (const row of rows) {
    if (!byKey.has(`${row.module}\u0000${row.version}`)) {
      return fail('downgrade', 78, null, `database has ${row.module}@${row.version} unknown to this bundle`);
    }
  }
  for (const row of rows) {
    const f = byKey.get(`${row.module}\u0000${row.version}`);
    if (f !== undefined && f.sha256 !== row.sha256) {
      return fail('sha_mismatch', 78, f.file, `${row.module}@${row.version} bytes differ from the applied file`);
    }
  }
  const appliedKeys = new Set(rows.map((r) => `${r.module}\u0000${r.version}`));
  const modules = [...new Set(filtered.map((f) => f.module))];
  for (const module of modules) {
    const ordered = filtered.filter((f) => f.module === module);
    let seenPending = false;
    for (const f of ordered) {
      const applied = appliedKeys.has(`${f.module}\u0000${f.version}`);
      if (!applied) {
        seenPending = true;
      } else if (seenPending) {
        return fail('gap', 78, f.file, `${module}@${f.version} is applied but an earlier version is missing`);
      }
    }
  }
  return ok({
    pending: filtered.filter((f) => !appliedKeys.has(`${f.module}\u0000${f.version}`)),
    appliedRows: [...rows],
  });
}

function versionsOf(rows: readonly { module: string; version: number }[]): Record<string, number> {
  const versions: Record<string, number> = {};
  for (const row of rows) {
    versions[row.module] = Math.max(versions[row.module] ?? 0, row.version);
  }
  return versions;
}

function applyOne(db: SqlitePort, file: MigrationFile, clock: Clock): Result<true, MigrateFailure> {
  if (file.fkOff) {
    db.exec(PRAGMA_FK_OFF);
  }
  try {
    db.tx(() => {
      // biome-ignore lint/plugin: sql-ok: sha256 검증된 번들 파일(DB-01 §3.7 예외 — 마이그레이션 실행기)
      db.exec(file.sql); // sql-ok: sha256 검증된 번들 파일
      if (file.fkOff) {
        const violations = db.prepare(PRAGMA_FK_CHECK).all();
        if (violations.length > 0) {
          throw new Error(`foreign_key_check reported ${violations.length} violation(s)`);
        }
      }
      db.prepare(INSERT_APPLIED).run(file.module, file.version, file.name, file.sha256, clock.now());
    });
    return ok(true);
  } catch (e) {
    return fail('apply_failed', 1, file.file, messageOf(e));
  } finally {
    if (file.fkOff) {
      db.exec(PRAGMA_FK_ON);
    }
  }
}

/**
 * DB-01 §11.2 실행기. 파일마다 1 tx(`BEGIN IMMEDIATE`)이며 실패 시 앞서 커밋된 파일은 남는다(exitCode 1).
 * `dryRun`은 DB를 바꾸지 않고 `pending`만 돌려준다 — 사본 실행형 dry-run은 서비스 `--mode=migrate --dry-run`이 사본 DB에 `dryRun:false`로 호출한다.
 */
export function migrate(
  db: SqlitePort,
  dirs: readonly MigrationDir[],
  opts: MigrateOptions,
): Result<MigrateReport, MigrateFailure> {
  if (!Number.isSafeInteger(opts.applicationId) || opts.applicationId <= 0 || opts.applicationId > 0x7fffffff) {
    throw new Error('invariant: migrate applicationId must be a positive 31-bit integer');
  }
  const bundle = readMigrationBundle(dirs);
  if (!bundle.ok) {
    return bundle;
  }
  const idRow = db.prepare(PRAGMA_APPLICATION_ID_READ).get();
  const currentId = Number(idRow?.application_id ?? 0);
  if (currentId === 0) {
    if (!opts.dryRun) {
      db.exec(`PRAGMA application_id = ${sqlInt(opts.applicationId)}`);
      db.exec(PRAGMA_JOURNAL_MODE_WAL);
    }
  } else if (currentId === opts.applicationId) {
    if (!opts.dryRun) {
      db.exec(PRAGMA_JOURNAL_MODE_WAL);
    }
  } else {
    return fail(
      'application_id_mismatch',
      78,
      null,
      `application_id ${currentId} != expected ${opts.applicationId} (wrong database file)`,
    );
  }

  const rows = readAppliedRows(db);
  const compared = compare(bundle.value, rows, opts.profile);
  if (!compared.ok) {
    return compared;
  }
  const { pending } = compared.value;
  if (opts.dryRun) {
    return ok({
      dryRun: true,
      applied: [],
      pending: pending.map((f) => ({ module: f.module, version: f.version, name: f.name })),
      schemaVersions: versionsOf(rows),
    });
  }

  const applied: { module: string; version: number; name: string; sha256: string }[] = [];
  for (const file of pending) {
    const result = applyOne(db, file, opts.clock);
    if (!result.ok) {
      return result;
    }
    applied.push({ module: file.module, version: file.version, name: file.name, sha256: file.sha256 });
  }

  const integrity = db.prepare(PRAGMA_INTEGRITY_CHECK).all();
  const [first] = integrity;
  if (integrity.length !== 1 || first === undefined || first.integrity_check !== 'ok') {
    return fail('integrity_failed', 1, null, integrity.map((r) => String(r.integrity_check)).join('; '));
  }
  db.exec(PRAGMA_OPTIMIZE);
  return ok({ dryRun: false, applied, pending: [], schemaVersions: versionsOf(readAppliedRows(db)) });
}

/** DB-01 §11.3 serve 모드 스키마 확인 — 같음 ok · 뒤처짐 `needs_migrate` · 모르는 행 `downgrade` · sha 다름 `sha_mismatch`(전부 exit 78). */
export function verifySchema(
  db: SqlitePort,
  dirs: readonly MigrationDir[],
  opts: { readonly profile: 'meta' | 'full' },
): Result<{ schemaVersions: Readonly<Record<string, number>> }, MigrateFailure> {
  const bundle = readMigrationBundle(dirs);
  if (!bundle.ok) {
    return bundle;
  }
  const rows = readAppliedRows(db);
  const compared = compare(bundle.value, rows, opts.profile);
  if (!compared.ok) {
    return compared;
  }
  const [firstPending] = compared.value.pending;
  if (firstPending !== undefined) {
    return fail(
      'needs_migrate',
      78,
      firstPending.file,
      `${compared.value.pending.length} migration(s) pending, first ${firstPending.module}@${firstPending.version}`,
    );
  }
  return ok({ schemaVersions: versionsOf(rows) });
}
