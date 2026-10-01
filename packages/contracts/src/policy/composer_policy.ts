import { z } from 'zod';
import { Level, SlotId } from '../common/domain.js';
import { S } from '../common/schema.js';

const P = z.number().min(0).max(1);

// [Brief 결정 §4.6 — CR-43 T1 저작] policy/composer_policy@v1.yaml 의 zod. 값 출처 = PED §6.3(점수 함수 8항·softmax top-3 τ 0.3)·§6.4(HC-01~11)·§6.6(난이도 파도).
export const ComposerPolicyV1 = S({
  version: z.literal('composer_policy@v1'),
  score_weights: S({
    utility: P,
    urgency: P,
    goal: P,
    novelty: P,
    preference: P,
    fatigue: P,
    switch_cost: P,
    mix_delta: P,
    softmax: S({ top_k: z.number().int().min(1).max(10), tau: z.number().positive() }),
  }),
  hard_constraints: S({
    'HC-01': S({ same_mode_consecutive_max: z.number().int().min(1).max(5) }),
    'HC-02': S({
      min_session_minutes: z.number().int().min(1),
      modes_min: z.number().int().min(1).max(10),
      short_template_slots: z.array(SlotId).min(1).max(6),
    }),
    'HC-03': S({ min_session_minutes: z.number().int().min(1), constructive_interactive_share_min: P }),
    'HC-04': S({ requeue_within_h: z.number().int().min(1).max(72) }),
    'HC-05': S({ new_blocked: z.boolean(), review_interleaved: z.boolean() }),
    'HC-06': S({ boss_per_session_max: z.number().int().min(0).max(3), last_graded_p_min: P }),
    'HC-07': S({ first_item_ms_max: z.number().int().min(1) }),
    'HC-08': S({ practice_p_min: P, practice_p_max: P, boss_p: P }).refine(
      (h) => h.practice_p_min <= h.practice_p_max,
      'practice_p_min must be <= practice_p_max',
    ),
    'HC-09': S({ budget_overrun_max: z.number().min(1).max(2) }),
    'HC-10': S({ min_level: Level, worked_parsons_share_max: P }),
    'HC-11': S({ variant_recent_exclude: z.number().int().min(0).max(50) }),
  }),
  entropy: S({
    h_min_formula: z.literal('min(h_cap, coef * log2(min(k, B)))'),
    h_cap: z.number().positive(),
    coef: z.number().positive(),
    window_days: z.number().int().min(1).max(28),
    single_mode_share_max: P,
    freshness_boost: z.number().min(1),
    weekly_quota: S({
      digging: z.number().int().min(0),
      lab: z.number().int().min(0),
      blank_note: z.number().int().min(0),
    }),
    suggest_only_min_level: Level,
  }),
  boss: S({
    min_session_minutes: z.number().int().min(1),
    level_offset: z.number().int().min(0).max(2),
    target_p: P,
    evidence_weight_factor: P,
  }),
  peak_end: S({ wave: z.record(SlotId, P) }), // 난이도 파도(PED §6.6) — 슬롯 6개 전부
  wildcard: S({
    per_week_min: z.number().int().min(0).max(7),
    constraints: z
      .array(z.enum(['diagram_only', 'one_sentence', 'no_jargon', 'explain_to_pm']))
      .min(1)
      .max(4),
    suggest_only_min_level: Level,
  }),
});
export type ComposerPolicyV1 = z.infer<typeof ComposerPolicyV1>;
