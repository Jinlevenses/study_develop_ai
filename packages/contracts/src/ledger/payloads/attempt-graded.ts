import { z } from 'zod';
import { FsrsRating } from '../../common/domain.js';
import { CardId, PolicySetId } from '../../common/ids.js';
import { AttemptPhase } from '../../common/practice.js';
import { S } from '../../common/schema.js';
import { EpochMs, StudyDay } from '../../common/time.js';
import { VerdictCarried } from './verdict-carried.js';

export const AttemptGradedV1 = S({
  ...VerdictCarried, // IF-LG-01
  card_id: CardId,
  phase: AttemptPhase,
  rating: FsrsRating.nullable(), // 확정 grade. pending(w 0)이면 null → FSRS 미적용
  cbm_score: z.number().nullable(), // FR-QST-024 원점수와 함께 저장
  fsrs_at: EpochMs,
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type AttemptGradedV1 = z.infer<typeof AttemptGradedV1>;
