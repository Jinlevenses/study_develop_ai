import { z } from 'zod';
import { FormatId, GraderEngine, JudgeBadge } from '../../../../common/domain.js';
import { ItemId, KuId, MisconceptionId, ObjKey, SemVer, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { EpochMs } from '../../../../common/time.js';
import { AppealView } from '../grading.js';

export const JudgeCardPostSubmit = S({
  verdict_id: Ulid, attempt_id: Ulid, item_id: ItemId, format: FormatId, engine: GraderEngine, badge: JudgeBadge, calibrated: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(), model_version: z.string().max(80).nullable(), prompt_version: SemVer.nullable(), judge_log_ref: Ulid.nullable(),
  units: z.record(ObjKey, S({                                                    // 'units.u03: 누락 p=0.91' — 객체 키 판정
    label_ko: z.string().max(200), kind: z.enum(['kp', 'misconception', 'dimension', 'solo', 'injection', 'rationale']),
    outcome: z.enum(['covered', 'partial', 'missing', 'present', 'absent', 'scored']),
    p: z.number().min(0).max(1).nullable(), score: z.number().nullable(), ku_id: KuId.nullable(), mc_id: MisconceptionId.nullable() })),
  cited_ku_ids: z.array(KuId).max(20), supersedes: Ulid.nullable(), superseded_by: Ulid.nullable(),
  appeal: AppealView.nullable(), issued_at: EpochMs,
});
export type JudgeCardPostSubmit = z.infer<typeof JudgeCardPostSubmit>;
