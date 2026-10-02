import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LR_ERRORS } from '@fathom/contracts/http/learning/v1/errors';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEARNER_MODEL_ERROR_MAP } from '../../../src/application/learner-model/errors.js';
import { ProjectionParamsError } from '../../../src/domain/learner-model/projector/errors.js';
import type { ConceptRow } from '../../../src/domain/learner-model/projector/types.js';
import { LIVE_TABLES } from '../../../src/infra/db/learner-model-projection.sql.js';
import { createProjectionStore } from '../../../src/infra/db/learner-model-store.js';
import { createEventTargetLookup } from '../../../src/infra/db/learner-model-targets.js';
import {
  ensureProjectionMeta,
  FSRS_IMPL,
  NO_POLICY_VERSION,
  recomputeProjectionMeta,
} from '../../../src/infra/projection/meta.js';
import { createProjectorParamsResolver } from '../../../src/infra/projection/params-resolver.js';
import { projectionHashFromDb, projectionHashFromSlice } from '../../../src/infra/projection/projection-hash.js';
import { insertEvent, openMigratedMemoryDb } from './support/db.js';
import { DAY, EventFactory, T0 } from './support/events.js';
import { generateLedger } from './support/generator.js';
import { FAKE_DB, MemoryResolver, runReplay } from './support/memory.js';
import { FSRS, MASTERY, POLICY_DIR, REPO_MEMBERS, REPO_PARAMS, REPO_PS } from './support/policy.js';

let tmp: string;
let db: SqlitePort;
beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'fathom-lm-'));
  db = await openMigratedMemoryDb();
});
afterAll(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

const freshDb = (): Promise<SqlitePort> => openMigratedMemoryDb();
const kindOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectionParamsError ? e.kind : `other:${String(e)}`;
  }
  return 'no-throw';
};

