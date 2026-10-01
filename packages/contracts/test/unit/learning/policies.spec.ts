import { describe, expect, it } from 'vitest';
import { FormatId } from '../../../src/common/domain.js';
import { CbmParamsV1 } from '../../../src/policy/cbm_params.js';
import { ComposerPolicyV1 } from '../../../src/policy/composer_policy.js';
import { FsrsParamsV1 } from '../../../src/policy/fsrs_params.js';
import { GamingParamsV1 } from '../../../src/policy/gaming_params.js';
import { LdiParamsV1 } from '../../../src/policy/ldi_params.js';
import {
  FormatPolicy,
  LevelMix,
  MethodFormats,
  MethodPolicyV1,
  RouterCell,
  TabooRule,
} from '../../../src/policy/method_policy.js';
import { withFields } from './samples.js';

const FORMATS = FormatId.options;
const formatPolicy = {
  w_format: 0.5,
  grade_class: 'D',
  response_mode: 'recognition',
  n_options: { min: 2, max: 4 },
  credit_eligible: true,
  runner: false,
  tiers: ['A', 'B'],
};
const formats = (): Record<string, unknown> => Object.fromEntries(FORMATS.map((f) => [f, formatPolicy]));
const cell = { formats: ['mcq', 'ox'], bloom: null, scaffolding: 'full', digging_depth_max: null };
const bloom = { remember: 0.2, understand: 0.3, apply: 0.2, analyze: 0.1, evaluate: 0.1, create: 0.1 };
const router = (): Record<string, Record<string, unknown>> =>
  Object.fromEntries(
    ['D', 'C', 'P', 'S', 'M'].map((r) => [r, Object.fromEntries(['1', '2', '3', '4', '5'].map((l) => [l, cell]))]),
  );
const shares = { code: 0.2, retrieval: 0.3, implement: 0.2, blank_note: 0.1, digging: 0.1, case: 0.1 };
const levelMix = () => ({
  groups: Object.fromEntries(
    ['code', 'retrieval', 'implement', 'blank_note', 'digging', 'case'].map((g) => [g, ['M-01']]),
  ),
  shares: Object.fromEntries(['1', '2', '3', '4', '5'].map((l) => [l, shares])),
  tolerance: 0.1,
});
const taboo = [
  {
    id: 'TB-01',
    levels: [4, 5],
    knowledge_types: [],
    effect: { kind: 'exclude_formats', formats: ['ox'] },
    reason_ko: '고급 레벨에는 OX를 쓰지 않는다',
  },
  {
    id: 'TB-02',
    levels: [1],
    knowledge_types: ['D'],
    effect: { kind: 'max_share', formats: ['mcq'], share_max: 0.5 },
    reason_ko: '객관식 편중 방지',
  },
  {
    id: 'TB-03',
    levels: [1, 2],
    knowledge_types: ['C', 'P'],
    effect: { kind: 'digging_depth_max', depth: 3 },
    reason_ko: '초급 디깅 깊이 제한',
  },
  {
    id: 'TB-04',
    levels: [3],
    knowledge_types: ['S'],
    effect: { kind: 'evidence_weight', formats: ['essay'], w: 0.5 },
    reason_ko: '자기 보고 증거 가중 제한',
  },
];
const methodPolicy = () => ({
  version: 'method_policy@v1',
  router_25: router(),
  taboo,
  level_mix: levelMix(),
  formats: formats(),
});

