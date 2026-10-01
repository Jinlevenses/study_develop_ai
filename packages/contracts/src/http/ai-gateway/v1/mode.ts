import { z } from 'zod';
import { AiMode, ProviderKind, ProviderStatus } from '../../../common/domain.js';
import { ProviderId } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const ModeReason = z.enum(['first_boot', 'no_consent', 'consent_granted', 'consent_revoked', 'probe_ok', 'probe_failed', 'breaker_open',
  'breaker_closed', 'budget_exhausted', 'quota_exhausted', 'safe_mode', 'key_added', 'key_removed', 'gateway_unreachable']);   // gateway_unreachable = BFF 합성 전용
export type ModeReason = z.infer<typeof ModeReason>;
export const ModeView = S({ mode: AiMode, previous_mode: AiMode.nullable(), reasons: z.array(ModeReason).max(10),
  providers: z.array(S({ id: ProviderId, kind: ProviderKind, status: ProviderStatus })).max(32), changed_at: EpochMs, safe_mode: z.boolean() });
export type ModeView = z.infer<typeof ModeView>;
export const AiPreferences = S({
  local_only_families: z.array(z.enum(['generation', 'explanation', 'dialog', 'import', 'judge'])).max(5),   // FR-AI-023 로컬 강제
  pinned: S({ generation: ProviderId.nullable(), explanation: ProviderId.nullable(), dialog: ProviderId.nullable(), import: ProviderId.nullable() }),
  batch_enabled: z.boolean(), yield_to_interactive_cli: z.boolean(),                                         // FR-AI-025
});
export type AiPreferences = z.infer<typeof AiPreferences>;
