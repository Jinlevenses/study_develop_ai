import { z } from 'zod';
import { AiMode, ProviderKind, ProviderStatus } from '../../common/domain.js';
import { ProviderId, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { EpochMs, StudyDay } from '../../common/time.js';

export const AiModeObservedV1 = S({
  mode: AiMode,
  providers: z.array(S({ id: ProviderId, kind: ProviderKind, status: ProviderStatus })).max(32), // IF-LG-13
  source_event_id: Ulid,
  observed_at: EpochMs,
  study_day: StudyDay,
});
export type AiModeObservedV1 = z.infer<typeof AiModeObservedV1>;