describe('learner-model infra — resolver · store · 해시 · 메타', () => {
  it('UT-LR-153 resolver: 등록·원장 policy.switched 조회·sets 파일·member sha 불일치·미지 ps 오류 [NFR-DATA-002]', async () => {
    // ① 등록된 members → loadPolicy(lock 대조) → buildProjectorParams
    const reg = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir: null });
    reg.register(REPO_PS, REPO_MEMBERS);
    const p = reg.resolve(FAKE_DB, REPO_PS);
    expect(p.policy_version).toBe(REPO_PS);
    expect(p.fsrs.w).toEqual(FSRS.w);
    expect(p.mastery.elo.alpha).toBe(MASTERY.elo.alpha);
    expect(reg.resolve(FAKE_DB, REPO_PS)).toBe(p); // 캐시
    // 같은 ps 재등록 = no-op, 다른 members = invariant throw
    reg.register(REPO_PS, REPO_MEMBERS);
    expect(() =>
      reg.register(REPO_PS, { ...REPO_MEMBERS, fsrs_params: { ...REPO_MEMBERS.fsrs_params, sha256: 'f'.repeat(64) } }),
    ).toThrow(/re-registered with different members/);
    // ② 원장의 policy.switched payload
    const ledgerDb = await freshDb();
    const f = new EventFactory();
    insertEvent(ledgerDb, f.policySwitched({ ts: T0 }));
    const fromLedger = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir: null }).resolve(
      ledgerDb,
      REPO_PS,
    );
    expect(fromLedger.fsrs.request_retention).toEqual(FSRS.request_retention);
    // ③ sets 파일
    const setsDir = path.join(tmp, 'sets');
    mkdirSync(setsDir, { recursive: true });
    writeFileSync(
      path.join(setsDir, `${REPO_PS}.json`),
      JSON.stringify({ policy_version: REPO_PS, members: REPO_MEMBERS, overrides_sha256: null, created_at: T0 }),
    );
    const emptyDb = await freshDb();
    const fromFile = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir }).resolve(emptyDb, REPO_PS);
    expect(fromFile.policy_version).toBe(REPO_PS);
    // member sha 불일치 = params_hash_mismatch
    const bad = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir: null });
    bad.register(REPO_PS, {
      ...REPO_MEMBERS,
      mastery_rules: { ...REPO_MEMBERS.mastery_rules, sha256: 'e'.repeat(64) },
    });
    expect(kindOf(() => bad.resolve(emptyDb, REPO_PS))).toBe('params_hash_mismatch');
    // 미지 ps·누락 member·lock에 없는 정책 = params_unresolvable
    const none = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir });
    expect(kindOf(() => none.resolve(emptyDb, 'ps_0123456789abcdef'))).toBe('params_unresolvable');
    const partial = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir: null });
    partial.register('ps_1111111111111111', { fsrs_params: REPO_MEMBERS.fsrs_params });
    expect(kindOf(() => partial.resolve(emptyDb, 'ps_1111111111111111'))).toBe('params_unresolvable');
    const ghost = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir: null });
    ghost.register('ps_2222222222222222', {
      ...REPO_MEMBERS,
      fsrs_params: { version: 'fsrs_params@v9', sha256: 'a'.repeat(64) },
    });
    expect(kindOf(() => ghost.resolve(emptyDb, 'ps_2222222222222222'))).toBe('params_unresolvable');
    expect(kindOf(() => none.resolve(emptyDb, 'not-a-ps'))).toBe('params_unresolvable');
    ledgerDb.close();
    emptyDb.close();
  });

  it('UT-LR-154 DB store: canonical state_json, 생성 열(due_at·lapses·n_graded·mastered) 값 일치 [NFR-DATA-002][STD-TS-24]', async () => {
    const d = await freshDb();
    const store = createProjectionStore(d, LIVE_TABLES);
    const f = new EventFactory();
    const events = [
      f.enrolled({ ts: T0 }),
      f.graded({ ts: T0 + DAY }, { rating: 1, result: 'incorrect' }),
      f.graded({ ts: T0 + 2 * DAY }, { rating: 3 }),
    ];
    const slice = runReplay(events, new MemoryResolver([REPO_PARAMS]));
    const card = slice.cards['k8s.probes:concept:p'];
    const conceptRow = slice.concepts['k8s.probes'];
    if (card === undefined || conceptRow === undefined) {
      throw new Error('fixture');
    }
    const mastered: ConceptRow = {
      ...conceptRow,
      concept_id: 'net.tcp',
      track_id: 'net',
      state: { ...conceptRow.state, mastery: { p: 0.9, mastered: true, provisional: false }, n_graded: 77 },
    };
    // Act
    store.putCard(card);
    store.putConcept(conceptRow);
    store.putConcept(mastered);
    // Assert: state_json = 정준 JSON, 생성 열 = state_json 경로
    const cardRaw = d
      .prepare('SELECT state_json, due_at, lapses, last_ts FROM lr_card_state WHERE card_id = :id')
      .get({ id: card.card_id });
    expect(cardRaw?.state_json).toBe(canonicalJson(card.state));
    expect(cardRaw?.due_at).toBe(card.state.due);
    expect(cardRaw?.lapses).toBe(card.state.lapses);
    expect(cardRaw?.last_ts).toBe(card.last_ts);
    const conceptRaw = d
      .prepare('SELECT state_json, n_graded, mastered FROM lr_concept_state WHERE concept_id = :id')
      .get({ id: 'k8s.probes' });
    expect(conceptRaw?.state_json).toBe(canonicalJson(conceptRow.state));
    expect(conceptRaw?.n_graded).toBe(conceptRow.state.n_graded);
    expect(conceptRaw?.mastered).toBe(0);
    expect(
      d.prepare('SELECT n_graded, mastered FROM lr_concept_state WHERE concept_id = :id').get({ id: 'net.tcp' }),
    ).toEqual({ n_graded: 77, mastered: 1 });
    // 왕복
    expect(store.getCard(card.card_id)).toEqual(card);
    expect(store.getConcept('net.tcp')).toEqual(mastered);
    expect(store.getCard('nope:concept:p')).toBeNull();
    expect(store.getConcept('nope.x')).toBeNull();
    // UPSERT = 같은 키 덮어쓰기
    store.putCard({ ...card, status: 'suspended', last_ts: card.last_ts + 1 });
    expect(store.getCard(card.card_id)?.status).toBe('suspended');
    expect(d.prepare('SELECT count(*) AS n FROM lr_card_state').get()?.n).toBe(1);
    // 바깥에서 변조된 state_json(알 수 없는 키) = 읽을 때 zod .strict() 거부
    d.prepare("UPDATE lr_card_state SET state_json = json_set(state_json, '$.extra', 1) WHERE card_id = :id").run({
      id: card.card_id,
    });
    expect(() => store.getCard(card.card_id)).toThrow();
    // 대상 키 조회(lr_event STORED 열)
    const [g1, g2] = events.slice(1);
    if (g1 === undefined || g2 === undefined) {
      throw new Error('fixture');
    }
    for (const e of events) {
      insertEvent(d, e);
    }
    const keys = createEventTargetLookup().keysOf(d, [g1.event_id, g2.event_id, 'unknown']);
    expect(keys).toEqual({ card_ids: ['k8s.probes:concept:p'], concept_ids: ['k8s.probes'] });
    expect(createEventTargetLookup().keysOf(d, [])).toEqual({ card_ids: [], concept_ids: [] });
    d.close();
  });

  it('UT-LR-155 projectionHashFromDb = projectionHashFromSlice(같은 투영, 나머지 4표 fallback 포함) [NFR-DATA-002]', async () => {
    const d = await freshDb();
    const slice = runReplay(generateLedger(7, { min: 60, max: 80 }), new MemoryResolver([REPO_PARAMS]));
    const store = createProjectionStore(d, LIVE_TABLES);
    for (const row of Object.values(slice.cards)) {
      store.putCard(row);
    }
    for (const row of Object.values(slice.concepts)) {
      store.putConcept(row);
    }
    expect(Object.keys(slice.cards).length).toBeGreaterThan(0);
    // 나머지 표에 행이 있어도 두 함수는 같은 값(fallbackDb 사용)
    d.prepare('INSERT INTO lr_setting(key, value_json, last_ts, source_event_id) VALUES (:k, :v, 1, :e)').run({
      k: 'day_boundary',
      v: '"04:00"',
      e: 'E'.repeat(26),
    });
    d.prepare(
      'INSERT INTO lr_lifecycle(concept_id, last_ts, state_json) VALUES (\'k8s.probes\', 1, \'{"state":"CL-1"}\')',
    ).run();
    const fromDb = projectionHashFromDb(d);
    expect(projectionHashFromSlice(slice, d)).toBe(fromDb);
    expect(fromDb).toMatch(/^[0-9a-f]{64}$/);
    // 투영이 달라지면 해시도 달라진다
    const card = Object.values(slice.cards)[0];
    if (card === undefined) {
      throw new Error('fixture');
    }
    store.putCard({ ...card, last_ts: card.last_ts + 1 });
    expect(projectionHashFromDb(d)).not.toBe(fromDb);
    expect(projectionHashFromSlice(slice, d)).toBe(fromDb);
    d.close();
  });

  it('UT-LR-156 메타: 지연 시드 1회·fsrs_impl·빈 원장 last_order_json = [] [NFR-DATA-003]', async () => {
    const d = await freshDb();
    const clock = createFakeClock();
    const rowOf = () => d.prepare("SELECT * FROM lr_projection_meta WHERE name = 'live'").get();
    expect(rowOf()).toBeUndefined();
    // 빈 원장 지연 시드
    ensureProjectionMeta(d, clock);
    const first = rowOf();
    expect(first).toMatchObject({
      name: 'live',
      fsrs_impl: FSRS_IMPL,
      policy_version: NO_POLICY_VERSION,
      event_count: 0,
      last_order_json: '[]',
      computed_at: clock.now(),
    });
    expect(first?.projection_hash).toBe(projectionHashFromDb(d));
    // 두 번째 ensure = 읽기뿐(computed_at 불변)
    clock.advance(5000);
    ensureProjectionMeta(d, clock);
    expect(rowOf()).toEqual(first);
    // recompute = 원장 사실로 갱신
    const f = new EventFactory();
    insertEvent(d, f.enrolled({ ts: T0 }));
    const sw = f.policySwitched({ ts: T0 + 10 });
    insertEvent(d, sw);
    insertEvent(d, f.graded({ ts: T0 + 20, device: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ' }, {}));
    const res = recomputeProjectionMeta(d, clock);
    expect(res.event_count).toBe(3);
    expect(rowOf()).toMatchObject({
      event_count: 3,
      policy_version: REPO_PS,
      last_order_json: JSON.stringify([T0 + 20, 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ', 1]),
      computed_at: clock.now(),
    });
    d.close();
  });

  it('UT-LR-158 LEARNER_MODEL_ERROR_MAP 3종 = LR-INTERNAL-001 [NFR-DATA-002][STD-ERR-14]', () => {
    expect(LEARNER_MODEL_ERROR_MAP).toEqual({
      params_unresolvable: 'LR-INTERNAL-001',
      params_hash_mismatch: 'LR-INTERNAL-001',
      projection_invariant: 'LR-INTERNAL-001',
    });
    expect(Object.keys(LR_ERRORS)).toContain('LR-INTERNAL-001');
  });
});
