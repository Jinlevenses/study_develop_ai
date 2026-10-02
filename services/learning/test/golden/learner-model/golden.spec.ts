import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CardRow } from '../../../src/domain/learner-model/projector/types.js';
import { projectionHashFromDb, projectionHashFromSlice } from '../../../src/infra/projection/projection-hash.js';
import { openMigratedMemoryDb } from '../../unit/learner-model/support/db.js';
import { REPO_MEMBERS, REPO_PS } from '../../unit/learner-model/support/policy.js';
import {
  buildMiniLedger,
  computeSet,
  FSRS_IMPL_EXPECTED,
  goldenResolver,
  miniLedgerSha,
  readExpected,
  versionBoundResolver,
} from './golden-core.js';
import { GOLDEN_SET_NAMES, goldenLedgerPresent, readGoldenLedger } from './read-ledger.js';

const SERVICE_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const COMPUTE = fileURLToPath(new URL('./compute-expected.ts', import.meta.url));
const REPO_PS_NOTE = 'mini';

let db: SqlitePort;
beforeAll(async () => {
  db = await openMigratedMemoryDb();
});
afterAll(() => {
  db.close();
});

const present = GOLDEN_SET_NAMES.filter(goldenLedgerPresent);

/** 독립 구현: 키를 UTF-16 순서로 정렬해 직렬화(canonicalJson을 쓰지 않는다). */
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(sortedJson).join(',')}]`;
  }
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${sortedJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

describe('learner-model 골든 투영 해시', () => {
  it.skipIf(present.length === 0)(
    'UT-LR-600 골든 원장 3종(있을 때) 투영 해시 = expected-projection.json, fsrs_impl = ts-fsrs@5.4.2 [NFR-DATA-003]',
    async () => {
      const expected = readExpected();
      expect(expected.fsrs_impl).toBe('ts-fsrs@5.4.2');
      for (const name of present) {
        const g = readGoldenLedger(name);
        const want = expected.sets[name];
        expect(want, `${name}: expected-projection.json 항목 없음`).toBeDefined();
        if (g === null || want === undefined) {
          continue;
        }
        const got = await computeSet(g.events, g.sha256, versionBoundResolver(g.events), db);
        const { projection: _p, ...result } = got;
        expect(result, name).toEqual(want);
      }
    },
  );

  it('UT-LR-601 정준 해시 규칙: 손으로 만든 2행 입력 → 독립 계산 기대 해시, 키 순서 무관, 0.1+0.2 최단 왕복 표기, 빈 테이블 줄 [NFR-DATA-002]', async () => {
    const d = await openMigratedMemoryDb();
    try {
      const state = (due: number, stability: number) => ({
        due,
        stability,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 1,
        learning_steps: 0,
        reps: 1,
        lapses: 0,
        state: 2,
        last_review: due,
        last_fsrs_at: due,
        leech: false,
      });
      const rowB: CardRow = {
        card_id: 'net.tcp:concept:p',
        concept_id: 'net.tcp',
        facet: 'concept',
        response_mode: 'production',
        tier: 'A',
        status: 'active',
        last_ts: 20,
        state: state(1000, 0.1 + 0.2) as CardRow['state'],
      };
      const rowA: CardRow = {
        ...rowB,
        card_id: 'k8s.probes:concept:r',
        concept_id: 'k8s.probes',
        response_mode: 'recognition',
        tier: 'B',
        last_ts: 10,
        state: state(500, 2) as CardRow['state'],
      };
      // 기대: 테이블 6개 순서 · PK 오름차순 · 행 = 정렬 키 정준 JSON(state_json = 파싱한 값) · 빈 테이블은 이름 줄만
      const line = (r: CardRow): string =>
        `${sortedJson({ card_id: r.card_id, concept_id: r.concept_id, facet: r.facet, response_mode: r.response_mode, tier: r.tier, status: r.status, last_ts: r.last_ts, state_json: r.state })}\n`;
      const text = `lr_card_state\n${line(rowA)}${line(rowB)}lr_concept_state\nlr_lifecycle\nlr_mc_state\nlr_track_level\nlr_setting\n`;
      expect(text).toContain('"stability":0.30000000000000004'); // 최단 왕복 표기
      const expected = createHash('sha256').update(text, 'utf8').digest('hex');
      // slice 경로: 입력 순서·키 순서와 무관
      const scrambled = (r: CardRow): CardRow =>
        JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r).reverse())));
      expect(
        projectionHashFromSlice(
          { cards: { [rowB.card_id]: scrambled(rowB), [rowA.card_id]: scrambled(rowA) }, concepts: {} },
          d,
        ),
      ).toBe(expected);
      // DB 경로: state_json을 키 순서가 다른 텍스트로 저장해도 같은 해시
      const insert = d.prepare(
        'INSERT INTO lr_card_state(card_id, concept_id, facet, response_mode, tier, status, last_ts, state_json) VALUES (:card_id, :concept_id, :facet, :response_mode, :tier, :status, :last_ts, :state_json)',
      );
      for (const r of [rowB, rowA]) {
        const reversed = JSON.stringify(Object.fromEntries(Object.entries(r.state).reverse()));
        insert.run({
          card_id: r.card_id,
          concept_id: r.concept_id,
          facet: r.facet,
          response_mode: r.response_mode,
          tier: r.tier,
          status: r.status,
          last_ts: r.last_ts,
          state_json: reversed,
        });
      }
      expect(projectionHashFromDb(d)).toBe(expected);
      // 빈 DB = 6개 이름 줄만
      const empty = await openMigratedMemoryDb();
      expect(projectionHashFromDb(empty)).toBe(
        createHash('sha256')
          .update('lr_card_state\nlr_concept_state\nlr_lifecycle\nlr_mc_state\nlr_track_level\nlr_setting\n', 'utf8')
          .digest('hex'),
      );
      empty.close();
    } finally {
      d.close();
    }
  });

  it('UT-LR-630 mini 세트(createPrng(606) 600건 + KST 경계) 투영 해시 = 기대값 [NFR-DATA-003]', async () => {
    const mini = buildMiniLedger();
    expect(mini.length).toBe(605);
    expect(mini.some((e) => e.type === 'evidence.voided')).toBe(true);
    expect(new Set(mini.map((e) => e.device_id)).size).toBe(2);
    const { projection: _p, ...got } = await computeSet(
      mini,
      miniLedgerSha(mini),
      goldenResolver(mini, mini0Sets()),
      db,
    );
    const expected = readExpected();
    expect(expected.fsrs_impl).toBe(FSRS_IMPL_EXPECTED);
    expect(got).toEqual(expected.sets[REPO_PS_NOTE]);
    // KST 경계: 03:59:59(전날)와 04:00:00(새 학습일)이 다른 study_day로 들어갔다
    const boundary = mini.filter((e) => e.type === 'attempt.graded' && e.payload.concept_id === 'cs.kst-boundary');
    expect(boundary.map((e) => e.payload.study_day)).toEqual(['2026-09-20', '2026-09-20', '2026-09-21', '2026-09-21']);
  });

  it('UT-LR-631 compute-expected.ts(플래그 없음)가 exit 0 [NFR-DATA-003]', async () => {
    const code = await new Promise<number | null>((resolve, reject) => {
      const env: Record<string, string> = {};
      const path = process.env.PATH;
      if (path !== undefined) {
        env.PATH = path;
      }
      const child = spawn(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source', COMPUTE],
        {
          cwd: SERVICE_DIR,
          env,
          stdio: ['ignore', 'ignore', 'ignore'],
        },
      );
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(code).toBe(0);
  }, 60_000);

  it('UT-LR-632 리듀서가 §10.3 밖 필드(latency_ms·judge_log_ref 등)를 바꿔도 해시 불변 [NFR-DATA-003]', async () => {
    const mini = buildMiniLedger();
    const sha = miniLedgerSha(mini);
    const base = await computeSet(mini, sha, goldenResolver(mini, mini0Sets()), db);
    const mutated: LedgerEventEnvelope[] = mini.map((e, i) =>
      e.type === 'attempt.graded' || e.type === 'evidence.upgraded' || e.type === 'evidence.regraded'
        ? {
            ...e,
            payload: {
              ...e.payload,
              latency_ms: 123_456 + i,
              judge_log_ref: '01J0000000000000000000ZZZZ',
              confidence: 2,
              grader_confidence: 0.5,
              score: 0.123,
              band: 'partial',
              hints_used: 0,
              ai_mode: 'FULL',
              content_policy_version: `cp-${i}`,
              issued_at: 999 + i,
              session_id: '01J0000000000000000000YYYY',
            },
          }
        : e,
    );
    const after = await computeSet(mutated, sha, goldenResolver(mutated, mini0Sets()), db);
    expect(after.projection_hash).toBe(base.projection_hash);
    expect(after.projection).toEqual(base.projection);
  });
});

function mini0Sets(): Record<string, typeof REPO_MEMBERS> {
  return { [REPO_PS]: REPO_MEMBERS };
}
