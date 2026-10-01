import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Ulid } from '@fathom/contracts/common/ids';
import { S } from '@fathom/contracts/common/schema';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { JobDefinition } from '@fathom/shared-kernel/jobs/jobs';
import { defineJob } from '@fathom/shared-kernel/jobs/jobs';
import { systemClock } from '@fathom/shared-kernel/time/time';
import { z } from 'zod';
import type { EventingSnapshot } from '../eventing/snapshot-read.js';
import { readEventingSnapshot } from '../eventing/snapshot-read.js';
import { FK_CHECK, INTEGRITY_CHECK, QUICK_CHECK, SCHEMA_VERSIONS_GET } from './maintenance.sql.js';
import type { SqliteRuntime } from './sqlite-loader.js';
import type { ServiceDatabase, ServiceDefinitionBase } from './types.js';

// §4.3.5 · ARC-01 §5.4 · ADR-013 §1-4 — 기본 job `snapshot`·`integrity`. 단명 자식 프로세스에서 돈다(jobs 모듈이 fork).

const SnapshotArgs = S({ epoch_id: Ulid, dir: z.string(), home: z.string() });
const IntegrityArgs = S({ level: z.enum(['quick', 'full']), home: z.string() });
const MAX_CHECK_LINES = 100;
const MAX_CHECK_LINE_CHARS = 300;

function fullDatabases(def: ServiceDefinitionBase): readonly ServiceDatabase[] {
  return def.databases.filter((d) => d.profile === 'full');
}

/** snapshot: 라이브 DB(readOnly)에서 `VACUUM INTO` 사본을 만들고, seq·커서·워터마크는 **사본**에서 읽는다(ADR-013 §1-4). */
export function makeSnapshotJob(def: ServiceDefinitionBase, rt: () => Promise<SqliteRuntime>): JobDefinition {
  return defineJob('snapshot', async (rawArgs) => {
    const args = SnapshotArgs.parse(rawArgs);
    const runtime = await rt();
    const started = systemClock.now();
    await mkdir(args.dir, { recursive: true });
    const files: { file: string; sha256: string; bytes: number }[] = [];
    let eventing: EventingSnapshot | null = null;
    let schema: Record<string, number> = {};
    let extras: Readonly<Record<string, unknown>> = {};
    for (const database of fullDatabases(def)) {
      const live = runtime.openDb(homePath(args.home, 'data', database.file), {
        readOnly: true,
        synchronous: database.synchronous,
        recursiveTriggers: database.recursiveTriggers,
      });
      const dest = path.join(args.dir, database.file);
      try {
        const copied = await runtime.vacuumInto(live, dest);
        if (!copied.ok) {
          throw new Error(`snapshot of ${database.file} failed: ${copied.error.reason}`);
        }
        files.push({ file: database.file, sha256: copied.value.sha256, bytes: copied.value.bytes });
      } finally {
        live.close();
      }
      const copy = runtime.openDb(dest, { readOnly: true, synchronous: 'NORMAL' });
      try {
        eventing = readEventingSnapshot(copy);
        schema = Object.fromEntries(
          copy
            .prepare(SCHEMA_VERSIONS_GET)
            .all()
            .map((row): [string, number] => [String(row.module), Number(row.v)]),
        );
        extras = def.snapshotExtras?.(copy) ?? {};
      } finally {
        copy.close();
      }
    }
    if (eventing === null) {
      throw new Error('invariant: snapshot job requires a full database');
    }
    return {
      epoch_id: args.epoch_id,
      svc: def.svc,
      files,
      schema,
      outbox_head_seq: eventing.outbox_head_seq,
      delivery: eventing.delivery,
      inbox_watermark: eventing.inbox_watermark,
      ...extras,
      duration_ms: Math.max(0, systemClock.now() - started),
    };
  });
}

function trimLines(rows: readonly Record<string, unknown>[], key: string): string[] {
  return rows.slice(0, MAX_CHECK_LINES).map((r) => String(r[key]).slice(0, MAX_CHECK_LINE_CHARS));
}

/** integrity: `full` DB마다 quick_check / integrity_check + foreign_key_check 행 수. */
export function makeIntegrityJob(def: ServiceDefinitionBase, rt: () => Promise<SqliteRuntime>): JobDefinition {
  return defineJob('integrity', async (rawArgs) => {
    const args = IntegrityArgs.parse(rawArgs);
    const runtime = await rt();
    const started = systemClock.now();
    const files: { file: string; check: 'ok' | string[]; foreign_key_violations: number }[] = [];
    for (const database of fullDatabases(def)) {
      const db = runtime.openDb(homePath(args.home, 'data', database.file), {
        readOnly: true,
        synchronous: database.synchronous,
        recursiveTriggers: database.recursiveTriggers,
      });
      try {
        const rows = args.level === 'quick' ? db.prepare(QUICK_CHECK).all() : db.prepare(INTEGRITY_CHECK).all();
        const key = args.level === 'quick' ? 'quick_check' : 'integrity_check';
        const only = rows[0];
        const healthy = rows.length === 1 && only !== undefined && only[key] === 'ok';
        files.push({
          file: database.file,
          check: healthy ? 'ok' : trimLines(rows, key),
          foreign_key_violations: db.prepare(FK_CHECK).all().length,
        });
      } finally {
        db.close();
      }
    }
    return {
      svc: def.svc,
      level: args.level,
      ok: files.every((f) => f.check === 'ok' && f.foreign_key_violations === 0),
      files,
      checked_at: systemClock.now(),
      duration_ms: Math.max(0, systemClock.now() - started),
    };
  });
}
