import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { FeasibilityBlocker } from '../../../src/common/practice.js';
import {
  AssessmentInventory,
  type FeasibilityTransition,
  structuralFeasibility,
} from '../../../src/pack/feasibility.js';
import { MasteryRulesV1 } from '../../../src/policy/mastery_rules.js';
import { FORMATS_OK, invConcept, inventory, LEVEL_KEYS, perMode } from './inventory.js';

type Policy = z.infer<typeof MasteryRulesV1>;
type Inv = z.infer<typeof AssessmentInventory>;

const rawRules = {
  version: 'mastery_rules@v1',
  epsilon: 1e-9,
  elo: {
    alpha: 0.4,
    b: 1,
    guess_correction: true,
    unqualified_ceiling: 0,
    theta_q: { w_format_min: 0.5, w_grader_min: 0.5 },
  },
  theta_shrink: { theta_prior: -0.5, theta_shrink_n0: 10, theta_display_min_events: 30 },
  mastery: {
    p_min: 0.85,
    formats_min: 3,
    distinct_days_min: 2,
    format_counts: { w_format_min: 0.4, w_grader_min: 0.5 },
  },
  w_grader: {
    D: 1,
    J_calibrated: 0.9,
    J_uncalibrated: 0.5,
    J_low_confidence: 0.3,
    LJ: 0.6,
    H: 0.4,
    S: 0.3,
    PENDING: 0,
  },
  promotion: { empty_level: 'skip', required_mastered: { all_if_n_le: 3, ratio: 0.85, allow_misses: 1 } },
  sparse: { depth_scope: 'track' },
  d4: { floor_mode: 'min_with_possible', possible_scope: 'level_le_k' },
  assessment: {
    items: 12,
    formats_min: 4,
    selection: 'round_robin_by_format',
    engines: ['deterministic', 'calibrated_jev_if_sp1_pass'],
    accuracy_min_correct: { '1': 7, '2': 8, '3': 9, '4': 10 },
    cbm_denominator: 'chosen_confidence_max',
    cbm_min: { '1': 0.1, '2': 0.2, '3': 0.3, '4': 0.4 },
    retry_days: 7,
  },
  ai_profiles: Object.fromEntries(
    ['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE'].map((m) => [
      m,
      { rubric_engine: { sp1_pass: 'J', sp1_fail: 'S_provisional' }, provisional_if_self_only: false },
    ]),
  ),
};
const rules = (): Policy => MasteryRulesV1.parse(rawRules);
const inv = (over: Partial<ReturnType<typeof inventory>> = {}): Inv => AssessmentInventory.parse(inventory(over));
const tr = (from: 1 | 2 | 3 | 4, track = 'k8s'): FeasibilityTransition => ({
  track: track as FeasibilityTransition['track'],
  from,
  to: (from + 1) as FeasibilityTransition['to'],
});
const poolWith = (level: string, items: number, formats: string[]) => ({
  ...Object.fromEntries(LEVEL_KEYS.map((k) => [k, perMode({ items: 12, formats: [...FORMATS_OK] })])),
  [level]: perMode({ items, formats }),
});
const codes = (r: { blockers: { code: string }[] }): string[] => r.blockers.map((b) => b.code);

