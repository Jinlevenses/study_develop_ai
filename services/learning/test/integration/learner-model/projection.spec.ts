import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SnapshotResult } from '@fathom/contracts/admin/admin-routes';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { createJobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { replayFold } from '../../../src/application/learner-model/replay.js';
import { ProjectionParamsError } from '../../../src/domain/learner-model/projector/errors.js';
import { learningDbOptions } from '../../../src/infra/db/open.js';
import { createProjectionApplier } from '../../../src/infra/projection/applier.js';
import { recomputeProjectionMeta } from '../../../src/infra/projection/meta.js';
import { createProjectorParamsResolver } from '../../../src/infra/projection/params-resolver.js';
import { projectionHashFromDb, projectionHashFromSlice } from '../../../src/infra/projection/projection-hash.js';
import { runRebuild } from '../../../src/jobs/rebuild.js';
import { runReplayVerify } from '../../../src/jobs/replay-verify.js';
import { insertEvent } from '../../unit/learner-model/support/db.js';
import { DEV_B, EventFactory, T0 } from '../../unit/learner-model/support/events.js';
import { generateLedger } from '../../unit/learner-model/support/generator.js';
import { POLICY_DIR, REPO_PS } from '../../unit/learner-model/support/policy.js';
import { execArgvFor, MAIN, runMode, withTempHome } from '../migrations/helpers/boot.js';
import { createSqlReplaySource } from './support/sql-replay-source.js';

// IT-360~368 — 실제 파일 DB(`--mode=migrate` 임시 홈) · 원장 행은 LEDGER_INSERT · 리플레이 소스는 테스트 지원 SQL 구현.

const JOB_ENTRY = new URL('./fixtures/job-entry.ts', import.meta.url).pathname;
const POLICY_DEVICE = fixedUlid(3);
const source = createSqlReplaySource();
const clock = createFakeClock();

const runners: { shutdown(): Promise<void> }[] = [];
afterEach(async () => {
  for (const r of runners.splice(0)) {
    await r.shutdown();
  }
});
function jobRunner(entry: string = JOB_ENTRY): ReturnType<typeof createJobRunner> {
  const r = createJobRunner({
    entry,
    execArgv: execArgvFor(),
    onStdoutLine: () => undefined,
    onStderrLine: () => undefined,
  });
  runners.push(r);
  return r;
}

const dbFile = (home: string): string => path.join(home, 'data', 'learning.db');
async function migratedDb(home: string): Promise<SqlitePort> {
  expect((await runMode(home, ['--mode=migrate'])).code).toBe(0);
  return openDb(dbFile(home), learningDbOptions(false));
}
const newResolver = () => createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir: null });
const newApplier = () => createProjectionApplier({ source, params: newResolver(), clock });

/** 초기 정책 전환 이벤트 + 생성 원장. 같은 ps(REPO_PS)를 쓴다. */
function ledgerFor(seed: number, min: number, max: number): LedgerEventEnvelope[] {
  const f = new EventFactory(5_000_000);
  // 정책 전환은 생성기 이벤트와 (device_id, device_seq)가 겹치지 않게 별도 기기로 둔다
  return [f.policySwitched({ ts: T0 - 10, device: POLICY_DEVICE }), ...generateLedger(seed, { min, max })];
}
/** 원장 append와 같은 tx에서 인라인 투영(운영 writer의 모양). */
function appendLive(db: SqlitePort, applier: ReturnType<typeof newApplier>, e: LedgerEventEnvelope): void {
  db.tx(() => {
    expect(insertEvent(db, e)).toBe(true);
    applier.apply(db, e);
  });
}
function liveHashOfReplay(db: SqlitePort): { readonly live: string; readonly replay: string } {
  const { slice } = replayFold(db, source, newResolver());
  return { live: projectionHashFromDb(db), replay: projectionHashFromSlice(slice, db) };
}
const sha256File = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
const runVerify = (home: string) =>
  jobRunner().run('replay-verify', { home, policy_dir: POLICY_DIR }, { timeoutMs: 60_000 });

