import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { PolicySwitchedV1 } from '@fathom/contracts/ledger/payloads/policy-switched';
import { FsrsParamsV1 } from '@fathom/contracts/policy/fsrs_params';
import { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { canonicalJson, parseJsonStrict, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { loadPolicy } from '@fathom/shared-kernel/policy/policy';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { z } from 'zod';
import type { ProjectorParamsResolver } from '../../../src/application/learner-model/ports.js';
import { replayFold } from '../../../src/application/learner-model/replay.js';
import { buildProjectorParams } from '../../../src/domain/learner-model/fsrs/core.js';
import type { ProjectorParams } from '../../../src/domain/learner-model/projector/types.js';
import { createProjectorParamsResolver, type PolicyMembers } from '../../../src/infra/projection/params-resolver.js';
import { projectionHashFromSlice } from '../../../src/infra/projection/projection-hash.js';
import { openMigratedMemoryDb } from '../../unit/learner-model/support/db.js';
import { DEV_A, DEV_B, EventFactory } from '../../unit/learner-model/support/events.js';
import { generateLedger } from '../../unit/learner-model/support/generator.js';
import { MemoryLedger } from '../../unit/learner-model/support/memory.js';
import { POLICY_DIR, REPO_MEMBERS, REPO_PS } from '../../unit/learner-model/support/policy.js';
import { GOLDEN_SET_NAMES, readGoldenLedger } from './read-ledger.js';

// 골든 투영 — 기대값 파일 형식·계산·갱신(PLAN R-10). compute-expected.ts(스크립트)와 golden.spec.ts가 같은 계산을 쓴다.

export const EXPECTED_FILE = fileURLToPath(new URL('./expected-projection.json', import.meta.url));
export const FSRS_IMPL_EXPECTED = 'ts-fsrs@5.4.2';

export const SetExpected = z
  .object({
    ledger_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    event_count: z.number().int(),
    cards: z.number().int(),
    concepts: z.number().int(),
    projection_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type SetExpected = z.infer<typeof SetExpected>;
export const ExpectedFile = z
  .object({
    format: z.literal('fathom.golden-projection.v1'),
    fsrs_impl: z.literal(FSRS_IMPL_EXPECTED),
    sets: z.record(z.string(), SetExpected),
  })
  .strict();
export type ExpectedFile = z.infer<typeof ExpectedFile>;

/** KST 04:00 학습일 경계: UTC ms → 'YYYY-MM-DD'(= KST 시각 − 4h의 날짜). 테스트 전용 계산. */
export function studyDayKst(ms: number): string {
  return new Date(ms + 5 * 3_600_000).toISOString().slice(0, 10);
}

/** mini 세트 — createPrng(606)이 만든 600건(정정·두 기기·정책 세트 2종) + KST 03:30~04:30 경계 이벤트. 실행 시 재생성(결정적). */
export function buildMiniLedger(): LedgerEventEnvelope[] {
  const base = generateLedger(606, { min: 600, max: 600 });
  const f = new EventFactory(900_000);
  const concept = 'cs.kst-boundary';
  const at = (h: number, m: number, s = 0): number => Date.UTC(2026, 8, 20, h, m, s); // 2026-09-21 03:30 KST = 09-20 18:30 UTC
  const extra: LedgerEventEnvelope[] = [
    f.enrolled({ ts: at(18, 0), device: DEV_A, seq: 10_001 }, { concept_id: concept }),
  ];
  const times: readonly [number, 'correct' | 'incorrect', string][] = [
    [at(18, 30), 'correct', 'short'], // 03:30 KST → 전날 학습일
    [at(18, 59, 59), 'correct', 'cloze'], // 03:59:59 KST → 전날
    [at(19, 0), 'incorrect', 'short'], // 04:00:00 KST → 새 학습일
    [at(19, 30), 'correct', 'code_task'], // 04:30 KST → 새 학습일
  ];
  for (const [i, [ts, result, format]] of times.entries()) {
    extra.push(
      f.graded(
        { ts, device: i % 2 === 0 ? DEV_A : DEV_B, seq: 10_002 + i },
        { concept_id: concept, result, format, study_day: studyDayKst(ts), rating: result === 'correct' ? 3 : 1 },
      ),
    );
  }
  return [...base, ...extra];
}

/** 원장 안 policy.switched members를 전부 resolver에 미리 등록(저장소 policy/ + lock 해시 대조로 해석). 운영 resolver와 같은 코드 — mini 세트용. */
export function goldenResolver(
  events: readonly LedgerEventEnvelope[],
  seedSets: Readonly<Record<string, PolicyMembers>> = {},
): ReturnType<typeof createProjectorParamsResolver> {
  const resolver = createProjectorParamsResolver({ policyDir: POLICY_DIR, setsDir: null });
  for (const [ps, members] of Object.entries(seedSets)) {
    resolver.register(ps, members);
  }
  for (const e of events) {
    if (e.type === 'policy.switched') {
      const p = PolicySwitchedV1.parse(e.payload);
      resolver.register(p.policy_version, p.members);
    }
  }
  return resolver;
}

/**
 * T-01-02 골든 원장 3종의 policy.switched members는 자리표시 sha256(= sha256Hex('<ref>'))이라 저장소 policy.lock.json 해시와 다르다 → 운영 resolver는
 * `params_hash_mismatch`로 거부한다(Brief §7 ambiguity, 완료 보고 deviations). 골든 하네스는 **리듀서 결정성**만 검증하므로 member의 `version`으로
 * 저장소 policy/ 값을 묶는다(lock 해시 대조는 loadPolicy가 그대로 수행, member sha 대조만 생략). 같은 값 → 같은 파라미터.
 */
export function versionBoundResolver(events: readonly LedgerEventEnvelope[]): ProjectorParamsResolver {
  const sets = new Map<string, PolicyMembers>();
  for (const e of events) {
    if (e.type === 'policy.switched') {
      const p = PolicySwitchedV1.parse(e.payload);
      sets.set(p.policy_version, p.members);
    }
  }
  const cache = new Map<string, ProjectorParams>();
  const load = <S extends z.ZodType>(ps: string, members: PolicyMembers, member: string, schema: S): z.output<S> => {
    const ref = members[member]?.version;
    const m = ref === undefined ? null : /^([a-z][a-z0-9_]{2,40})@v(\d+)$/.exec(ref);
    if (m?.[1] === undefined || m[2] === undefined) {
      throw new Error(`golden: ${ps} has no ${member} member`);
    }
    const loaded = loadPolicy(m[1], Number(m[2]), { policyDir: POLICY_DIR, schema });
    if (!loaded.ok) {
      throw new Error(`golden: ${loaded.error.ref}: ${loaded.error.reason}`);
    }
    return loaded.value.value;
  };
  return {
    resolve(_db, ps) {
      const hit = cache.get(ps);
      if (hit !== undefined) {
        return hit;
      }
      const members = sets.get(ps);
      if (members === undefined) {
        throw new Error(`golden: policy set ${ps} is not in the ledger`);
      }
      const built = buildProjectorParams(
        ps,
        load(ps, members, 'fsrs_params', FsrsParamsV1),
        load(ps, members, 'mastery_rules', MasteryRulesV1),
      );
      cache.set(ps, built);
      return built;
    },
    register() {
      // 원장의 policy.switched는 생성 시 한 번에 수집했다.
    },
  };
}

export type SetComputed = SetExpected & { readonly projection: ReturnType<typeof replayFold>['slice'] };

export async function computeSet(
  events: readonly LedgerEventEnvelope[],
  ledgerSha: string,
  resolver: ProjectorParamsResolver,
  db?: SqlitePort,
): Promise<SetComputed> {
  const own = db === undefined;
  const fallback = db ?? (await openMigratedMemoryDb());
  try {
    const ledger = new MemoryLedger();
    for (const e of events) {
      ledger.append(e);
    }
    const { slice, event_count: count } = replayFold(fallback, ledger, resolver);
    return {
      ledger_sha256: ledgerSha,
      event_count: count,
      cards: Object.keys(slice.cards).length,
      concepts: Object.keys(slice.concepts).length,
      projection_hash: projectionHashFromSlice(slice, fallback),
      projection: slice,
    };
  } finally {
    if (own) {
      fallback.close();
    }
  }
}

export function miniLedgerSha(events: readonly LedgerEventEnvelope[]): string {
  return sha256Hex(canonicalJson(events));
}

export function readExpected(): ExpectedFile {
  return ExpectedFile.parse(parseJsonStrict(readFileSync(EXPECTED_FILE, 'utf8')));
}

export function writeExpected(file: ExpectedFile): void {
  writeFileSync(EXPECTED_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

/** 계산 가능한 모든 세트(mini + 존재하는 골든 원장 3종)의 결과. */
export async function computeAllSets(): Promise<Record<string, SetExpected>> {
  const out: Record<string, SetExpected> = {};
  const mini = buildMiniLedger();
  const { projection: _p, ...miniResult } = await computeSet(
    mini,
    miniLedgerSha(mini),
    goldenResolver(mini, { [REPO_PS]: REPO_MEMBERS }),
  );
  out.mini = miniResult;
  for (const name of GOLDEN_SET_NAMES) {
    const g = readGoldenLedger(name);
    if (g === null) {
      continue;
    }
    const { projection: _q, ...r } = await computeSet(g.events, g.sha256, versionBoundResolver(g.events));
    out[name] = r;
  }
  return out;
}