describe('pack/feasibility.ts structuralFeasibility (SP-6 이식)', () => {
  it('UT-CON-004 structuralFeasibility: 같은 입력 2회 toStrictEqual, 평가 풀 items 11(나머지 충족) → blockers = [NO_ASSESSMENT_POOL] [FR-CUR-025]', () => {
    const policy = rules();
    const ok = inv();
    const a = structuralFeasibility(policy, ok, tr(1), 'OFFLINE', 'unknown');
    const b = structuralFeasibility(policy, ok, tr(1), 'OFFLINE', 'unknown');
    expect(a).toStrictEqual(b);
    expect(a).toStrictEqual({ feasible: true, blockers: [] });

    const thin = inv({ assessment_pool: poolWith('1', 11, [...FORMATS_OK]) });
    const snapshot = structuredClone(thin);
    const r1 = structuralFeasibility(policy, thin, tr(1), 'FULL', 'pass');
    const r2 = structuralFeasibility(policy, thin, tr(1), 'FULL', 'pass');
    expect(r1).toStrictEqual(r2);
    expect(r1.feasible).toBe(false);
    expect(r1.blockers).toStrictEqual([
      { code: 'NO_ASSESSMENT_POOL', detail_ko: 'L1 FULL 승급 평가 풀 부족: 문항 11/12, 형식 4/4' },
    ]);
    expect(thin).toStrictEqual(snapshot); // 입력 불변(순수 함수)
    // 형식 종류가 부족(3종)해도 같은 code, 중복 형식은 한 번만 센다
    const fewFormats = inv({ assessment_pool: poolWith('1', 12, ['mcq', 'mcq', 'ox', 'cloze']) });
    expect(codes(structuralFeasibility(policy, fewFormats, tr(1), 'OFFLINE', 'fail'))).toEqual(['NO_ASSESSMENT_POOL']);
    // 다른 모드의 풀 부족은 이 모드에 영향이 없다
    const modePool = { ...ok.assessment_pool, 1: { ...ok.assessment_pool['1'], LLM_ONLY: { items: 0, formats: [] } } };
    const modeInv = AssessmentInventory.parse({ ...ok, assessment_pool: modePool });
    expect(structuralFeasibility(policy, modeInv, tr(1), 'OFFLINE', 'unknown').feasible).toBe(true);
    expect(structuralFeasibility(policy, modeInv, tr(1), 'LLM_ONLY', 'unknown').feasible).toBe(false);
  });

  it('UT-CON-124 빈 레벨: empty_level skip → feasible·blockers 0, block → EMPTY_LEVEL 1개 [FR-CUR-025][FR-PRG-013]', () => {
    const base = rules();
    const emptyAt3 = inv(); // 개념은 모두 레벨 1
    expect(structuralFeasibility(base, emptyAt3, tr(3), 'OFFLINE', 'unknown')).toStrictEqual({
      feasible: true,
      blockers: [],
    });
    const block: Policy = { ...base, promotion: { ...base.promotion, empty_level: 'block' } };
    const r = structuralFeasibility(block, emptyAt3, tr(3), 'OFFLINE', 'unknown');
    expect(r).toStrictEqual({ feasible: false, blockers: [{ code: 'EMPTY_LEVEL', detail_ko: 'L3 개념 0개' }] });
    // 빈 레벨이면 평가 풀이 비어 있어도 다른 blocker를 내지 않는다(즉시 반환)
    const emptyPool = inv({ assessment_pool: poolWith('3', 0, []) });
    expect(codes(structuralFeasibility(block, emptyPool, tr(3), 'FULL', 'pass'))).toEqual(['EMPTY_LEVEL']);
    expect(structuralFeasibility(base, emptyPool, tr(3), 'FULL', 'pass').blockers).toEqual([]);
  });

  it('UT-CON-125 필수 3개 중 1개 형식 2종 → MASTERY_FORMATS<3:<id> 1개(code가 FeasibilityBlocker 통과), 필수 2개(희소) → 형식 blocker 0, 순서 = concept_id 오름차순 [FR-PRG-009]', () => {
    const policy = rules();
    const three = inv({
      concepts: [invConcept('k8s.a', 1), invConcept('k8s.b', 1, {}, ['mcq', 'ox']), invConcept('k8s.c', 1)],
    });
    const r = structuralFeasibility(policy, three, tr(1), 'OFFLINE', 'unknown');
    expect(r.feasible).toBe(false);
    expect(r.blockers).toStrictEqual([{ code: 'MASTERY_FORMATS<3:k8s.b', detail_ko: 'k8s.b 숙달 산입 형식 2/3' }]);
    for (const b of r.blockers) {
      expect(FeasibilityBlocker.safeParse(b).success).toBe(true);
    }

    // 희소 레벨(필수 2개 < 3): 개념별 형식 검사를 하지 않는다
    const sparse = inv({ concepts: [invConcept('k8s.a', 1), invConcept('k8s.b', 1, {}, ['mcq'])] });
    expect(structuralFeasibility(policy, sparse, tr(1), 'OFFLINE', 'unknown')).toStrictEqual({
      feasible: true,
      blockers: [],
    });

    // 순서 = concept_id 오름차순(입력 순서와 무관)
    const unordered = inv({
      concepts: [
        invConcept('k8s.z', 1, {}, ['mcq']),
        invConcept('k8s.m', 1),
        invConcept('k8s.a', 1, {}, ['mcq', 'mcq']),
        invConcept('k8s.k', 1),
      ],
    });
    const ordered = structuralFeasibility(policy, unordered, tr(1), 'OFFLINE', 'unknown');
    expect(codes(ordered)).toEqual(['MASTERY_FORMATS<3:k8s.a', 'MASTERY_FORMATS<3:k8s.z']);
    // 필수가 아닌 개념(required_for_level null)은 세지 않는다
    const withOptional = inv({
      concepts: [
        invConcept('k8s.a', 1),
        invConcept('k8s.b', 1),
        invConcept('k8s.c', 1),
        invConcept('k8s.d', 1, { required_for_level: null }, ['mcq']),
      ],
    });
    expect(structuralFeasibility(policy, withOptional, tr(1), 'OFFLINE', 'unknown').feasible).toBe(true);
    // formats_min은 정책 값을 따른다
    const strict: Policy = { ...policy, mastery: { ...policy.mastery, formats_min: 4 } };
    const four = structuralFeasibility(strict, three, tr(1), 'OFFLINE', 'unknown');
    expect(codes(four)).toEqual(['MASTERY_FORMATS<3:k8s.a', 'MASTERY_FORMATS<3:k8s.b', 'MASTERY_FORMATS<3:k8s.c']);
  });

  it('UT-CON-126 k=2 D4: possible 1 + min_with_possible → 통과, fixed → D4_POSSIBLE<REQUIRED, possible_scope 두 값 차이 [FR-PRG-013]', () => {
    const base = rules();
    const l2 = (extra: ReturnType<typeof invConcept>[]) =>
      inv({
        concepts: [
          invConcept('k8s.a', 2, { d4_possible: true }),
          invConcept('k8s.b', 2),
          invConcept('k8s.c', 2),
          ...extra,
        ],
      });
    const one = l2([]);
    const minWith: Policy = { ...base, d4: { floor_mode: 'min_with_possible', possible_scope: 'level_le_k' } };
    expect(structuralFeasibility(minWith, one, tr(2), 'OFFLINE', 'unknown')).toStrictEqual({
      feasible: true,
      blockers: [],
    });
    const fixed: Policy = { ...base, d4: { floor_mode: 'fixed', possible_scope: 'level_le_k' } };
    const r = structuralFeasibility(fixed, one, tr(2), 'OFFLINE', 'unknown');
    expect(r.blockers).toStrictEqual([{ code: 'D4_POSSIBLE<REQUIRED', detail_ko: 'D4 가능 개념 1 < 필요 2' }]);
    expect(FeasibilityBlocker.safeParse(r.blockers[0]).success).toBe(true);
    // 0개일 때도 fixed는 하한 2를 요구한다
    const none = inv({ concepts: [invConcept('k8s.a', 2), invConcept('k8s.b', 2), invConcept('k8s.c', 2)] });
    expect(structuralFeasibility(fixed, none, tr(2), 'OFFLINE', 'unknown').blockers[0]?.detail_ko).toBe(
      'D4 가능 개념 0 < 필요 2',
    );
    expect(structuralFeasibility(minWith, none, tr(2), 'OFFLINE', 'unknown').feasible).toBe(true);

    // possible_scope: level_le_k는 레벨 3 개념을 세지 않고, all은 센다
    const withL3 = l2([invConcept('k8s.d', 3, { d4_possible: true })]);
    const scopeLe: Policy = { ...base, d4: { floor_mode: 'fixed', possible_scope: 'level_le_k' } };
    const scopeAll: Policy = { ...base, d4: { floor_mode: 'fixed', possible_scope: 'all' } };
    expect(codes(structuralFeasibility(scopeLe, withL3, tr(2), 'OFFLINE', 'unknown'))).toEqual([
      'D4_POSSIBLE<REQUIRED',
    ]);
    expect(structuralFeasibility(scopeAll, withL3, tr(2), 'OFFLINE', 'unknown').feasible).toBe(true);
    // k ≠ 2에서는 D4 검사를 하지 않는다
    const l1 = inv();
    expect(structuralFeasibility(fixed, l1, tr(1), 'OFFLINE', 'unknown').feasible).toBe(true);
  });

  it('UT-CON-127 k=4 L4+ Case 1개 → CASE_L4+<2, k=3 Case 0개 → Case blocker 0, track 불일치·to ≠ from+1 → RangeError [FR-PRG-013]', () => {
    const policy = rules();
    const l4 = (cases: ReturnType<typeof inventory>['cases']) =>
      inv({ concepts: [invConcept('k8s.a', 4), invConcept('k8s.b', 4), invConcept('k8s.c', 4)], cases });
    const caseOf = (id: string, level: number) => ({ case_id: `k8s.case.${id}`, level, tracks: ['k8s'] });
    const one = structuralFeasibility(policy, l4([caseOf('aa', 4), caseOf('bb', 3)]), tr(4), 'OFFLINE', 'unknown');
    expect(one.blockers).toStrictEqual([{ code: 'CASE_L4+<2', detail_ko: 'L4+ Case 1/2' }]);
    expect(FeasibilityBlocker.safeParse(one.blockers[0]).success).toBe(true);
    const two = structuralFeasibility(policy, l4([caseOf('aa', 4), caseOf('bb', 5)]), tr(4), 'OFFLINE', 'unknown');
    expect(two).toStrictEqual({ feasible: true, blockers: [] });
    expect(codes(structuralFeasibility(policy, l4([]), tr(4), 'OFFLINE', 'unknown'))).toEqual(['CASE_L4+<2']);

    const l3 = inv({ concepts: [invConcept('k8s.a', 3), invConcept('k8s.b', 3), invConcept('k8s.c', 3)], cases: [] });
    expect(structuralFeasibility(policy, l3, tr(3), 'OFFLINE', 'unknown')).toStrictEqual({
      feasible: true,
      blockers: [],
    });

    // 입력 계약 위반은 RangeError
    const base = inv();
    expect(() => structuralFeasibility(policy, base, tr(1, 'net'), 'OFFLINE', 'unknown')).toThrow(RangeError);
    const skip: FeasibilityTransition = { track: 'k8s', from: 2, to: 4 };
    expect(() => structuralFeasibility(policy, base, skip, 'OFFLINE', 'unknown')).toThrow(RangeError);
    expect(() => structuralFeasibility(policy, base, skip, 'OFFLINE', 'unknown')).toThrow(
      'structuralFeasibility: invalid transition',
    );
    const same: FeasibilityTransition = { track: 'k8s', from: 3, to: 3 as 4 };
    expect(() => structuralFeasibility(policy, base, same, 'OFFLINE', 'unknown')).toThrow(RangeError);
  });
});