const hc = {
  'HC-01': { same_mode_consecutive_max: 2 },
  'HC-02': { min_session_minutes: 15, modes_min: 3, short_template_slots: ['W', 'R', 'C'] },
  'HC-03': { min_session_minutes: 25, constructive_interactive_share_min: 0.6 },
  'HC-04': { requeue_within_h: 24 },
  'HC-05': { new_blocked: true, review_interleaved: true },
  'HC-06': { boss_per_session_max: 1, last_graded_p_min: 0.8 },
  'HC-07': { first_item_ms_max: 2000 },
  'HC-08': { practice_p_min: 0.7, practice_p_max: 0.85, boss_p: 0.5 },
  'HC-09': { budget_overrun_max: 1.1 },
  'HC-10': { min_level: 4, worked_parsons_share_max: 0.05 },
  'HC-11': { variant_recent_exclude: 5 },
};
const composer = () => ({
  version: 'composer_policy@v1',
  score_weights: {
    utility: 0.3,
    urgency: 0.25,
    goal: 0.15,
    novelty: 0.1,
    preference: 0.1,
    fatigue: 0.05,
    switch_cost: 0.05,
    mix_delta: 0.1,
    softmax: { top_k: 3, tau: 0.3 },
  },
  hard_constraints: hc,
  entropy: {
    h_min_formula: 'min(h_cap, coef * log2(min(k, B)))',
    h_cap: 2.3,
    coef: 1,
    window_days: 7,
    single_mode_share_max: 0.4,
    freshness_boost: 2,
    weekly_quota: { digging: 1, lab: 1, blank_note: 1 },
    suggest_only_min_level: 4,
  },
  boss: { min_session_minutes: 25, level_offset: 1, target_p: 0.5, evidence_weight_factor: 0.5 },
  peak_end: { wave: { W: 0.95, R: 0.85, N: 0.75, D: 0.6, S: 0.5, C: 0.95 } },
  wildcard: {
    per_week_min: 1,
    constraints: ['diagram_only', 'one_sentence', 'no_jargon', 'explain_to_pm'],
    suggest_only_min_level: 3,
  },
});
const ldi = () => ({
  version: 'ldi_params@v1',
  provisional: true,
  retention_weights: { core: 1, standard: 0.7, breadth: 0.4, archive: 0.2, retired: 0 },
  depth_by_level: { L0: 0, L1: 1, L2: 2, L3: 3, L4: 5, L5: 8 },
  retrievability: { recognition_factor: 0.8 },
  evidence: { grader_weight: 0.5, formats_weight: 0.5, formats_target: 3 },
  validity: { valid: 1, cl_x: 0.5, deprecated: 0 },
  provisional_factor: 0.8,
});
const tMin = { floor_ms: 1200, base_ms: 400, chars_per_s: 25 };
const gaming = () => ({
  version: 'gaming_params@v1',
  t_min_ms_by_format: Object.fromEntries(FORMATS.map((f) => [f, tMin])),
  personalize_after: { responses: 30, quantile: 0.05 },
  rapid: { w: 0, grade_cap: 2 },
  hint_penalty: { factor_per_step: 0.15 },
});
const cbm = () => ({ version: 'cbm_params@v1', score: { correct: [1, 2, 3], wrong: [0, -2, -6] } });
// ts-fsrs 5.4.2 default_w(FSRS-6, 21개) — contracts는 ts-fsrs를 의존하지 않으므로 값을 리터럴로 둔다.
const DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
const fsrs = () => ({
  version: 'fsrs_params@v1',
  impl: 'ts-fsrs@5.4.2',
  w: DEFAULT_W,
  enable_fuzz: false,
  enable_short_term: true,
  request_retention: { A: 0.9, B: 0.9, C: 0.85 },
  forecast: { window_days: 30, band: { min_history_windows: 8, default_pct: 0.15 }, governor: 'lower_bound' },
});

