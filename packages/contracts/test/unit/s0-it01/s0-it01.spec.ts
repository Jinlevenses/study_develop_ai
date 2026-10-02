import { describe, expect, it } from 'vitest';
import { HomeAlert } from '../../../src/http/learning/v1/insight.js';
import { ComposerPolicyV1 } from '../../../src/policy/composer_policy.js';

// T-01-01 §4.3 — CR-52(path_weights, additive) · CR-73(HomeAlert.action.href 프로토콜 상대 URL 거부).

const hc = {
  'HC-01': { same_mode_consecutive_max: 2 },
  'HC-02': { min_session_minutes: 10, modes_min: 2, short_template_slots: ['W', 'R', 'C'] },
  'HC-03': { min_session_minutes: 25, constructive_interactive_share_min: 0.4 },
  'HC-04': { requeue_within_h: 24 },
  'HC-05': { new_blocked: true, review_interleaved: true },
  'HC-06': { boss_per_session_max: 1, last_graded_p_min: 0.5 },
  'HC-07': { first_item_ms_max: 3000 },
  'HC-08': { practice_p_min: 0.6, practice_p_max: 0.85, boss_p: 0.5 },
  'HC-09': { budget_overrun_max: 1.1 },
  'HC-10': { min_level: 4, worked_parsons_share_max: 0.05 },
  'HC-11': { variant_recent_exclude: 5 },
};
const composer = (): Record<string, unknown> => ({
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
const withPaths = (path_weights: unknown): Record<string, unknown> => ({ ...composer(), path_weights });
const weight = { track_priority: ['k8s'], target_level: 3, retention_tier: 'core' };

describe('S0-IT01 계약 가산(CR-52·CR-73)', () => {
  it('UT-CON-240 ComposerPolicyV1.path_weights 없음·{} 통과 — 기존 값 무변경 [FR-CUR-019][FR-CUR-017]', () => {
    expect(ComposerPolicyV1.safeParse(composer()).success).toBe(true);
    expect(ComposerPolicyV1.safeParse(withPaths({})).success).toBe(true);
    expect(ComposerPolicyV1.safeParse({ ...composer(), path_wights: {} }).success).toBe(false);
  });

  it('UT-CON-241 path_weights 유효 항목(path.backend-core → k8s·3·core) 통과, 보존 계층 4종 전부 통과 [FR-CUR-019][FR-CUR-017]', () => {
    const r = ComposerPolicyV1.safeParse(withPaths({ 'path.backend-core': weight }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.path_weights?.['path.backend-core']).toEqual(weight);
    }
    for (const tier of ['core', 'standard', 'breadth', 'archive']) {
      expect(
        ComposerPolicyV1.safeParse(withPaths({ 'path.x': { ...weight, retention_tier: tier } })).success,
        tier,
      ).toBe(true);
    }
    expect(
      ComposerPolicyV1.safeParse(withPaths({ 'path.a': weight, 'path.b': { ...weight, track_priority: ['be', 'db'] } }))
        .success,
    ).toBe(true);
  });

  it('UT-CON-242 path_weights 잘못된 PathId 키·retention_tier hot·track_priority []·알 수 없는 트랙·level 범위·여분 키 거부 [FR-CUR-019][FR-CUR-017]', () => {
    const bad: [string, unknown][] = [
      ['PathId 키', { 'backend-core': weight }],
      ['PathId 대문자', { 'path.Backend': weight }],
      ['retention_tier hot', { 'path.x': { ...weight, retention_tier: 'hot' } }],
      ['track_priority 빈 배열', { 'path.x': { ...weight, track_priority: [] } }],
      ['알 수 없는 트랙', { 'path.x': { ...weight, track_priority: ['nope'] } }],
      ['target_level 0', { 'path.x': { ...weight, target_level: 0 } }],
      ['target_level 6', { 'path.x': { ...weight, target_level: 6 } }],
      ['여분 키', { 'path.x': { ...weight, extra: 1 } }],
      ['필드 누락', { 'path.x': { track_priority: ['k8s'], target_level: 3 } }],
    ];
    for (const [label, value] of bad) {
      expect(ComposerPolicyV1.safeParse(withPaths(value)).success, label).toBe(false);
    }
  });

  const alert = (href: string) => ({
    code: 'due_overflow',
    severity: 'warn',
    message_ko: '복습이 쌓였습니다',
    action: { label_ko: '시작', href },
  });

  it('UT-CON-244 HomeAlert.action.href 프로토콜 상대(//evil.example)·역슬래시(/\\evil)·절대 URL 거부 [FR-DSH-001][NFR-SEC-005]', () => {
    for (const href of ['//evil.example', '//', '/\\evil', '/\\\\evil.example', 'http://x', 'https://x/y', 'x?y=1']) {
      expect(HomeAlert.safeParse(alert(href)).success, href).toBe(false);
    }
  });

  it('UT-CON-245 HomeAlert.action.href `/`·`/session/<ULID>?x=1`·기존 허용 문자 통과 [FR-DSH-001][NFR-SEC-005]', () => {
    for (const href of [
      '/',
      '/session/01J1N2P3Q4R5S6T7V8W9X0Y1Z2?x=1',
      '/x?y=1',
      '/review/due_overflow',
      '/a/b_c.d$e&f=g-h',
    ]) {
      expect(HomeAlert.safeParse(alert(href)).success, href).toBe(true);
    }
    expect(HomeAlert.safeParse({ ...alert('/x'), action: null }).success).toBe(true);
  });

  it('UT-CON-246 UT-CON-186 사례 유지 — 알 수 없는 code·여분 키 거부, `/x?y=1` 통과 [FR-DSH-001]', () => {
    expect(HomeAlert.safeParse(alert('/x?y=1')).success).toBe(true);
    expect(HomeAlert.safeParse({ ...alert('/x?y=1'), code: 'nope' }).success).toBe(false);
    expect(HomeAlert.safeParse({ ...alert('/x?y=1'), extra: 1 }).success).toBe(false);
  });
});
