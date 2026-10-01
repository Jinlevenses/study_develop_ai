import { z } from 'zod';
import { Energy, Level, SessionMinutes } from '../../../common/domain.js';
import {
  BlueprintId,
  ConceptId,
  DeviceId,
  PathId,
  PolicyRef,
  PolicySetId,
  ServiceName,
  Sha256Hex,
  TrackId,
  Ulid,
} from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs, StudyDay } from '../../../common/time.js';

export const LearnerProfile = S({
  device_id: DeviceId,
  timezone: z.string().max(64), // IANA, OS 값(읽기 전용)
  day_boundary_hour: z.number().int().min(0).max(23), // 기본 4 (FR-PRG-027)
  weekly_goal_sessions: z.number().int().min(1).max(14),
  rest_tokens_per_week: z.number().int().min(0).max(3),
  default_minutes: SessionMinutes.nullable(),
  default_energy: Energy.nullable(),
  wildcard_mode: z.enum(['enforce', 'suggest']),
  quota_mode: z.enum(['enforce', 'suggest']),
  log_content: z.boolean(),
  reduced_motion: z.enum(['system', 'on', 'off']),
  ui_density: z.enum(['auto', 'compact', 'comfortable']),
  notifications: S({ weekly_review: z.boolean(), return_nudge: z.boolean() }),
  career_years: z.number().min(0).max(40).nullable(),
  primary_track: TrackId.nullable(),
  path_id: PathId.nullable(),
  onboarded: z.boolean(),
});
export type LearnerProfile = z.infer<typeof LearnerProfile>;
export const PatchProfileBody = S({
  day_boundary_hour: z.number().int().min(0).max(23).optional(),
  weekly_goal_sessions: z.number().int().min(1).max(14).optional(),
  rest_tokens_per_week: z.number().int().min(0).max(3).optional(),
  default_minutes: SessionMinutes.nullable().optional(),
  default_energy: Energy.nullable().optional(),
  wildcard_mode: z.enum(['enforce', 'suggest']).optional(),
  quota_mode: z.enum(['enforce', 'suggest']).optional(),
  log_content: z.boolean().optional(),
  reduced_motion: z.enum(['system', 'on', 'off']).optional(),
  ui_density: z.enum(['auto', 'compact', 'comfortable']).optional(),
  notifications: S({ weekly_review: z.boolean(), return_nudge: z.boolean() }).optional(),
  career_years: z.number().min(0).max(40).nullable().optional(),
  primary_track: TrackId.nullable().optional(),
  path_id: PathId.nullable().optional(),
});
export type PatchProfileBody = z.infer<typeof PatchProfileBody>;
export const PersonalOverrides = S({
  // FR-PRG-028 — 적용하면 새 policy_version(정책 세트에 포함)
  request_retention: S({
    A: z.number().min(0.7).max(0.97).optional(),
    B: z.number().min(0.7).max(0.97).optional(),
    C: z.number().min(0.7).max(0.97).optional(),
  }).optional(),
  daily_new_limit: z.number().int().min(0).max(100).optional(),
  daily_review_limit: z.number().int().min(0).max(1000).optional(),
});
export type PersonalOverrides = z.infer<typeof PersonalOverrides>;
export const PolicyStatusView = S({
  active_policy_version: PolicySetId,
  members: z.record(z.string(), S({ version: PolicyRef, sha256: Sha256Hex, owner: ServiceName })),
  available: z.array(S({ name: z.string(), versions: z.array(PolicyRef) })),
  overrides: PersonalOverrides.nullable(),
  provisional: z.array(PolicyRef), // ['ldi_params@v1', 'mastery_rules@v1'] (CR-28, SIM-PROMO)
});
export type PolicyStatusView = z.infer<typeof PolicyStatusView>;
export const PolicyPreviewBody = S({
  preview_id: Ulid,
  target: S({ members: z.record(z.string(), PolicyRef).optional(), overrides: PersonalOverrides.optional() }),
});
export type PolicyPreviewBody = z.infer<typeof PolicyPreviewBody>;
export const PolicyPreview = S({
  preview_id: Ulid,
  current_policy_version: PolicySetId,
  target_policy_version: PolicySetId,
  expires_at: EpochMs,
  report: S({
    events_replayed: z.number().int(),
    queue_size_delta: z.number().int(),
    mastered_delta: z.number().int(),
    ldi_delta: z.number().nullable(),
    changed_concepts: z.array(ConceptId).max(200),
    duration_ms: DurationMs,
  }),
});
export type PolicyPreview = z.infer<typeof PolicyPreview>;
export const PolicySwitchBody = S({ preview_id: Ulid });
export type PolicySwitchBody = z.infer<typeof PolicySwitchBody>;
export const PolicySwitchResult = S({ policy_version: PolicySetId, ledger_event_id: Ulid, switched_at: EpochMs });
export type PolicySwitchResult = z.infer<typeof PolicySwitchResult>;
export const OnboardingBody = S({
  career_years: z.number().min(0).max(40),
  weekly_minutes: z.number().int().min(15).max(1200),
  path_id: PathId.nullable(),
  declarations: z.array(S({ track: TrackId, declared_level: Level })).max(20),
});
export type OnboardingBody = z.infer<typeof OnboardingBody>;
export const OnboardingResult = S({
  placement_tracks: z.array(TrackId),
  next: z.literal('placement_session'),
  declaration_event_id: Ulid,
});
export type OnboardingResult = z.infer<typeof OnboardingResult>;
export const DdayScope = z.discriminatedUnion('kind', [
  S({ kind: z.literal('concepts'), concept_ids: z.array(ConceptId).min(1).max(500) }),
  S({ kind: z.literal('tag'), tag: z.string().regex(/^cert:[a-z0-9-]{2,40}$/) }),
  S({ kind: z.literal('blueprint'), blueprint_id: BlueprintId }),
]);
export type DdayScope = z.infer<typeof DdayScope>;
export const PutPauseBody = S({
  mode: z.enum(['pause', 'crunch']),
  from: StudyDay,
  to: StudyDay,
  crunch_scope: z.enum(['mvd', 'core']).nullable(),
});
export type PutPauseBody = z.infer<typeof PutPauseBody>;
export const PutDdayBody = S({ target_date: StudyDay, scope: DdayScope });
export type PutDdayBody = z.infer<typeof PutDdayBody>;
export const RhythmView = S({
  pause: S({
    mode: z.enum(['pause', 'crunch']),
    from: StudyDay,
    to: StudyDay,
    crunch_scope: z.enum(['mvd', 'core']).nullable(),
  }).nullable(),
  dday: S({ target_date: StudyDay, scope: DdayScope }).nullable(),
  return_mode: S({ active: z.boolean(), since: StudyDay.nullable(), gap_days: z.number().int().min(0) }),
});
export type RhythmView = z.infer<typeof RhythmView>;
export const SealDeclarationBody = S({
  declaration_id: Ulid,
  kind: z.enum(['time_capsule', 'season_goal', 'self_declaration']),
  payload: z.record(z.string(), z.unknown()),
  unseal_at: EpochMs.nullable(),
});
export type SealDeclarationBody = z.infer<typeof SealDeclarationBody>;
export const DeclarationAck = S({ declaration_id: Ulid, ledger_event_id: Ulid, content_hash: Sha256Hex });
export type DeclarationAck = z.infer<typeof DeclarationAck>;
export const SettingsProfileGetRoute = defineRoute({
  id: 'learning.settings.profile_get',
  ifId: 'IF-LR-062',
  method: 'GET',
  path: '/internal/v1/settings/profile',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: LearnerProfile },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-009', 'FR-SET-019', 'FR-SET-020', 'FR-PRG-022', 'FR-PRG-027'],
});
export const SettingsProfilePatchRoute = defineRoute({
  id: 'learning.settings.profile_patch',
  ifId: 'IF-LR-063',
  method: 'PATCH',
  path: '/internal/v1/settings/profile',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PatchProfileBody },
  response: { 200: LearnerProfile },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-009', 'FR-SET-010', 'FR-PRG-022', 'FR-PRG-027'],
});
export const SettingsPoliciesRoute = defineRoute({
  id: 'learning.settings.policies',
  ifId: 'IF-LR-064',
  method: 'GET',
  path: '/internal/v1/settings/policies',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: PolicyStatusView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-CUR-017', 'FR-SET-018'],
});
// idem = preview_id
export const SettingsPoliciesPreviewRoute = defineRoute({
  id: 'learning.settings.policies_preview',
  ifId: 'IF-LR-065',
  method: 'POST',
  path: '/internal/v1/settings/policies:preview',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PolicyPreviewBody },
  response: { 200: PolicyPreview },
  deadlineMs: 60000,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-018', 'FR-PRG-028', 'FR-PRG-029'],
});
export const SettingsPoliciesSwitchRoute = defineRoute({
  id: 'learning.settings.policies_switch',
  ifId: 'IF-LR-066',
  method: 'POST',
  path: '/internal/v1/settings/policies:switch',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PolicySwitchBody },
  response: { 200: PolicySwitchResult },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-018'],
});
export const SettingsOnboardingRoute = defineRoute({
  id: 'learning.settings.onboarding',
  ifId: 'IF-LR-067',
  method: 'POST',
  path: '/internal/v1/settings/onboarding',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: OnboardingBody },
  response: { 200: OnboardingResult },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-019', 'FR-PRG-014', 'FR-PRG-025'],
});
export const SettingsPausePutRoute = defineRoute({
  id: 'learning.settings.pause_put',
  ifId: 'IF-LR-068',
  method: 'PUT',
  path: '/internal/v1/settings/pause',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PutPauseBody },
  response: { 200: RhythmView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-021'],
});
export const SettingsPauseDeleteRoute = defineRoute({
  id: 'learning.settings.pause_delete',
  ifId: 'IF-LR-069',
  method: 'DELETE',
  path: '/internal/v1/settings/pause',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: {},
  response: { 200: RhythmView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-020', 'FR-PRG-021'],
});
export const SettingsDdayPutRoute = defineRoute({
  id: 'learning.settings.dday_put',
  ifId: 'IF-LR-070',
  method: 'PUT',
  path: '/internal/v1/settings/dday',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PutDdayBody },
  response: { 200: RhythmView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-019', 'FR-CUR-024'],
});
export const SettingsDdayDeleteRoute = defineRoute({
  id: 'learning.settings.dday_delete',
  ifId: 'IF-LR-071',
  method: 'DELETE',
  path: '/internal/v1/settings/dday',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: {},
  response: { 200: RhythmView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-019'],
});
// idem = declaration_id
export const SettingsDeclarationsRoute = defineRoute({
  id: 'learning.settings.declarations',
  ifId: 'IF-LR-072',
  method: 'POST',
  path: '/internal/v1/settings/declarations',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: SealDeclarationBody },
  response: { 201: DeclarationAck },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-027', 'FR-PRG-025', 'FR-DSH-012'],
});
export const LR_SETTINGS_ROUTES = [
  SettingsProfileGetRoute,
  SettingsProfilePatchRoute,
  SettingsPoliciesRoute,
  SettingsPoliciesPreviewRoute,
  SettingsPoliciesSwitchRoute,
  SettingsOnboardingRoute,
  SettingsPausePutRoute,
  SettingsPauseDeleteRoute,
  SettingsDdayPutRoute,
  SettingsDdayDeleteRoute,
  SettingsDeclarationsRoute,
] as const;
