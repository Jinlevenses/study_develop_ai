import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import type { BundleRecord } from '@fathom/contracts/pack/records';
import type { Outbox } from '@fathom/shared-kernel/eventing/eventing';
import { createOutbox } from '@fathom/shared-kernel/eventing/eventing';
import { infraMigrationsDir } from '@fathom/shared-kernel/service/infra-dir';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { FakeClock } from '@fathom/testkit/clock';
import { createFakeClock } from '@fathom/testkit/clock';
import { createUlidSequence } from '@fathom/testkit/ids';
import { afterAll } from 'vitest';
import type { IngestContext, PackIngestHandler } from '../../../../src/application/catalog/ports.js';
import { CONTENT_DB } from '../../../../src/infra/db/open.js';

// 카탈로그 테스트 공용 도우미 — 마이그레이션 완료된 임시 content.db(파일마다 1회 마이그레이션 후 복사), outbox, 기록용 가짜 핸들러.

export type TestHome = { readonly home: string; readonly dbFile: string; cleanup(): void };

let template: Promise<string> | null = null;
let templateDir: string | null = null;

// 템플릿 DB 임시 폴더는 이 파일을 쓴 테스트 파일이 끝나면 지운다.
afterAll(() => {
  if (templateDir !== null) {
    rmSync(templateDir, { recursive: true, force: true });
    templateDir = null;
    template = null;
  }
});

async function buildTemplate(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'fathom-ct-tpl-'));
  templateDir = dir;
  const file = path.join(dir, 'content.db');
  const rt = await loadSqliteRuntime();
  const db = rt.openDb(file, { synchronous: CONTENT_DB.synchronous, recursiveTriggers: CONTENT_DB.recursiveTriggers });
  try {
    const res = rt.migrate(db, [{ module: '_infra', dir: infraMigrationsDir() }, ...CONTENT_DB.migrations], {
      dryRun: false,
      profile: CONTENT_DB.profile,
      applicationId: CONTENT_DB.applicationId,
      clock: createFakeClock(),
    });
    if (!res.ok) {
      throw new Error(`template migrate failed: ${res.error.reason}`);
    }
  } finally {
    db.close();
  }
  return file;
}

/** 마이그레이션된 content.db가 `<home>/data/content.db`에 있는 새 임시 홈. */
export async function createMigratedHome(): Promise<TestHome> {
  template ??= buildTemplate();
  const tpl = await template;
  const home = mkdtempSync(path.join(tmpdir(), 'fathom-ct-'));
  mkdirSync(path.join(home, 'data'), { recursive: true });
  const dbFile = path.join(home, 'data', 'content.db');
  copyFileSync(tpl, dbFile);
  return {
    home,
    dbFile,
    cleanup(): void {
      if (existsSync(home)) {
        rmSync(home, { recursive: true, force: true });
      }
    },
  };
}

export async function openContentDb(file: string): Promise<SqlitePort> {
  const rt = await loadSqliteRuntime();
  return rt.openDb(file, { synchronous: CONTENT_DB.synchronous, recursiveTriggers: CONTENT_DB.recursiveTriggers });
}

export type Fixture = {
  readonly home: TestHome;
  readonly db: SqlitePort;
  readonly clock: FakeClock;
  readonly outbox: Outbox;
  readonly newId: () => string;
  close(): void;
};

/** 열린 DB + 가짜 시계 + 실제 outbox(검증 레지스트리 = 생성물 EVENT_PAYLOADS). ID는 `fixedUlid(1000 + n)`. */
export async function createFixture(): Promise<Fixture> {
  const home = await createMigratedHome();
  const db = await openContentDb(home.dbFile);
  const clock = createFakeClock();
  const eventIds = createUlidSequence(500_000);
  const outbox = createOutbox({
    db,
    svc: 'content',
    clock,
    payloads: EVENT_PAYLOADS,
    currentTraceparent: () => null,
    onAppended: () => undefined,
    newId: eventIds,
  });
  return {
    home,
    db,
    clock,
    outbox,
    newId: createUlidSequence(1000),
    close(): void {
      db.close();
      home.cleanup();
    },
  };
}

// ───────── 기록용 가짜 핸들러 ─────────
export type RecordingHandler = PackIngestHandler & {
  readonly ingestCalls: { readonly ctx: IngestContext; readonly kinds: string[]; readonly ids: string[] }[];
  readonly purged: string[];
  readonly activations: {
    pack_id: string;
    install_id: string;
    previous_install_id: string | null;
    switched_at: number;
  }[];
  /** activate 훅이 활성화 tx 안에서 불렸는지(중첩 tx가 거부되면 true). */
  readonly activateInTx: boolean[];
  failActivate: boolean;
};

export function recordingHandler(
  kinds: PackIngestHandler['kinds'] = ['item', 'item_model', 'gate_result'],
): RecordingHandler {
  const handler: RecordingHandler = {
    kinds,
    ingestCalls: [],
    purged: [],
    activations: [],
    activateInTx: [],
    failActivate: false,
    ingest(_db, ctx, records: readonly BundleRecord[]): void {
      handler.ingestCalls.push({
        ctx,
        kinds: records.map((r) => r.kind),
        ids: records.map((r) => ('item_id' in r ? r.item_id : r.kind)),
      });
    },
    purge(_db, installId): void {
      handler.purged.push(installId);
    },
    activate(db, ctx): void {
      try {
        db.tx(() => undefined);
        handler.activateInTx.push(false);
      } catch (e) {
        handler.activateInTx.push(e instanceof Error && e.message.includes('nested tx'));
      }
      if (handler.failActivate) {
        throw new Error('handler activate exploded');
      }
      handler.activations.push({ ...ctx });
    },
  };
  return handler;
}

export function rows(
  db: SqlitePort,
  sql: string,
  bind: Record<string, string | number | null> = {},
): Record<string, unknown>[] {
  return Object.keys(bind).length === 0 ? db.prepare(sql).all() : db.prepare(sql).all(bind);
}

export function scalar(db: SqlitePort, sql: string, bind: Record<string, string | number | null> = {}): number {
  const row = Object.keys(bind).length === 0 ? db.prepare(sql).get() : db.prepare(sql).get(bind);
  return Number(Object.values(row ?? { n: 0 })[0]);
}
