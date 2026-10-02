import { S } from '@fathom/contracts/common/schema';
import { canonicalJson, parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { JobDefinition } from '@fathom/shared-kernel/jobs/jobs';
import { defineJob } from '@fathom/shared-kernel/jobs/jobs';
import type { SqliteRuntime } from '@fathom/shared-kernel/service/service';
import { loadSqliteRuntime } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { systemClock } from '@fathom/shared-kernel/time/time';
import { z } from 'zod';
import type { LedgerReplaySource, ProjectorParamsResolver } from '../application/learner-model/ports.js';
import { replayFold } from '../application/learner-model/replay.js';
import type { ProjectionSlice } from '../domain/learner-model/projector/types.js';
import { CARD_ALL_LIVE, CONCEPT_ALL_LIVE } from '../infra/db/learner-model-projection.sql.js';
import { learningDbOptions } from '../infra/db/open.js';
import { FSRS_IMPL } from '../infra/projection/meta.js';
import { createProjectorParamsResolver } from '../infra/projection/params-resolver.js';
import { projectionHashFromDb, projectionHashFromSlice } from '../infra/projection/projection-hash.js';

// PGM-LR-093 · IF-IPC-018~021(job) — 라이브 투영 vs 원장만 리플레이한 투영(읽기 전용). 불일치여도 자동 수정 금지(배너·doctor = IT-03).

export const ProjectionJobArgs = S({ home: z.string().min(1), policy_dir: z.string().min(1) });
export type ProjectionJobArgs = z.infer<typeof ProjectionJobArgs>;

export type ProjectionJobDeps = {
  readonly source: LedgerReplaySource;
  readonly runtime?: () => Promise<Pick<SqliteRuntime, 'openDb'>>;
};

export const REPLAY_VERIFY_MAX_ATTEMPTS = 3;
export const MISMATCH_SAMPLE_MAX = 20;

export type ReplayVerifyResult = {
  /** true/false = 해시 비교 결과, null = 3회 모두 리플레이 중 원장이 바뀌어 판정 불가. */
  readonly match: boolean | null;
  readonly reason: 'ledger_busy' | null;
  readonly projection_hash_live: string | null;
  readonly projection_hash_replay: string | null;
  readonly event_count: number;
  readonly max_rowid: number;
  readonly fsrs_impl: string;
  readonly mismatched: {
    readonly cards: number;
    readonly concepts: number;
    readonly sample: readonly string[];
  };
  readonly attempts: number;
  readonly duration_ms: number;
};

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error('cancelled');
  }
}

function liveCanon(rows: Iterable<Record<string, unknown>>, idColumn: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const { state_json: stateJson, ...rest } = row;
    if (typeof stateJson !== 'string') {
      throw new Error('invariant: projection state_json is not text');
    }
    out.set(String(row[idColumn]), canonicalJson({ ...rest, state: parseJsonStrict(stateJson) }));
  }
  return out;
}

function replayCanon<T extends { state: unknown }>(rows: Readonly<Record<string, T>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, row] of Object.entries(rows)) {
    out.set(id, canonicalJson(row));
  }
  return out;
}

function differing(live: Map<string, string>, replay: Map<string, string>): string[] {
  const keys = new Set<string>([...live.keys(), ...replay.keys()]);
  return [...keys].filter((k) => live.get(k) !== replay.get(k)).sort();
}

function mismatchOf(db: SqlitePort, slice: ProjectionSlice): ReplayVerifyResult['mismatched'] {
  const cards = differing(liveCanon(db.prepare(CARD_ALL_LIVE).iterate(), 'card_id'), replayCanon(slice.cards));
  const concepts = differing(
    liveCanon(db.prepare(CONCEPT_ALL_LIVE).iterate(), 'concept_id'),
    replayCanon(slice.concepts),
  );
  const sample = [...cards.map((k) => `card:${k}`), ...concepts.map((k) => `concept:${k}`)].slice(
    0,
    MISMATCH_SAMPLE_MAX,
  );
  return { cards: cards.length, concepts: concepts.length, sample };
}

/** 읽기 전용(쓰기 0). 리플레이 도중 원장이 자라면(maxRowid 변경) 최대 3회 재시도, 그래도 바뀌면 match = null. */
export function runReplayVerify(
  db: SqlitePort,
  deps: {
    readonly source: LedgerReplaySource;
    readonly params: ProjectorParamsResolver;
    readonly clock?: Clock;
    /** 취소 신호 — 시도 사이·해시·불일치 단계 전에 확인한다(Brief §4.7). */
    readonly signal?: AbortSignal;
  },
): ReplayVerifyResult {
  const clock = deps.clock ?? systemClock;
  const started = clock.now();
  let lastRowid = 0;
  for (let attempt = 1; attempt <= REPLAY_VERIFY_MAX_ATTEMPTS; attempt += 1) {
    throwIfCancelled(deps.signal);
    const before = deps.source.maxRowid(db);
    const { slice, event_count: eventCount } = replayFold(db, deps.source, deps.params);
    throwIfCancelled(deps.signal);
    const live = projectionHashFromDb(db);
    const replay = projectionHashFromSlice(slice, db);
    throwIfCancelled(deps.signal);
    const mismatched = live === replay ? { cards: 0, concepts: 0, sample: [] } : mismatchOf(db, slice);
    const after = deps.source.maxRowid(db);
    lastRowid = after;
    if (before === after) {
      return {
        match: live === replay,
        reason: null,
        projection_hash_live: live,
        projection_hash_replay: replay,
        event_count: eventCount,
        max_rowid: after,
        fsrs_impl: FSRS_IMPL,
        mismatched,
        attempts: attempt,
        duration_ms: Math.max(0, clock.now() - started),
      };
    }
  }
  return {
    match: null,
    reason: 'ledger_busy',
    projection_hash_live: null,
    projection_hash_replay: null,
    event_count: 0,
    max_rowid: lastRowid,
    fsrs_impl: FSRS_IMPL,
    mismatched: { cards: 0, concepts: 0, sample: [] },
    attempts: REPLAY_VERIFY_MAX_ATTEMPTS,
    duration_ms: Math.max(0, clock.now() - started),
  };
}

/** job `replay-verify`(PGM-LR-093): args 파싱 → 읽기 전용 연결 → runReplayVerify → close. */
export function makeReplayVerifyJob(deps: ProjectionJobDeps): JobDefinition {
  return defineJob('replay-verify', async (rawArgs, ctx) => {
    const args = ProjectionJobArgs.parse(rawArgs);
    const runtime = await (deps.runtime ?? loadSqliteRuntime)();
    ctx.progress(null, 'open');
    const db = runtime.openDb(homePath(args.home, 'data', 'learning.db'), learningDbOptions(true));
    try {
      const params = createProjectorParamsResolver({
        policyDir: args.policy_dir,
        setsDir: homePath(args.home, 'policy', 'sets'),
      });
      ctx.progress(null, 'replay');
      return { ...runReplayVerify(db, { source: deps.source, params, signal: ctx.signal }) };
    } finally {
      db.close();
    }
  });
}
