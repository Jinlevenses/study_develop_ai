import { z } from 'zod';
import { FsrsRating } from '../../common/domain.js';
import { CardId, PolicySetId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';
import { VerdictCarried } from './verdict-carried.js';

export const EvidenceRegradedV1 = S({
  ...VerdictCarried, // IF-LG-03 — 숙달 즉시, FSRS는 확인 후(FR-QST-020)
  supersedes_event_id: Ulid,
  supersedes_verdict_id: Ulid,
  card_id: CardId,
  reason: z.enum(['pending_regrade', 'appeal']),
  new_rating: FsrsRating.nullable(),
  rating_applied: z.literal(false),
  study_day: StudyDay,
  policy_version: PolicySetId,
});
export type EvidenceRegradedV1 = z.infer<typeof EvidenceRegradedV1>;
