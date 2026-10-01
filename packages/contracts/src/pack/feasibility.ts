import { z } from 'zod';
import { AiMode, FormatId, Level, Sp1State, Tier } from '../common/domain.js';
import { CaseId, ConceptId, TrackId } from '../common/ids.js';
import { FeasibilityBlocker } from '../common/practice.js';
import { S } from '../common/schema.js';
import { MasteryRulesV1 } from '../policy/mastery_rules.js';

export const AssessmentInventory = S({                                       // 트랙 1개분 — IF-CT-007 'inventory' 줄
  track: TrackId,
  concepts: z.array(S({ concept_id: ConceptId, level: Level, tier: Tier, required_for_level: Level.nullable(), d4_possible: z.boolean(),
    formats_by_mode: z.record(AiMode, z.array(FormatId)) })).max(300),
  assessment_pool: z.record(z.enum(['1', '2', '3', '4', '5']), z.record(AiMode, S({ items: z.number().int().min(0), formats: z.array(FormatId) }))),
  cases: z.array(S({ case_id: CaseId, level: Level, tracks: z.array(TrackId) })).max(60),
});
export type AssessmentInventory = z.infer<typeof AssessmentInventory>;
export type FeasibilityTransition = { track: z.infer<typeof TrackId>; from: 1 | 2 | 3 | 4; to: 2 | 3 | 4 | 5 };
export declare function structuralFeasibility(
  policy: z.infer<typeof MasteryRulesV1>, inventory: z.infer<typeof AssessmentInventory>,
  transition: FeasibilityTransition, mode: z.infer<typeof AiMode>, sp1: z.infer<typeof Sp1State>,
): { feasible: boolean; blockers: z.infer<typeof FeasibilityBlocker>[] };
