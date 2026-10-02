import { ResponseMode, Tier } from '@fathom/contracts/common/domain';
import { S } from '@fathom/contracts/common/schema';
import { z } from 'zod';

// state_json 로컬 zod(STD-TS-24: JSON.parse 직후 즉시 파싱) — 키 집합은 domain/learner-model/projector/types.ts와 같고,
// DDL STORED 생성 열 경로($.due·$.lapses·$.n_graded·$.mastery.mastered)와 일치한다. 와이어 계약이 아니라 DB 내부 형식이다.

export const CardStateSchema = S({
  due: z.number(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  learning_steps: z.number(),
  reps: z.number(),
  lapses: z.number(),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  last_review: z.number().nullable(),
  last_fsrs_at: z.number().nullable(),
  leech: z.literal(false),
});

export const ConceptStateSchema = S({
  theta: z.number(),
  theta_q: z.number(),
  n: z.number(),
  n_q: z.number(),
  n_graded: z.number(),
  w_sum: z.number(),
  beta_wsum: z.number(),
  credited_formats: z.record(z.string(), z.string()),
  study_days: z.array(z.string()),
  mastery: S({ p: z.number(), mastered: z.boolean(), provisional: z.literal(false) }),
  first_mastered_ts: z.number().nullable(),
});

export const CardRowSchema = S({
  card_id: z.string(),
  concept_id: z.string(),
  facet: z.string(),
  response_mode: ResponseMode,
  tier: Tier,
  status: z.enum(['active', 'suspended', 'retired']),
  last_ts: z.number().int(),
  state: CardStateSchema,
});

export const ConceptRowSchema = S({
  concept_id: z.string(),
  track_id: z.string(),
  last_ts: z.number().int(),
  state: ConceptStateSchema,
});
