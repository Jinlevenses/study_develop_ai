import { describe, expect, it } from 'vitest';
import { PolicyLock, PolicySetFile } from '../../../src/policy/lock.js';
import { MasteryRulesV1 } from '../../../src/policy/mastery_rules.js';

const SHA = 'a'.repeat(64);
const PS = 'ps_0123456789abcdef';

const masteryRules = (): Record<string, unknown> => ({
  version: 'mastery_rules@v1',
  epsilon: 1e-9,
  elo: {
    alpha: 0.4,
    b: 1,
    guess_correction: true,
    unqualified_ceiling: 0.8,
    theta_q: { w_format_min: 0.5, w_grader_min: 0.5 },
  },
  theta_shrink: { theta_prior: 0, theta_shrink_n0: 5, theta_display_min_events: 3 },
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
  promotion: { empty_level: 'skip', required_mastered: { all_if_n_le: 5, ratio: 0.8, allow_misses: 1 } },
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
      { rubric_engine: { sp1_pass: 'J', sp1_fail: 'S_provisional' }, provisional_if_self_only: m === 'OFFLINE' },
    ]),
  ),
});

describe('policy/lock', () => {
  it("UT-CON-095 PolicyLock은 키 'mastery_rules@v1'을 통과시키고 'Mastery@v1'을 거부한다 [FR-CUR-017]", () => {
    expect(PolicyLock.safeParse({ 'mastery_rules@v1': { sha256: SHA, owner: 'learning' } }).success).toBe(true);
    expect(PolicyLock.safeParse({}).success).toBe(true);
    expect(PolicyLock.safeParse({ 'Mastery@v1': { sha256: SHA, owner: 'learning' } }).success).toBe(false);
    expect(PolicyLock.safeParse({ 'mastery_rules@v1': { sha256: 'xyz', owner: 'learning' } }).success).toBe(false);
    expect(PolicyLock.safeParse({ 'mastery_rules@v1': { sha256: SHA, owner: 'browser' } }).success).toBe(false);
    expect(PolicyLock.safeParse({ 'mastery_rules@v1': { sha256: SHA, owner: 'learning', extra: 1 } }).success).toBe(
      false,
    );
  });

  it('UT-CON-096 PolicySetFile은 policy_version·members·overrides_sha256·created_at을 강제한다 [FR-CUR-017]', () => {
    const file = {
      policy_version: PS,
      members: { mastery_rules: { version: 'mastery_rules@v1', sha256: SHA } },
      overrides_sha256: null,
      created_at: 1_759_000_000_000,
    };
    expect(PolicySetFile.safeParse(file).success).toBe(true);
    expect(PolicySetFile.safeParse({ ...file, overrides_sha256: SHA }).success).toBe(true);
    expect(PolicySetFile.safeParse({ ...file, policy_version: 'ps_xyz' }).success).toBe(false);
    expect(PolicySetFile.safeParse({ ...file, members: { m: { version: 'Bad', sha256: SHA } } }).success).toBe(false);
    expect(PolicySetFile.safeParse({ ...file, created_at: -1 }).success).toBe(false);
    expect(PolicySetFile.safeParse({ ...file, extra: 1 }).success).toBe(false);
    const { overrides_sha256: _o, ...missing } = file;
    expect(PolicySetFile.safeParse(missing).success).toBe(false);
  });
});

describe('policy/mastery_rules', () => {
  it('UT-CON-097 MasteryRulesV1 완전 샘플을 통과시킨다 [FR-CUR-017][NFR-MAINT-007]', () => {
    expect(MasteryRulesV1.safeParse(masteryRules()).success).toBe(true);
    expect(MasteryRulesV1.safeParse({ ...masteryRules(), version: 'mastery_rules@v2' }).success).toBe(false);
  });

  it('UT-CON-098 MasteryRulesV1은 미지 키(최상위·중첩)와 누락을 거부한다 [FR-CUR-017][NFR-MAINT-007]', () => {
    const base = masteryRules();
    expect(MasteryRulesV1.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(MasteryRulesV1.safeParse({ ...base, elo: { ...(base.elo as object), extra: 1 } }).success).toBe(false);
    expect(MasteryRulesV1.safeParse({ ...base, sparse: { depth_scope: 'level', extra: 1 } }).success).toBe(false);
    const { epsilon: _e, ...noEpsilon } = base;
    expect(MasteryRulesV1.safeParse(noEpsilon).success).toBe(false);
    expect(MasteryRulesV1.safeParse({ ...base, sparse: { depth_scope: 'all' } }).success).toBe(false);
    expect(MasteryRulesV1.safeParse({ ...base, d4: { floor_mode: 'max', possible_scope: 'all' } }).success).toBe(false);
    expect(
      MasteryRulesV1.safeParse({
        ...base,
        theta_shrink: { theta_prior: 0, theta_shrink_n0: 5, theta_display_min_events: 1.5 },
      }).success,
    ).toBe(false);
  });

  it('UT-CON-099 MasteryRulesV1은 w_grader.PENDING ≠ 0을 거부하고 zod 4 전수 record(ai_profiles·accuracy_min_correct)를 고정한다 [FR-CUR-017][NFR-MAINT-007]', () => {
    const base = masteryRules();
    const wg = base.w_grader as Record<string, unknown>;
    expect(MasteryRulesV1.safeParse({ ...base, w_grader: { ...wg, PENDING: 0.2 } }).success).toBe(false);
    expect(MasteryRulesV1.safeParse({ ...base, w_grader: { ...wg, PENDING: 1 } }).success).toBe(false);
    expect(MasteryRulesV1.safeParse({ ...base, w_grader: { ...wg, D: 1.5 } }).success).toBe(false);

    const profiles = base.ai_profiles as Record<string, unknown>;
    const { OFFLINE: _off, ...threeModes } = profiles;
    expect(MasteryRulesV1.safeParse({ ...base, ai_profiles: threeModes }).success).toBe(false); // 4모드 전수
    expect(MasteryRulesV1.safeParse({ ...base, ai_profiles: { ...profiles, ONLINE: profiles.FULL } }).success).toBe(
      false,
    );

    const assessment = base.assessment as Record<string, unknown>;
    expect(
      MasteryRulesV1.safeParse({
        ...base,
        assessment: { ...assessment, accuracy_min_correct: { '1': 7, '2': 8, '3': 9 } },
      }).success,
    ).toBe(false);
    expect(MasteryRulesV1.safeParse({ ...base, assessment: { ...assessment, cbm_min: { '1': 0.1 } } }).success).toBe(
      false,
    );
    expect(MasteryRulesV1.safeParse({ ...base, assessment: { ...assessment, selection: 'random' } }).success).toBe(
      false,
    );
  });
});