describe('learning 정책 zod 6종(method·composer·ldi·gaming·cbm·fsrs)', () => {
  it('UT-CON-195 MethodFormats 33키 통과·32키 거부·미지 키 거부·FormatPolicy.tiers [] 거부 [FR-CUR-017][CR-36]', () => {
    expect(FORMATS).toHaveLength(33);
    expect(MethodFormats.safeParse(formats()).success).toBe(true);
    const thirtyTwo = formats();
    delete thirtyTwo.parsons;
    expect(Object.keys(thirtyTwo)).toHaveLength(32);
    expect(MethodFormats.safeParse(thirtyTwo).success).toBe(false);
    expect(MethodFormats.safeParse({ ...formats(), foo: formatPolicy }).success).toBe(false);
    expect(FormatPolicy.safeParse(formatPolicy).success).toBe(true);
    expect(FormatPolicy.safeParse({ ...formatPolicy, tiers: [] }).success).toBe(false);
    expect(FormatPolicy.safeParse({ ...formatPolicy, extra: 1 }).success).toBe(false);
    expect(FormatPolicy.safeParse({ ...formatPolicy, w_format: 1.1 }).success).toBe(false);
    expect(FormatPolicy.safeParse({ ...formatPolicy, grade_class: 'X' }).success).toBe(false);
    expect(FormatPolicy.safeParse({ ...formatPolicy, n_options: { min: -1, max: 4 } }).success).toBe(false);
    expect(FormatPolicy.safeParse({ ...formatPolicy, tiers: ['D'] }).success).toBe(false);
    expect(MethodFormats.safeParse({ ...formats(), ox: { ...formatPolicy, w_format: -0.1 } }).success).toBe(false);
  });

  it('UT-CON-196 MethodPolicyV1 router_25 25칸 통과·M 행 누락 거부·bloom 합 0.9 거부·taboo 4 effect·id 중복 거부·level_mix 합 ≠ 1 거부 [FR-STD-007][FR-STD-008]', () => {
    expect(MethodPolicyV1.safeParse(methodPolicy()).success).toBe(true);
    expect(MethodPolicyV1.safeParse({ ...methodPolicy(), extra: 1 }).success).toBe(false);
    expect(MethodPolicyV1.safeParse(withFields(methodPolicy(), { version: 'method_policy@v2' })).success).toBe(false);
    const noM = router();
    delete noM.M;
    expect(MethodPolicyV1.safeParse(withFields(methodPolicy(), { router_25: noM })).success).toBe(false);
    const noLevel = router();
    delete noLevel.D?.['5'];
    expect(MethodPolicyV1.safeParse(withFields(methodPolicy(), { router_25: noLevel })).success).toBe(false);

    // 칸: bloom 합 1·형식 중복 0·깊이 1~7
    expect(RouterCell.safeParse({ ...cell, bloom }).success).toBe(true);
    expect(RouterCell.safeParse({ ...cell, bloom: { ...bloom, remember: 0.1 } }).success).toBe(false); // 합 0.9
    expect(RouterCell.safeParse({ ...cell, bloom: { ...bloom, create: 0.2 } }).success).toBe(false); // 합 1.1
    const { create: _c, ...fiveBloom } = bloom;
    expect(RouterCell.safeParse({ ...cell, bloom: fiveBloom }).success).toBe(false); // Bloom 6수준 전수
    expect(RouterCell.safeParse({ ...cell, formats: ['ox', 'ox'] }).success).toBe(false);
    expect(RouterCell.safeParse({ ...cell, formats: FORMATS.slice(0, 13) }).success).toBe(false);
    expect(RouterCell.safeParse({ ...cell, digging_depth_max: 7 }).success).toBe(true);
    expect(RouterCell.safeParse({ ...cell, digging_depth_max: 8 }).success).toBe(false);
    expect(RouterCell.safeParse({ ...cell, scaffolding: 'heavy' }).success).toBe(false);
    expect(
      MethodPolicyV1.safeParse(
        withFields(methodPolicy(), {
          router_25: Object.fromEntries(
            Object.entries(router()).map(([r, row]) => [
              r,
              { ...row, '1': { ...cell, bloom: { ...bloom, remember: 0.1 } } },
            ]),
          ),
        }),
      ).success,
    ).toBe(false);

    // taboo: 4 effect 종류 각각 통과, id 중복·형식 위반 거부
    expect(TabooRule.shape.effect.options).toHaveLength(4);
    for (const t of taboo) {
      expect(TabooRule.safeParse(t).success, t.id).toBe(true);
      expect(TabooRule.safeParse({ ...t, extra: 1 }).success, `${t.id} extra`).toBe(false);
    }
    expect(TabooRule.safeParse({ ...taboo[0], id: 'T-1' }).success).toBe(false);
    expect(TabooRule.safeParse({ ...taboo[0], levels: [] }).success).toBe(false);
    expect(TabooRule.safeParse({ ...taboo[0], reason_ko: '' }).success).toBe(false);
    expect(TabooRule.safeParse({ ...taboo[0], effect: { kind: 'ban' } }).success).toBe(false);
    expect(TabooRule.safeParse({ ...taboo[2], effect: { kind: 'digging_depth_max', depth: 8 } }).success).toBe(false);
    expect(
      TabooRule.safeParse({ ...taboo[1], effect: { kind: 'max_share', formats: ['mcq'], share_max: 1.5 } }).success,
    ).toBe(false);
    expect(
      MethodPolicyV1.safeParse(withFields(methodPolicy(), { taboo: [taboo[0], { ...taboo[1], id: 'TB-01' }] })).success,
    ).toBe(false);
    expect(MethodPolicyV1.safeParse(withFields(methodPolicy(), { taboo: [] })).success).toBe(true);
    expect(
      MethodPolicyV1.safeParse(
        withFields(methodPolicy(), {
          taboo: Array.from({ length: 41 }, (_, i) => ({ ...taboo[0], id: `TB-${String(i).padStart(2, '0')}` })),
        }),
      ).success,
    ).toBe(false);

    // level_mix: 레벨마다 합 1
    expect(LevelMix.safeParse(levelMix()).success).toBe(true);
    const badShares = levelMix();
    badShares.shares['3'] = { ...shares, code: 0.3 }; // 합 1.1
    expect(LevelMix.safeParse(badShares).success).toBe(false);
    expect(MethodPolicyV1.safeParse(withFields(methodPolicy(), { level_mix: badShares })).success).toBe(false);
    const noGroup = levelMix();
    delete (noGroup.groups as Record<string, unknown>).case;
    expect(LevelMix.safeParse(noGroup).success).toBe(false);
    expect(LevelMix.safeParse({ ...levelMix(), tolerance: 1.5 }).success).toBe(false);
    expect(LevelMix.safeParse({ ...levelMix(), groups: { ...levelMix().groups, code: [] } }).success).toBe(false);
    expect(MethodPolicyV1.safeParse(withFields(methodPolicy(), { formats: {} })).success).toBe(false);
  });

  it('UT-CON-197 ComposerPolicyV1 PED §6.3·§6.4 값 통과·HC-08 min > max 거부·peak_end.wave 5슬롯 거부·h_min_formula 다른 문자열 거부 [FR-STD-002][FR-STD-004][FR-STD-009]', () => {
    expect(ComposerPolicyV1.safeParse(composer()).success).toBe(true);
    expect(ComposerPolicyV1.safeParse({ ...composer(), extra: 1 }).success).toBe(false);
    expect(ComposerPolicyV1.safeParse(withFields(composer(), { version: 'composer_policy@v2' })).success).toBe(false);
    // 점수 함수 8항 + softmax
    const sw = composer().score_weights;
    expect(ComposerPolicyV1.safeParse(withFields(composer(), { score_weights: { ...sw, utility: 1.5 } })).success).toBe(
      false,
    );
    expect(
      ComposerPolicyV1.safeParse(withFields(composer(), { score_weights: { ...sw, softmax: { top_k: 3, tau: 0 } } }))
        .success,
    ).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(withFields(composer(), { score_weights: { ...sw, softmax: { top_k: 11, tau: 0.3 } } }))
        .success,
    ).toBe(false);
    const { fatigue: _f, ...sevenTerms } = sw;
    expect(ComposerPolicyV1.safeParse(withFields(composer(), { score_weights: sevenTerms })).success).toBe(false);
    // 하드 제약 11개 전부 필요, HC-08 min ≤ max
    const withHc = (over: Record<string, unknown>) => withFields(composer(), { hard_constraints: { ...hc, ...over } });
    expect(
      ComposerPolicyV1.safeParse(withHc({ 'HC-08': { practice_p_min: 0.9, practice_p_max: 0.85, boss_p: 0.5 } }))
        .success,
    ).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(withHc({ 'HC-08': { practice_p_min: 0.85, practice_p_max: 0.85, boss_p: 0.5 } }))
        .success,
    ).toBe(true);
    expect(ComposerPolicyV1.safeParse(withHc({ 'HC-01': { same_mode_consecutive_max: 6 } })).success).toBe(false);
    expect(ComposerPolicyV1.safeParse(withHc({ 'HC-09': { budget_overrun_max: 0.9 } })).success).toBe(false);
    expect(ComposerPolicyV1.safeParse(withHc({ 'HC-09': { budget_overrun_max: 2.1 } })).success).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(withHc({ 'HC-06': { boss_per_session_max: 4, last_graded_p_min: 0.8 } })).success,
    ).toBe(false);
    expect(ComposerPolicyV1.safeParse(withHc({ 'HC-02': { ...hc['HC-02'], short_template_slots: [] } })).success).toBe(
      false,
    );
    expect(
      ComposerPolicyV1.safeParse(withHc({ 'HC-10': { min_level: 6, worked_parsons_share_max: 0.05 } })).success,
    ).toBe(false);
    const { 'HC-11': _hc11, ...tenHc } = hc;
    expect(ComposerPolicyV1.safeParse(withFields(composer(), { hard_constraints: tenHc })).success).toBe(false);
    // 난이도 파도 = 슬롯 6개 전부
    const wave = composer().peak_end.wave;
    const { C: _c, ...fiveSlots } = wave;
    expect(ComposerPolicyV1.safeParse(withFields(composer(), { peak_end: { wave: fiveSlots } })).success).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(withFields(composer(), { peak_end: { wave: { ...wave, X: 0.5 } } })).success,
    ).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(withFields(composer(), { peak_end: { wave: { ...wave, W: 1.2 } } })).success,
    ).toBe(false);
    // 엔트로피 가드
    const en = composer().entropy;
    expect(
      ComposerPolicyV1.safeParse(
        withFields(composer(), { entropy: { ...en, h_min_formula: 'min(h_cap, coef * log2(k))' } }),
      ).success,
    ).toBe(false);
    expect(ComposerPolicyV1.safeParse(withFields(composer(), { entropy: { ...en, window_days: 29 } })).success).toBe(
      false,
    );
    expect(
      ComposerPolicyV1.safeParse(withFields(composer(), { entropy: { ...en, freshness_boost: 0.5 } })).success,
    ).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(
        withFields(composer(), {
          boss: { min_session_minutes: 25, level_offset: 3, target_p: 0.5, evidence_weight_factor: 0.5 },
        }),
      ).success,
    ).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(
        withFields(composer(), { wildcard: { per_week_min: 1, constraints: [], suggest_only_min_level: 3 } }),
      ).success,
    ).toBe(false);
    expect(
      ComposerPolicyV1.safeParse(
        withFields(composer(), {
          wildcard: { per_week_min: 1, constraints: ['emoji_only'], suggest_only_min_level: 3 },
        }),
      ).success,
    ).toBe(false);
  });

  it('UT-CON-198 LdiParamsV1 부록 A 값 + provisional true 통과·retention_weights.retired 0.1 거부 [FR-DSH-011][NFR-MAINT-012]', () => {
    expect(LdiParamsV1.safeParse(ldi()).success).toBe(true);
    expect(LdiParamsV1.safeParse({ ...ldi(), provisional: false }).success).toBe(true);
    expect(LdiParamsV1.safeParse({ ...ldi(), extra: 1 }).success).toBe(false);
    const rw = ldi().retention_weights;
    expect(LdiParamsV1.safeParse(withFields(ldi(), { retention_weights: { ...rw, retired: 0.1 } })).success).toBe(
      false,
    );
    expect(LdiParamsV1.safeParse(withFields(ldi(), { retention_weights: { ...rw, core: 1.1 } })).success).toBe(false);
    const { archive: _a, ...noArchive } = rw;
    expect(LdiParamsV1.safeParse(withFields(ldi(), { retention_weights: noArchive })).success).toBe(false);
    const d = ldi().depth_by_level;
    expect(LdiParamsV1.safeParse(withFields(ldi(), { depth_by_level: { ...d, L4: -1 } })).success).toBe(false);
    const { L0: _l0, ...noL0 } = d;
    expect(LdiParamsV1.safeParse(withFields(ldi(), { depth_by_level: noL0 })).success).toBe(false);
    expect(LdiParamsV1.safeParse(withFields(ldi(), { retrievability: { recognition_factor: 1.2 } })).success).toBe(
      false,
    );
    expect(
      LdiParamsV1.safeParse(
        withFields(ldi(), { evidence: { grader_weight: 0.5, formats_weight: 0.5, formats_target: 0 } }),
      ).success,
    ).toBe(false);
    expect(LdiParamsV1.safeParse(withFields(ldi(), { validity: { valid: 1, cl_x: 0.5 } })).success).toBe(false);
    expect(LdiParamsV1.safeParse(withFields(ldi(), { provisional_factor: -0.1 })).success).toBe(false);
    const { provisional: _p, ...noFlag } = ldi();
    expect(LdiParamsV1.safeParse(noFlag).success).toBe(false); // 미확정 표시 필드는 필수
  });

  it('UT-CON-199 GamingParamsV1 33형식 {1200,400,25} 통과·32형식 거부·rapid.grade_cap 5 거부 [FR-QST-025]', () => {
    expect(GamingParamsV1.safeParse(gaming()).success).toBe(true);
    expect(GamingParamsV1.safeParse({ ...gaming(), extra: 1 }).success).toBe(false);
    const thirtyTwo = gaming();
    delete thirtyTwo.t_min_ms_by_format.parsons;
    expect(Object.keys(thirtyTwo.t_min_ms_by_format)).toHaveLength(32);
    expect(GamingParamsV1.safeParse(thirtyTwo).success).toBe(false);
    expect(
      GamingParamsV1.safeParse(
        withFields(gaming(), { t_min_ms_by_format: { ...gaming().t_min_ms_by_format, foo: tMin } }),
      ).success,
    ).toBe(false);
    const withT = (f: string, v: unknown) =>
      withFields(gaming(), { t_min_ms_by_format: { ...gaming().t_min_ms_by_format, [f]: v } });
    expect(GamingParamsV1.safeParse(withT('ox', { ...tMin, chars_per_s: 0 })).success).toBe(false);
    expect(GamingParamsV1.safeParse(withT('ox', { ...tMin, floor_ms: -1 })).success).toBe(false);
    expect(GamingParamsV1.safeParse(withT('ox', { ...tMin, floor_ms: 1.5 })).success).toBe(false);
    expect(GamingParamsV1.safeParse(withT('ox', { floor_ms: 1200, base_ms: 400 })).success).toBe(false);
    expect(GamingParamsV1.safeParse(withFields(gaming(), { rapid: { w: 0, grade_cap: 5 } })).success).toBe(false);
    expect(GamingParamsV1.safeParse(withFields(gaming(), { rapid: { w: 0, grade_cap: 0 } })).success).toBe(false);
    expect(GamingParamsV1.safeParse(withFields(gaming(), { rapid: { w: 1.1, grade_cap: 2 } })).success).toBe(false);
    expect(
      GamingParamsV1.safeParse(withFields(gaming(), { personalize_after: { responses: 0, quantile: 0.05 } })).success,
    ).toBe(false);
    expect(GamingParamsV1.safeParse(withFields(gaming(), { hint_penalty: { factor_per_step: 2 } })).success).toBe(
      false,
    );
  });

  it('UT-CON-200 CbmParamsV1 [1,2,3]/[0,-2,-6] 통과·[1,1,3] 거부·wrong [0,2,-6] 거부 [FR-PRG-013]', () => {
    expect(CbmParamsV1.safeParse(cbm()).success).toBe(true);
    expect(CbmParamsV1.safeParse({ ...cbm(), extra: 1 }).success).toBe(false);
    const withScore = (correct: number[], wrong: number[]) => ({ version: 'cbm_params@v1', score: { correct, wrong } });
    expect(CbmParamsV1.safeParse(withScore([1, 1, 3], [0, -2, -6])).success).toBe(false); // 엄격 증가 아님
    expect(CbmParamsV1.safeParse(withScore([0, 2, 3], [0, -2, -6])).success).toBe(false); // 0 초과 아님
    expect(CbmParamsV1.safeParse(withScore([3, 2, 1], [0, -2, -6])).success).toBe(false); // 감소
    expect(CbmParamsV1.safeParse(withScore([1, 2, 3], [0, 2, -6])).success).toBe(false);
    expect(CbmParamsV1.safeParse(withScore([1, 2, 3], [1, -2, -6])).success).toBe(false); // 0 이하 아님
    expect(CbmParamsV1.safeParse(withScore([1, 2, 3], [0, -6, -2])).success).toBe(false); // 비증가 위반
    expect(CbmParamsV1.safeParse(withScore([1, 2, 3], [-1, -1, -1])).success).toBe(true); // 비증가(같음 허용)
    expect(CbmParamsV1.safeParse(withScore([1, 2], [0, -2, -6])).success).toBe(false); // 튜플 길이 3
    expect(CbmParamsV1.safeParse(withScore([1, 2, 3], [0, -2, -6, -9])).success).toBe(false);
  });

  it('UT-CON-201 FsrsParamsV1 ts-fsrs 5.4.2 default_w 21개 통과·20개 거부·enable_fuzz true 거부·request_retention.A 0.98 거부 [FR-PRG-005][FR-PRG-018]', () => {
    expect(DEFAULT_W).toHaveLength(21);
    expect(FsrsParamsV1.safeParse(fsrs()).success).toBe(true);
    expect(FsrsParamsV1.safeParse({ ...fsrs(), extra: 1 }).success).toBe(false);
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { w: DEFAULT_W.slice(0, 20) })).success).toBe(false);
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { w: [...DEFAULT_W, 0.1] })).success).toBe(false);
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { enable_fuzz: true })).success).toBe(false); // SP-3 구속
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { impl: 'ts-fsrs@5.4.1' })).success).toBe(false);
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { enable_short_term: false })).success).toBe(true);
    const rr = fsrs().request_retention;
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { request_retention: { ...rr, A: 0.98 } })).success).toBe(false);
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { request_retention: { ...rr, B: 0.69 } })).success).toBe(false);
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { request_retention: { ...rr, C: 0.97 } })).success).toBe(true);
    const f = fsrs().forecast;
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { forecast: { ...f, window_days: 14 } })).success).toBe(false);
    expect(FsrsParamsV1.safeParse(withFields(fsrs(), { forecast: { ...f, governor: 'mean' } })).success).toBe(false);
    expect(
      FsrsParamsV1.safeParse(
        withFields(fsrs(), { forecast: { ...f, band: { min_history_windows: 0, default_pct: 0.15 } } }),
      ).success,
    ).toBe(false);
  });
});
