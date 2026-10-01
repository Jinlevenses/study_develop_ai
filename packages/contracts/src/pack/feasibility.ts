// ported-from: spikes/sp6-promotion-reachability/src/promotion.ts
import { z } from 'zod';
import { AiMode, FormatId, Level, type Sp1State, Tier } from '../common/domain.js';
import { CaseId, ConceptId, TrackId } from '../common/ids.js';
import type { FeasibilityBlocker } from '../common/practice.js';
import { S } from '../common/schema.js';
import type { MasteryRulesV1 } from '../policy/mastery_rules.js';

export const AssessmentInventory = S({
  // 트랙 1개분 — IF-CT-007 'inventory' 줄
  track: TrackId,
  concepts: z
    .array(
      S({
        concept_id: ConceptId,
        level: Level,
        tier: Tier,
        required_for_level: Level.nullable(),
        d4_possible: z.boolean(),
        formats_by_mode: z.record(AiMode, z.array(FormatId)),
      }),
    )
    .max(300),
  assessment_pool: z.record(
    z.enum(['1', '2', '3', '4', '5']),
    z.record(AiMode, S({ items: z.number().int().min(0), formats: z.array(FormatId) })),
  ),
  cases: z.array(S({ case_id: CaseId, level: Level, tracks: z.array(TrackId) })).max(60),
});
export type AssessmentInventory = z.infer<typeof AssessmentInventory>;
export type FeasibilityTransition = { track: z.infer<typeof TrackId>; from: 1 | 2 | 3 | 4; to: 2 | 3 | 4 | 5 };
// 비공개 상수 — FR-PRG-013 계약 수치(MasteryRulesV1에 키가 없다).
const SPARSE_REQUIRED_LT = 3; // FR-PRG-013: 필수 개념 < 3인 희소 레벨은 개념별 형식 검사를 하지 않는다(깊이 자산은 런타임 판정 몫)
const D4_FLOOR = 2; // FR-PRG-013: D4 깊이 개념 하한
const D4_CAP = 5; // FR-PRG-013: D4 깊이 개념 상한
const CASE_L4_MIN = 2; // FR-PRG-013: k = 4 승급에 필요한 L4+ Case 수
const LEVEL_KEY = { 1: '1', 2: '2', 3: '3', 4: '4' } as const; // `as` 단언 대신(STD-TS-12)

type Blocker = z.infer<typeof FeasibilityBlocker>;

// [Brief 결정 D7 · §4.7] SP-6 structuralFeasibility()를 계약 모양으로 재작성한 순수 함수(I/O·시계·난수·전역 상태 0).
export function structuralFeasibility(
  policy: z.infer<typeof MasteryRulesV1>,
  inventory: z.infer<typeof AssessmentInventory>,
  transition: FeasibilityTransition,
  mode: z.infer<typeof AiMode>,
  _sp1: z.infer<typeof Sp1State>,
): { feasible: boolean; blockers: z.infer<typeof FeasibilityBlocker>[] } {
  const k = transition.from;
  if (transition.track !== inventory.track || transition.to !== k + 1) {
    throw new RangeError('structuralFeasibility: invalid transition');
  }
  const blockers: Blocker[] = [];

  // 1. 빈 레벨 — SP-6 F1(empty_level: skip).
  const all = inventory.concepts.filter((c) => c.level === k);
  if (all.length === 0) {
    if (policy.promotion.empty_level === 'skip') {
      return { feasible: true, blockers: [] };
    }
    return { feasible: false, blockers: [{ code: 'EMPTY_LEVEL', detail_ko: `L${k} 개념 0개` }] };
  }

  // 2. 평가 풀(R-POOL) — 레벨 × 모드의 문항 수·서로 다른 형식 수.
  const pool = inventory.assessment_pool[LEVEL_KEY[k]][mode];
  const poolFormats = new Set(pool.formats).size;
  if (pool.items < policy.assessment.items || poolFormats < policy.assessment.formats_min) {
    blockers.push({
      code: 'NO_ASSESSMENT_POOL',
      detail_ko: `L${k} ${mode} 승급 평가 풀 부족: 문항 ${pool.items}/${policy.assessment.items}, 형식 ${poolFormats}/${policy.assessment.formats_min}`,
    });
  }

  // 3. 필수 개념별 숙달 산입 형식 수(희소 레벨은 건너뛴다).
  const required = all
    .filter((c) => c.required_for_level !== null)
    .sort((a, b) => (a.concept_id < b.concept_id ? -1 : a.concept_id > b.concept_id ? 1 : 0));
  if (required.length >= SPARSE_REQUIRED_LT) {
    for (const c of required) {
      const n = new Set(c.formats_by_mode[mode]).size;
      if (n < policy.mastery.formats_min) {
        blockers.push({
          code: `MASTERY_FORMATS<3:${c.concept_id}`,
          detail_ko: `${c.concept_id} 숙달 산입 형식 ${n}/${policy.mastery.formats_min}`,
        });
      }
    }
  }

  // 4. k = 2: D4(디깅) 가능 개념 수 — SP-6 F3 D4 공식.
  if (k === 2) {
    const possible = inventory.concepts.filter(
      (c) => c.d4_possible && (policy.d4.possible_scope !== 'level_le_k' || c.level <= k),
    ).length;
    const need =
      policy.d4.floor_mode === 'min_with_possible'
        ? Math.max(Math.min(D4_FLOOR, possible), Math.min(D4_CAP, possible))
        : Math.max(D4_FLOOR, Math.min(D4_CAP, possible));
    if (possible < need) {
      blockers.push({ code: 'D4_POSSIBLE<REQUIRED', detail_ko: `D4 가능 개념 ${possible} < 필요 ${need}` });
    }
  }

  // 5. k = 4: L4+ Case 수. (k = 3 Case 검사는 계약 code 집합에 없어 생략한다.)
  if (k === 4) {
    const n = inventory.cases.filter((c) => c.level >= 4).length;
    if (n < CASE_L4_MIN) {
      blockers.push({ code: 'CASE_L4+<2', detail_ko: `L4+ Case ${n}/${CASE_L4_MIN}` });
    }
  }

  return { feasible: blockers.length === 0, blockers };
}
