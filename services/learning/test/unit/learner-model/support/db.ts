import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { infraMigrationsDir } from '@fathom/shared-kernel/service/infra-dir';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { SqlitePort, Stmt } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { LEARNING_DB } from '../../../../src/infra/db/open.js';
import { REPO_ROOT } from './policy.js';

// 마이그레이션이 끝난 `:memory:` learning.db(원장·투영 DDL 그대로) + 원장 INSERT 보조.

/** DB-01의 `-- <NAME> …` 주석 다음 문장(빈 줄·펜스 전까지). */
const DOC_SQL_CACHE = new Map<string, string>();

export function docSql(name: string): string {
  const cached = DOC_SQL_CACHE.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const text = readDocSql(name);
  DOC_SQL_CACHE.set(name, text);
  return text;
}

function readDocSql(name: string): string {
  const lines = readFileSync(path.join(REPO_ROOT, 'docs/02-design/03-database-design.md'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l === `-- ${name}` || l.startsWith(`-- ${name} `));
  if (at < 0) {
    throw new Error(`doc statement not found: ${name}`);
  }
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line === '' || line.startsWith('```') || line.startsWith('-- ')) {
      break;
    }
    body.push(line);
  }
  return body.join('\n');
}

export async function openMigratedMemoryDb(): Promise<SqlitePort> {
  const rt = await loadSqliteRuntime();
  const db = rt.openDb(':memory:', {
    synchronous: LEARNING_DB.synchronous,
    recursiveTriggers: LEARNING_DB.recursiveTriggers,
  });
  const res = rt.migrate(db, [{ module: '_infra', dir: infraMigrationsDir() }, ...LEARNING_DB.migrations], {
    dryRun: false,
    profile: LEARNING_DB.profile,
    applicationId: LEARNING_DB.applicationId,
    clock: createFakeClock(),
  });
  if (!res.ok) {
    throw new Error(`migrate failed: ${res.error.reason}: ${res.error.detail}`);
  }
  return db;
}

/** 이벤트 1건을 원장(lr_event)에 넣는다(가짜 해시 — 해시 체인 검증은 이 Task 밖). 반환 = 삽입 여부. */
const INSERT_STMTS = new WeakMap<SqlitePort, Stmt>();

export function insertEvent(db: SqlitePort, e: LedgerEventEnvelope): boolean {
  let stmt = INSERT_STMTS.get(db);
  if (stmt === undefined) {
    stmt = db.prepare(docSql('LEDGER_INSERT'));
    INSERT_STMTS.set(db, stmt);
  }
  const res = stmt.run({
    event_id: e.event_id,
    device_id: e.device_id,
    device_seq: e.device_seq,
    client_ts: e.client_ts,
    type: e.type,
    schema_version: e.schema_version,
    idempotency_key: e.idempotency_key,
    payload: JSON.stringify(e.payload),
    prev_hash: e.prev_hash,
    hash: e.hash,
    experiment_arm: e.experiment_arm,
    recorded_at: e.recorded_at,
    ext: '{}',
    ext_v: 1,
  });
  return res.changes === 1;
}
