import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { JobDefinition } from '@fathom/shared-kernel/jobs/jobs';
import { defineJob } from '@fathom/shared-kernel/jobs/jobs';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { systemClock } from '@fathom/shared-kernel/time/time';
import { type AffectedKeys, affectedKeys, rederiveKeys } from '../application/learner-model/incremental.js';
import type {
  LedgerReplaySource,
  ProjectionStore,
  ProjectorParamsResolver,
} from '../application/learner-model/ports.js';
import { registerPolicySwitch, replayFold } from '../application/learner-model/replay.js';
import type { ProjectionSlice } from '../domain/learner-model/projector/types.js';
import {
  CARD_COUNT_LIVE,
  CONCEPT_COUNT_LIVE,
  LIVE_TABLES,
  SCHEMA_INDEX_DDLS,
  SCHEMA_TABLE_DDL,
  SHADOW_DROP_CARD,
  SHADOW_DROP_CONCEPT,
  SHADOW_TABLES,
  SWAP_DROP_CARD,
  SWAP_DROP_CONCEPT,
  SWAP_RENAME_CARD,
  SWAP_RENAME_CONCEPT,
} from '../infra/db/learner-model-projection.sql.js';
import { createProjectionStore } from '../infra/db/learner-model-store.js';
import { createEventTargetLookup } from '../infra/db/learner-model-targets.js';
import { learningDbOptions } from '../infra/db/open.js';
import { recomputeProjectionMeta } from '../infra/projection/meta.js';
import { createProjectorParamsResolver } from '../infra/projection/params-resolver.js';
import { ProjectionJobArgs, type ProjectionJobDeps } from './replay-verify.js';

// PGM-LR-094 · DB-01 §6.4 shadow 교체 1~4 — 원장만으로 투영을 재구성한다. 대상 표 = lr_card_state·lr_concept_state(나머지 4표 불변, IT-01).
// ① start = maxRowid ② 2-패스 fold(메모리) ③ shadow 표 생성(DDL = sqlite_schema 원문 이름 치환, 인덱스는 보관만) ④ shadow에 tx당 5,000행
// ⑤ beforeSwap 훅(테스트 전용) ⑥ 최종 1 tx: 캐치업 → DROP + RENAME → 보관 인덱스 재생성 → 메타 갱신.

export const REBUILD_BATCH_ROWS = 5000;

export type RebuildResult = {
  readonly projection_hash: string;
  readonly event_count: number;
  readonly catch_up_events: number;
  readonly rows: { readonly cards: number; readonly concepts: number };
  readonly duration_ms: number;
};
export type RebuildDeps = {
  readonly source: LedgerReplaySource;
  readonly params: ProjectorParamsResolver;
  readonly clock: Clock;
  /** 취소 신호 — 다음 배치(·최종 tx) 전에 확인한다. */
  readonly signal?: AbortSignal;
};
export type RebuildHooks = { readonly beforeSwap?: (db: SqlitePort) => void };

type Target = 'card' | 'concept';

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error('cancelled');
  }
}

/** `CREATE TABLE [\"]lr_x[\"](` → `CREATE TABLE \"lr_x__shadow\"(` 1회 치환. 형태가 다르면 결함(DDL 원문을 모르는 채로 실행하지 않는다). */
export function shadowDdl(sql: string, table: string): string {
  const re = new RegExp(`^CREATE TABLE\\s+"?${table}"?\\s*\\(`);
  if (!re.test(sql)) {
    throw new Error(`invariant: unexpected schema DDL head for ${table}`);
  }
  return sql.replace(re, `CREATE TABLE "${table}__shadow"(`);
}

function sqlOf(rows: readonly Record<string, unknown>[], table: string): string[] {
  return rows.map((row) => {
    if (typeof row.sql !== 'string') {
      throw new Error(`invariant: sqlite_schema sql missing for ${table}`);
    }
    return row.sql;
  });
}

type ShadowSource = { readonly tableSql: string; readonly indexDdls: string[] };

function readSchema(db: SqlitePort, table: string): ShadowSource {
  const [tableSql] = sqlOf(db.prepare(SCHEMA_TABLE_DDL).all({ name: table }), table);
  if (tableSql === undefined) {
    throw new Error(`invariant: ${table} does not exist`);
  }
  return { tableSql, indexDdls: sqlOf(db.prepare(SCHEMA_INDEX_DDLS).all({ name: table }), table) };
}

/** 표마다 shadow를 DROP IF EXISTS 후 sqlite_schema DDL 치환으로 만들고, 인덱스 DDL(라이브 표 기준)은 보관만 한다. */
function createShadows(db: SqlitePort): Record<Target, string[]> {
  const card = readSchema(db, LIVE_TABLES.card);
  const concept = readSchema(db, LIVE_TABLES.concept);
  db.exec(SHADOW_DROP_CARD);
  // biome-ignore lint/plugin: sql-ok: shadow DDL = sqlite_schema 원문 이름 치환, DB-01 §6.4
  db.exec(shadowDdl(card.tableSql, LIVE_TABLES.card)); // sql-ok: shadow DDL = sqlite_schema 원문 이름 치환, DB-01 §6.4
  db.exec(SHADOW_DROP_CONCEPT);
  // biome-ignore lint/plugin: sql-ok: shadow DDL = sqlite_schema 원문 이름 치환, DB-01 §6.4
  db.exec(shadowDdl(concept.tableSql, LIVE_TABLES.concept)); // sql-ok: shadow DDL = sqlite_schema 원문 이름 치환, DB-01 §6.4
  return { card: card.indexDdls, concept: concept.indexDdls };
}

