// ported-from: spikes/sp4-node-sqlite/src/writer.mjs, spikes/sp4-node-sqlite/src/reader.mjs (audit-fixed: timeout 5000·option whitelist·no deferred BEGIN·no empty catch·517=defect·bind guard·VACUUM INTO backup)
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { Counter, Histogram, MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import { ident, placeholders, sqlInt } from './fragments.js';
import type { MigrateFailure, MigrateOptions, MigrateReport, MigrationDir, MigrationFile } from './migrate.js';
import { migrate, readMigrationBundle, verifySchema } from './migrate.js';

// DB-01 §3.1 · §3.7 — `node:sqlite` 접근 계층. 서비스·job은 `openDb()`의 `SqlitePort`만 쓴다(STD-SQL-01).
// STD-SQL-04: PRAGMA 실행은 shared-kernel 안 `openDb`(연결 프로파일)·`migrate`(application_id·WAL·integrity)·`vacuumInto`(사본 검사)뿐이다.

export type BindValue = number | string | bigint | Uint8Array | null;
export type BindArgs = readonly BindValue[] | readonly [Readonly<Record<string, BindValue>>];
export interface Stmt {
  run(...args: BindArgs): { changes: number; lastInsertRowid: number | bigint };
  get(...args: BindArgs): Record<string, unknown> | undefined;
  all(...args: BindArgs): Record<string, unknown>[];
  iterate(...args: BindArgs): IterableIterator<Record<string, unknown>>;
}
export interface SqlitePort {
  readonly path: string;
  readonly readOnly: boolean;
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  tx<T>(fn: () => T): T;
  fn(name: string, impl: (...args: BindValue[]) => BindValue, opts?: { deterministic?: boolean }): void;
  close(): void;
}
export type OpenDbOptions = {
  readonly readOnly?: boolean;
  readonly synchronous: 'NORMAL' | 'FULL';
  readonly recursiveTriggers?: boolean;
  /** [Brief 결정] ARC 시그니처에 가산한 선택 키. */
  readonly metrics?: MetricsRegistry;
};

const OPEN_OPTION_KEYS: ReadonlySet<string> = new Set(['readOnly', 'synchronous', 'recursiveTriggers', 'metrics']);
const BUSY_TIMEOUT_MS = 5000;
const TX_BUCKETS_MS: readonly number[] = [1, 5, 10, 25, 50, 100, 250, 1000];

const PRAGMA_SYNC_NORMAL = 'PRAGMA synchronous=NORMAL';
const PRAGMA_SYNC_FULL = 'PRAGMA synchronous=FULL';
const PRAGMA_RECURSIVE_TRIGGERS_ON = 'PRAGMA recursive_triggers=ON';
const PRAGMA_JOURNAL_SIZE_LIMIT = 'PRAGMA journal_size_limit=67108864';
const PRAGMA_INTEGRITY_CHECK = 'PRAGMA integrity_check';

// ───────── 오류 분류 ─────────

export type SqliteErrorKind = 'busy' | 'locked' | 'constraint' | 'readonly' | 'busy_snapshot' | 'other';

/** DB-01 §3.7: `errcode === 517`(BUSY_SNAPSHOT)을 먼저, 그다음 `errcode & 0xff`. `errcode`가 없으면 `other`. */
export function classifySqliteError(e: unknown): { kind: SqliteErrorKind; errcode: number | null } {
  if (typeof e !== 'object' || e === null || !('errcode' in e)) {
    return { kind: 'other', errcode: null };
  }
  const errcode: unknown = e.errcode;
  if (typeof errcode !== 'number' || !Number.isInteger(errcode)) {
    return { kind: 'other', errcode: null };
  }
  if (errcode === 517) {
    return { kind: 'busy_snapshot', errcode };
  }
  switch (errcode & 0xff) {
    case 5:
      return { kind: 'busy', errcode };
    case 6:
      return { kind: 'locked', errcode };
    case 19:
      return { kind: 'constraint', errcode };
    case 8:
      return { kind: 'readonly', errcode };
    default:
      return { kind: 'other', errcode };
  }
}

// ───────── 바인딩 가드 ─────────

function describeBadType(v: unknown): string {
  if (v === undefined) {
    return 'undefined';
  }
  if (v instanceof Date) {
    return 'Date';
  }
  if (Array.isArray(v)) {
    return 'array';
  }
  return typeof v;
}

function isBindValue(v: unknown): v is BindValue {
  return (
    v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint' || v instanceof Uint8Array
  );
}

type BoundArgs =
  | { readonly named: Readonly<Record<string, BindValue>>; readonly positional: null }
  | { readonly named: null; readonly positional: readonly BindValue[] };

function isNamedArgs(args: BindArgs): args is readonly [Readonly<Record<string, BindValue>>] {
  const first: unknown = args[0];
  return (
    args.length === 1 &&
    typeof first === 'object' &&
    first !== null &&
    !(first instanceof Uint8Array) &&
    !(first instanceof Date) &&
    !Array.isArray(first) &&
    Object.keys(first).length > 0 // 빈 객체 `{}`는 명명 바인딩이 아니라 잘못된 위치 값으로 본다
  );
}

/** NFR-DATA-006: `Date`는 조용히 NULL로 묶이고 boolean·undefined는 모호하게 실패한다 — 실행 전에 결함으로 던진다. */
function guardArgs(args: BindArgs): BoundArgs {
  if (isNamedArgs(args)) {
    const record = args[0];
    for (const name of Object.keys(record)) {
      const value: unknown = record[name];
      if (!isBindValue(value)) {
        throw new Error(`invariant: sqlite bind ${describeBadType(value)} at ${name}`);
      }
    }
    return { named: record, positional: null };
  }
  const positional: BindValue[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const value: unknown = args[i];
    if (!isBindValue(value)) {
      throw new Error(`invariant: sqlite bind ${describeBadType(value)} at ${i}`);
    }
    positional.push(value);
  }
  return { named: null, positional };
}

type RawStatement = ReturnType<DatabaseSync['prepare']>;

function wrapStatement(stmt: RawStatement): Stmt {
  return {
    run(...args: BindArgs): { changes: number; lastInsertRowid: number | bigint } {
      const bound = guardArgs(args);
      const result = bound.named === null ? stmt.run(...bound.positional) : stmt.run(bound.named);
      return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
    },
    get(...args: BindArgs): Record<string, unknown> | undefined {
      const bound = guardArgs(args);
      return bound.named === null ? stmt.get(...bound.positional) : stmt.get(bound.named);
    },
    all(...args: BindArgs): Record<string, unknown>[] {
      const bound = guardArgs(args);
      return bound.named === null ? stmt.all(...bound.positional) : stmt.all(bound.named);
    },
    iterate(...args: BindArgs): IterableIterator<Record<string, unknown>> {
      const bound = guardArgs(args);
      return bound.named === null ? stmt.iterate(...bound.positional) : stmt.iterate(bound.named);
    },
  };
}

// ───────── openDb ─────────

function metricLabel(dbPath: string): string {
  if (dbPath === ':memory:' || dbPath === '') {
    return 'memory';
  }
  return path.basename(dbPath);
}

function isThenable(v: unknown): boolean {
  return (
    (typeof v === 'object' || typeof v === 'function') && v !== null && 'then' in v && typeof v.then === 'function'
  );
}

type TxMetrics = {
  readonly busy: Counter;
  readonly snapshot: Counter;
  readonly duration: Histogram;
  readonly db: string;
};

function createTxMetrics(registry: MetricsRegistry, dbPath: string): TxMetrics {
  return {
    busy: registry.counter('sqlite_busy_total', 'SQLITE_BUSY errors surfaced by SqlitePort', ['db']),
    snapshot: registry.counter('sqlite_busy_snapshot_total', 'SQLITE_BUSY_SNAPSHOT (517) defects', ['db']),
    duration: registry.histogram('sqlite_tx_duration_ms', 'BEGIN IMMEDIATE transaction duration', TX_BUCKETS_MS, [
      'db',
    ]),
    db: metricLabel(dbPath),
  };
}

/**
 * DB-01 §3.1 연결 프로파일. 생성자 옵션 고정, `timeout: 5000` 항상, 알 수 없는 옵션 키는 던진다(SP-4 감사: 모르는 키는 조용히 무시되므로).
 * WAL·`application_id`는 여기서 설정하지 않는다(migrate 몫).
 */
export function openDb(dbPath: string, opts: OpenDbOptions): SqlitePort {
  const rawOpts: Readonly<Record<string, unknown>> = opts;
  for (const key of Object.keys(rawOpts)) {
    if (!OPEN_OPTION_KEYS.has(key)) {
      throw new Error(`invariant: openDb unknown option ${key}`);
    }
  }
  if (opts.synchronous !== 'NORMAL' && opts.synchronous !== 'FULL') {
    throw new Error('invariant: openDb synchronous must be NORMAL or FULL');
  }
  const readOnly = opts.readOnly === true;
  const raw = new DatabaseSync(dbPath, {
    readOnly,
    timeout: BUSY_TIMEOUT_MS,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  if (opts.synchronous === 'FULL') {
    raw.exec(PRAGMA_SYNC_FULL);
  } else {
    raw.exec(PRAGMA_SYNC_NORMAL);
  }
  if (opts.recursiveTriggers === true) {
    raw.exec(PRAGMA_RECURSIVE_TRIGGERS_ON);
  }
  if (!readOnly) {
    raw.exec(PRAGMA_JOURNAL_SIZE_LIMIT);
  }
  const txMetrics = opts.metrics === undefined ? null : createTxMetrics(opts.metrics, dbPath);

  function recordError(e: unknown): void {
    if (txMetrics === null) {
      return;
    }
    const { kind } = classifySqliteError(e);
    if (kind === 'busy') {
      txMetrics.busy.inc({ db: txMetrics.db });
    } else if (kind === 'busy_snapshot') {
      txMetrics.snapshot.inc({ db: txMetrics.db });
    }
  }

  function tx<T>(fn: () => T): T {
    if (raw.isTransaction) {
      throw new Error('invariant: nested tx');
    }
    const started = performance.now();
    try {
      raw.exec('BEGIN IMMEDIATE');
      const result = fn();
      if (isThenable(result)) {
        throw new Error('invariant: tx fn returned a Promise');
      }
      raw.exec('COMMIT');
      return result;
    } catch (original) {
      recordError(original);
      if (raw.isTransaction) {
        try {
          raw.exec('ROLLBACK');
        } catch (rollbackError) {
          throw new Error('invariant: rollback failed', {
            cause: new AggregateError([original, rollbackError]),
          });
        }
      }
      throw original;
    } finally {
      txMetrics?.duration.observe(performance.now() - started, { db: txMetrics.db });
    }
  }

  return {
    path: dbPath,
    readOnly,
    prepare(sql: string): Stmt {
      // biome-ignore lint/plugin: sql-ok: SqlitePort 구현체의 통과 호출 — 정적 SQL 검사는 이 포트의 호출부에서 한다
      return wrapStatement(raw.prepare(sql)); // sql-ok: port pass-through
    },
    exec(sql: string): void {
      // biome-ignore lint/plugin: sql-ok: SqlitePort 구현체의 통과 호출 — 정적 SQL 검사는 이 포트의 호출부에서 한다
      raw.exec(sql); // sql-ok: port pass-through
    },
    tx,
    fn(name: string, impl: (...args: BindValue[]) => BindValue, fnOpts?: { deterministic?: boolean }): void {
      raw.function(name, { deterministic: fnOpts?.deterministic === true }, impl);
    },
    close(): void {
      if (!raw.isOpen) {
        return;
      }
      raw.close();
    },
  };
}

// ───────── vacuumInto (job 전용) ─────────

export type VacuumFailure = { reason: 'exists' | 'integrity_failed' | 'io'; detail: string };

function errnoCode(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') {
    return e.code;
  }
  return null;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), async (source: AsyncIterable<Buffer>): Promise<void> => {
    for await (const chunk of source) {
      hash.update(chunk);
    }
  });
  return hash.digest('hex');
}

