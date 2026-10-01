import { z } from 'zod';
import { AiMode } from '../common/domain.js';
import { WGraderTable } from '../common/practice.js';
import { S } from '../common/schema.js';

// 값은 policy/mastery_rules@v1.yaml — SIM-PROMO 후 확정, CR-18~22
export const MasteryRulesV1 = S({
  version: z.literal('mastery_rules@v1'),
  epsilon: z.number(), // geq ε = 1e-9
  elo: S({
    alpha: z.number(),
    b: z.number(),
    guess_correction: z.boolean(),
    unqualified_ceiling: z.number(),
    theta_q: S({ w_format_min: z.number(), w_grader_min: z.number() }),
  }),
  theta_shrink: S({ theta_prior: z.number(), theta_shrink_n0: z.number(), theta_display_min_events: z.number().int() }),
  mastery: S({
    p_min: z.number(),
    formats_min: z.number().int(),
    distinct_days_min: z.number().int(),
    format_counts: S({ w_format_min: z.number(), w_grader_min: z.number() }),
  }),
  w_grader: WGraderTable,
  promotion: S({
    empty_level: z.enum(['skip', 'block']),
    required_mastered: S({ all_if_n_le: z.number().int(), ratio: z.number(), allow_misses: z.number().int() }),
  }),
  sparse: S({ depth_scope: z.enum(['track', 'level']) }),
  d4: S({ floor_mode: z.enum(['min_with_possible', 'fixed']), possible_scope: z.enum(['level_le_k', 'all']) }),
  assessment: S({
    items: z.number().int(),
    formats_min: z.number().int(),
    selection: z.literal('round_robin_by_format'),
    engines: z.array(z.enum(['deterministic', 'calibrated_jev_if_sp1_pass'])),
    accuracy_min_correct: z.record(z.enum(['1', '2', '3', '4']), z.number().int()),
    cbm_denominator: z.literal('chosen_confidence_max'),
    cbm_min: z.record(z.enum(['1', '2', '3', '4']), z.number()),
    retry_days: z.number().int(),
  }),
  ai_profiles: z.record(
    AiMode,
    S({
      rubric_engine: S({
        sp1_pass: z.enum(['J', 'LJ', 'S_provisional']),
        sp1_fail: z.enum(['J', 'LJ', 'S_provisional']),
      }),
      provisional_if_self_only: z.boolean(),
    }),
  ),
});
export type MasteryRulesV1 = z.infer<typeof MasteryRulesV1>;