function writeSlice(
  db: SqlitePort,
  store: ProjectionStore,
  slice: ProjectionSlice,
  signal: AbortSignal | undefined,
): void {
  const byKey = (x: [string, unknown], y: [string, unknown]): number => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);
  const puts: (() => void)[] = [
    ...Object.entries(slice.cards)
      .sort(byKey)
      .map(
        ([, row]) =>
          () =>
            store.putCard(row),
      ),
    ...Object.entries(slice.concepts)
      .sort(byKey)
      .map(
        ([, row]) =>
          () =>
            store.putConcept(row),
      ),
  ];
  for (let from = 0; from < puts.length; from += REBUILD_BATCH_ROWS) {
    throwIfCancelled(signal);
    const batch = puts.slice(from, from + REBUILD_BATCH_ROWS);
    db.tx(() => {
      for (const put of batch) {
        put();
      }
    });
  }
}

function mergeKeys(into: { cards: Set<string>; concepts: Set<string> }, keys: AffectedKeys): void {
  for (const id of keys.card_ids) {
    into.cards.add(id);
  }
  for (const id of keys.concept_ids) {
    into.concepts.add(id);
  }
}

export function runRebuild(db: SqlitePort, deps: RebuildDeps, hooks?: RebuildHooks): RebuildResult {
  const { source, params, clock, signal } = deps;
  const started = clock.now();
  const startRowid = source.maxRowid(db);
  const { slice } = replayFold(db, source, params);
  throwIfCancelled(signal);

  const indexDdls = createShadows(db);
  const shadow = createProjectionStore(db, SHADOW_TABLES);
  writeSlice(db, shadow, slice, signal);
  hooks?.beforeSwap?.(db);
  throwIfCancelled(signal);

  const targets = createEventTargetLookup();
  let catchUp = 0;
  const result = db.tx(() => {
    if (source.maxRowid(db) > startRowid) {
      const arrived: LedgerEventEnvelope[] = [...source.sinceRowid(db, startRowid)];
      catchUp = arrived.length;
      const cards = new Set<string>();
      const concepts = new Set<string>();
      for (const event of arrived) {
        registerPolicySwitch(params, event);
        const keys = affectedKeys({ db, targets }, event);
        if (keys !== null) {
          mergeKeys({ cards, concepts }, keys);
        }
      }
      rederiveKeys(
        { db, source, targets, store: shadow, params },
        { card_ids: [...cards].sort(), concept_ids: [...concepts].sort() },
      );
    }
    db.exec(SWAP_DROP_CARD);
    db.exec(SWAP_RENAME_CARD);
    db.exec(SWAP_DROP_CONCEPT);
    db.exec(SWAP_RENAME_CONCEPT);
    for (const ddl of [...indexDdls.card, ...indexDdls.concept]) {
      // biome-ignore lint/plugin: sql-ok: 보관한 인덱스 DDL(sqlite_schema 원문) 재실행, DB-01 §6.4
      db.exec(ddl); // sql-ok: 보관한 인덱스 DDL(sqlite_schema 원문) 재실행, DB-01 §6.4
    }
    const meta = recomputeProjectionMeta(db, clock);
    return {
      projection_hash: meta.projection_hash,
      event_count: meta.event_count,
      rows: {
        cards: Number(db.prepare(CARD_COUNT_LIVE).get()?.n),
        concepts: Number(db.prepare(CONCEPT_COUNT_LIVE).get()?.n),
      },
    };
  });
  return { ...result, catch_up_events: catchUp, duration_ms: Math.max(0, clock.now() - started) };
}

/** job `rebuild`(PGM-LR-094): args 파싱 → 쓰기 연결 → runRebuild → close. 취소되면 shadow만 남고 라이브는 불변(다음 실행이 DROP IF EXISTS). */
export function makeRebuildJob(deps: ProjectionJobDeps): JobDefinition {
  return defineJob('rebuild', async (rawArgs, ctx) => {
    const args = ProjectionJobArgs.parse(rawArgs);
    const runtime = await (deps.runtime ?? loadSqliteRuntime)();
    ctx.progress(null, 'open');
    const db = runtime.openDb(homePath(args.home, 'data', 'learning.db'), learningDbOptions(false));
    try {
      const params = createProjectorParamsResolver({
        policyDir: args.policy_dir,
        setsDir: homePath(args.home, 'policy', 'sets'),
      });
      ctx.progress(null, 'rebuild');
      return { ...runRebuild(db, { source: deps.source, params, clock: systemClock, signal: ctx.signal }) };
    } finally {
      db.close();
    }
  });
}
