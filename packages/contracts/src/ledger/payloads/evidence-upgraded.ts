import { z } from 'zod';
import { FsrsRating } from '../../common/domain.js';
import { CardId, PolicySetId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { StudyDay } from '../../common/time.js';
import { VerdictCarried } from './verdict-carried.js';

export const EvidenceUpgradedV1 = S({
  ...VerdictCarried, // IF-LG-02 — 원 증거의 결과·w 대체(밴드 변경분만 UI)
  supersedes_event_id: Ulid,
  supersedes_verdict_id: Ulid,
  card_id: CardId,
  new_rating: FsrsRating.nullable(),
  rating_applied: z.literal(false), // FSRS grade는 학습자 확인(IF-LR-017) 후에만
  study_day: StudyDay,
  policy_version: PolicySetId, // study_day = 이 이벤트 생성일. "서로 다른 날" 집계는 원 이벤트의 study_day를 유지
});
export type EvidenceUpgradedV1 = z.infer<typeof EvidenceUpgradedV1>;