async function removeQuietly(file: string): Promise<void> {
  // 정리용 삭제 — 실패해도 호출자가 이미 반환할 오류가 있다(임시 파일은 다음 정리 주기에 회수).
  await rm(file, { force: true }).catch(() => undefined);
}

/**
 * 백업 = `VACUUM INTO` tmp → `integrity_check` → rename(DB-01 §12.1, SP-4 감사). `DatabaseSync.backup()`은 쓰지 않는다.
 * 읽기 전용 연결에서도 동작한다.
 */
export async function vacuumInto(
  db: SqlitePort,
  destPath: string,
): Promise<Result<{ path: string; bytes: number; sha256: string }, VacuumFailure>> {
  try {
    await stat(destPath);
    return err({ reason: 'exists', detail: destPath });
  } catch (e) {
    if (errnoCode(e) !== 'ENOENT') {
      return err({ reason: 'io', detail: messageOf(e) });
    }
  }
  const tmp = `${destPath}.${ulid()}.tmp`;
  try {
    db.prepare('VACUUM INTO ?').run(tmp);
  } catch (e) {
    await removeQuietly(tmp);
    return err({ reason: 'io', detail: messageOf(e) });
  }
  try {
    const copy = openDb(tmp, { readOnly: true, synchronous: 'NORMAL' });
    let rows: Record<string, unknown>[];
    try {
      rows = copy.prepare(PRAGMA_INTEGRITY_CHECK).all();
    } finally {
      copy.close();
    }
    const [first] = rows;
    if (rows.length !== 1 || first === undefined || first.integrity_check !== 'ok') {
      await removeQuietly(tmp);
      return err({ reason: 'integrity_failed', detail: rows.map((r) => String(r.integrity_check)).join('; ') });
    }
    await rename(tmp, destPath);
    const info = await stat(destPath);
    const sha256 = await sha256OfFile(destPath);
    return ok({ path: destPath, bytes: info.size, sha256 });
  } catch (e) {
    await removeQuietly(tmp);
    return err({ reason: 'io', detail: messageOf(e) });
  }
}

export type { MigrateFailure, MigrateOptions, MigrateReport, MigrationDir, MigrationFile };
export { ident, migrate, placeholders, readMigrationBundle, sqlInt, verifySchema };