function unwrap(r: Awaited<ReturnType<typeof runVerify>>): Record<string, unknown> {
  if (!r.ok) {
    throw new Error(`job failed: ${r.error.kind}: ${r.error.message}`);
  }
  return r.value;
}

describe('learner-model replay-verify · rebuild job', () => {
  it('IT-360 replay-verify job 자식 → match true · 두 해시 동일 [NFR-DATA-002]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      const applier = newApplier();
      const events = ledgerFor(360, 90, 120);
      for (const e of events) {
        appendLive(db, applier, e);
      }
      db.close();
      const result = unwrap(await runVerify(home.path));
      expect(result).toMatchObject({
        match: true,
        reason: null,
        fsrs_impl: 'ts-fsrs@5.4.2',
        event_count: events.length,
        max_rowid: events.length,
        attempts: 1,
        mismatched: { cards: 0, concepts: 0, sample: [] },
      });
      expect(result.projection_hash_live).toBe(result.projection_hash_replay);
      expect(String(result.projection_hash_live)).toMatch(/^[0-9a-f]{64}$/);
    });
  }, 120_000);

  it('IT-361 투영 행 변조 → match false · sample에 키 · DB 파일 바이트 불변 [NFR-DATA-002]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      const applier = newApplier();
      for (const e of ledgerFor(361, 80, 100)) {
        appendLive(db, applier, e);
      }
      const victim = db.prepare('SELECT card_id FROM lr_card_state ORDER BY card_id LIMIT 1').get()?.card_id;
      const victimConcept = db
        .prepare('SELECT concept_id FROM lr_concept_state ORDER BY concept_id LIMIT 1')
        .get()?.concept_id;
      db.prepare("UPDATE lr_card_state SET state_json = json_set(state_json, '$.reps', 999) WHERE card_id = :id").run({
        id: String(victim),
      });
      db.prepare(
        "UPDATE lr_concept_state SET state_json = json_set(state_json, '$.theta', 7.5) WHERE concept_id = :id",
      ).run({
        id: String(victimConcept),
      });
      db.close(); // 마지막 연결이 닫히며 WAL이 본 파일로 체크포인트된다
      const before = sha256File(dbFile(home.path));
      const result = unwrap(await runVerify(home.path));
      expect(result.match).toBe(false);
      expect(result.projection_hash_live).not.toBe(result.projection_hash_replay);
      expect(result.mismatched).toMatchObject({ cards: 1, concepts: 1 });
      expect(result.mismatched).toEqual({
        cards: 1,
        concepts: 1,
        sample: [`card:${String(victim)}`, `concept:${String(victimConcept)}`],
      });
      expect(sha256File(dbFile(home.path))).toBe(before); // 읽기 전용 — 자동 수정 금지
    });
  }, 120_000);

  it('IT-362 rebuild job → 해시 복구 · 인덱스 이름 보존(sqlite_schema) · 메타 갱신 [NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      const applier = newApplier();
      for (const e of ledgerFor(362, 80, 100)) {
        appendLive(db, applier, e);
      }
      const indexNames = (): string[] =>
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name IN ('lr_card_state', 'lr_concept_state') AND sql IS NOT NULL ORDER BY name",
          )
          .all()
          .map((r) => String(r.name));
      const before = indexNames();
      expect(before).toEqual(['ix_lr_card_state_concept', 'ix_lr_card_state_due', 'ix_lr_concept_state_track']);
      const goodHash = projectionHashFromDb(db);
      db.prepare("UPDATE lr_card_state SET state_json = json_set(state_json, '$.reps', 999)").run();
      expect(projectionHashFromDb(db)).not.toBe(goodHash);
      db.close();
      // Act
      const rebuilt = unwrap(
        await jobRunner().run('rebuild', { home: home.path, policy_dir: POLICY_DIR }, { timeoutMs: 60_000 }),
      );
      // Assert
      expect(rebuilt.projection_hash).toBe(goodHash);
      expect(rebuilt.catch_up_events).toBe(0);
      const check = openDb(dbFile(home.path), learningDbOptions(false));
      try {
        expect(projectionHashFromDb(check)).toBe(goodHash);
        const names = check
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name IN ('lr_card_state', 'lr_concept_state') AND sql IS NOT NULL ORDER BY name",
          )
          .all()
          .map((r) => String(r.name));
        expect(names).toEqual(before);
        expect(check.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%__shadow'").all()).toEqual([]);
        const meta = check.prepare("SELECT * FROM lr_projection_meta WHERE name = 'live'").get();
        expect(meta).toMatchObject({
          projection_hash: goodHash,
          fsrs_impl: 'ts-fsrs@5.4.2',
          policy_version: REPO_PS,
          event_count: Number(rebuilt.event_count),
        });
        // 재구성 후 검증 통과
        expect(runReplayVerify(check, { source, params: newResolver() }).match).toBe(true);
        // 생성 열이 교체 후에도 살아 있다
        expect(
          check.prepare('SELECT count(*) AS n FROM lr_card_state WHERE due_at IS NOT NULL AND lapses IS NOT NULL').get()
            ?.n,
        ).toBe(rebuilt.rows !== undefined ? (rebuilt.rows as { cards: number }).cards : -1);
      } finally {
        check.close();
      }
    });
  }, 120_000);

  it('IT-363 runRebuild beforeSwap에서 이벤트 3건 추가 → 캐치업 후 = 전체 리플레이 [NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      try {
        const applier = newApplier();
        const events = ledgerFor(363, 70, 90);
        for (const e of events) {
          appendLive(db, applier, e);
        }
        const graded = events.filter((e) => e.type === 'attempt.graded');
        const target = graded.at(2);
        const sample = graded.at(0);
        if (target === undefined || sample === undefined) {
          throw new Error('fixture');
        }
        const f = new EventFactory(6_000_000);
        const lastTs = Math.max(...events.map((e) => e.client_ts));
        const extra = [
          // 기존 카드에 새 채점(다른 기기), 같은 이벤트를 무효화하는 정정, 새 개념의 카드 등록
          f.graded(
            { ts: lastTs + 1000, device: DEV_B, seq: 9_001 },
            {
              concept_id: String(sample.payload.concept_id),
              card_id: String(sample.payload.card_id),
              facet: String(sample.payload.facet),
              response_mode: sample.payload.response_mode === 'recognition' ? 'recognition' : 'production',
              result: 'incorrect',
              rating: 1,
            },
          ),
          f.voided({ ts: lastTs + 2000, device: DEV_B, seq: 9_002 }, [target.event_id]),
          f.enrolled({ ts: lastTs + 3000, device: DEV_B, seq: 9_003 }, { concept_id: 'sre.late-arrival' }),
        ];
        // Act: 재구성 도중(shadow 완성 후, 교체 전) 라이브 쪽에 3건 도착 — 투영은 건드리지 않고 원장에만 넣는다
        const result = runRebuild(
          db,
          { source, params: newResolver(), clock },
          {
            beforeSwap: (d) => {
              for (const e of extra) {
                expect(insertEvent(d, e)).toBe(true);
              }
            },
          },
        );
        // Assert
        expect(result.catch_up_events).toBe(3);
        const { live, replay } = liveHashOfReplay(db);
        expect(live).toBe(replay);
        expect(result.projection_hash).toBe(live);
        expect(db.prepare("SELECT event_count FROM lr_projection_meta WHERE name = 'live'").get()?.event_count).toBe(
          events.length + 3,
        );
        expect(
          db.prepare("SELECT concept_id FROM lr_concept_state WHERE concept_id = 'sre.late-arrival'").get(),
        ).toBeDefined();
      } finally {
        db.close();
      }
    });
  }, 120_000);

  it('IT-368 rebuild 캐치업: 사슬 구성원 void + 지각 card.status_changed → 라이브 = 전체 리플레이 [NFR-DATA-002][NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      try {
        const applier = newApplier();
        const f = new EventFactory(7_000_000);
        const base = [
          f.policySwitched({ ts: T0 - 10, device: POLICY_DEVICE }),
          f.enrolled({ ts: T0 }),
          f.graded({ ts: T0 + 1000 }, { rating: 4, result: 'correct' }),
        ];
        const upgraded = f.upgraded({ ts: T0 + 2000 }, base[2]?.event_id ?? '', {});
        const voided = f.voided({ ts: T0 + 3000 }, [upgraded.event_id]);
        for (const e of [...base, upgraded, voided]) {
          appendLive(db, applier, e);
        }
        const cardId = String(base[2]?.payload.card_id);
        // 재구성 도중 도착하는 지각 card.status_changed — 캐치업의 키 재도출은 concept_ids = [] 로 시작한다
        const late = f.statusChanged({ ts: T0 + 500, device: DEV_B, seq: 9_101 }, cardId, 'active');
        const result = runRebuild(
          db,
          { source, params: newResolver(), clock },
          {
            beforeSwap: (d) => {
              expect(insertEvent(d, late)).toBe(true);
            },
          },
        );
        expect(result.catch_up_events).toBe(1);
        const { live, replay } = liveHashOfReplay(db);
        expect(live).toBe(replay);
        expect(result.projection_hash).toBe(live);
        const reps = db.prepare("SELECT json_extract(state_json, '$.reps') AS reps FROM lr_card_state").get()?.reps;
        expect(reps).toBe(0);
      } finally {
        db.close();
      }
    });
  }, 120_000);

  it('IT-364 rebuild 도중 취소 → 라이브 불변 · 다음 rebuild 성공 [NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      try {
        const applier = newApplier();
        for (const e of ledgerFor(364, 70, 90)) {
          appendLive(db, applier, e);
        }
        db.prepare("UPDATE lr_card_state SET state_json = json_set(state_json, '$.reps', 777)").run();
        const tampered = projectionHashFromDb(db);
        // 사전 취소 — shadow도 만들지 않는다
        const pre = new AbortController();
        pre.abort();
        expect(() => runRebuild(db, { source, params: newResolver(), clock, signal: pre.signal })).toThrow('cancelled');
        expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%__shadow'").all()).toEqual([]);
        // shadow 완성 뒤 교체 직전 취소 — 라이브 불변, shadow만 남는다
        const mid = new AbortController();
        expect(() =>
          runRebuild(
            db,
            { source, params: newResolver(), clock, signal: mid.signal },
            { beforeSwap: () => mid.abort() },
          ),
        ).toThrow('cancelled');
        expect(projectionHashFromDb(db)).toBe(tampered);
        expect(
          db
            .prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%__shadow' ORDER BY name")
            .all()
            .map((r) => r.name),
        ).toEqual(['lr_card_state__shadow', 'lr_concept_state__shadow']);
        // 다음 실행이 DROP IF EXISTS로 정리하고 성공
        const ok = runRebuild(db, { source, params: newResolver(), clock });
        expect(ok.projection_hash).not.toBe(tampered);
        expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '%__shadow'").all()).toEqual([]);
        const { live, replay } = liveHashOfReplay(db);
        expect(live).toBe(replay);
      } finally {
        db.close();
      }
    });
  }, 120_000);

  it('IT-365 db.tx 안 LEDGER_INSERT + applier.apply 1,000건 → 라이브 = 리플레이, apply 예외 시 tx 롤백 후 투영 0행 [NFR-DATA-002]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      try {
        const applier = newApplier();
        const events = ledgerFor(365, 1000, 1000);
        for (const e of events) {
          appendLive(db, applier, e);
        }
        expect(events.length).toBeGreaterThanOrEqual(1000);
        expect(db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n).toBe(events.length);
        const { live, replay } = liveHashOfReplay(db);
        expect(live).toBe(replay);
        // 인라인 투영이 같은 tx에 있으므로 replay-verify도 통과
        expect(runReplayVerify(db, { source, params: newResolver() }).match).toBe(true);
      } finally {
        db.close();
      }
    });
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      try {
        // 미지 정책 세트의 채점 → resolver가 던지고 tx는 롤백(원장 행·투영·메타 모두 0)
        const f = new EventFactory(7_000_000);
        const bad = f.graded({ ts: T0 }, { policy_version: 'ps_0123456789abcdef' });
        expect(() => appendLive(db, newApplier(), bad)).toThrow(ProjectionParamsError);
        expect(db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n).toBe(0);
        expect(db.prepare('SELECT count(*) AS n FROM lr_card_state').get()?.n).toBe(0);
        expect(db.prepare('SELECT count(*) AS n FROM lr_concept_state').get()?.n).toBe(0);
        expect(db.prepare('SELECT count(*) AS n FROM lr_projection_meta').get()?.n).toBe(0);
      } finally {
        db.close();
      }
    });
  }, 180_000);

  it('IT-366 기존 snapshot job이 projection_hash·fsrs_impl 반환(메타 시드 후) [NFR-DATA-003][IF-COM-006]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      let hash: string;
      try {
        const applier = newApplier();
        for (const e of ledgerFor(366, 40, 60)) {
          appendLive(db, applier, e);
        }
        // 지연 시드는 첫 append 때 1회 — 체크포인트 시점의 갱신은 recomputeProjectionMeta(T-01-09/IT-03이 부른다)
        hash = db.tx(() => recomputeProjectionMeta(db, clock).projection_hash);
        expect(hash).toBe(projectionHashFromDb(db));
      } finally {
        db.close();
      }
      const epoch = fixedUlid(366);
      const dir = path.join(home.path, 'backups', 'snap', epoch);
      mkdirSync(dir, { recursive: true });
      const runner = createJobRunner({
        entry: MAIN,
        execArgv: execArgvFor(),
        onStdoutLine: () => undefined,
        onStderrLine: () => undefined,
      });
      runners.push(runner);
      const snap = await runner.run('snapshot', { epoch_id: epoch, dir, home: home.path }, { timeoutMs: 30_000 });
      const parsed = SnapshotResult.parse(snap.ok ? snap.value : null);
      expect(parsed.projection_hash).toBe(hash);
      expect(parsed.fsrs_impl).toBe('ts-fsrs@5.4.2');
    });
  }, 120_000);

  it('IT-367 20,000건 replay-verify 소요 실측(기록, 관대 상한 60s) [NFR-DATA-002][NFR-DATA-003]', async () => {
    await withTempHome(async (home) => {
      const db = await migratedDb(home.path);
      try {
        const events = ledgerFor(367, 20_000, 20_000);
        for (let from = 0; from < events.length; from += 2000) {
          db.tx(() => {
            for (const e of events.slice(from, from + 2000)) {
              expect(insertEvent(db, e)).toBe(true);
            }
          });
        }
        // 투영은 rebuild로 만든다(원장만으로 재구성 — 소요도 기록)
        const t0 = performance.now();
        const rebuilt = runRebuild(db, { source, params: newResolver(), clock });
        const rebuildMs = Math.round(performance.now() - t0);
        const t1 = performance.now();
        const verified = runReplayVerify(db, { source, params: newResolver() });
        const verifyMs = Math.round(performance.now() - t1);
        process.stdout.write(
          `IT-367 events=${events.length} rebuild_ms=${rebuildMs} replay_verify_ms=${verifyMs} cards=${rebuilt.rows.cards} concepts=${rebuilt.rows.concepts}\n`,
        );
        expect(verified.match).toBe(true);
        expect(verified.event_count).toBe(events.length);
        expect(verifyMs).toBeLessThan(60_000);
      } finally {
        db.close();
      }
    });
  }, 300_000);
});
