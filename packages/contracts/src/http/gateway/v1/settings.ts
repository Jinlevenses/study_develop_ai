import { CardId } from '../../../common/ids.js';
import { Page } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { CardActionBody, CardListQuery, CardView } from '../../learning/v1/learner.js';
import {
  DeclarationAck,
  LearnerProfile,
  OnboardingBody,
  OnboardingResult,
  PatchProfileBody,
  PolicyPreview,
  PolicyPreviewBody,
  PolicyStatusView,
  PolicySwitchBody,
  PolicySwitchResult,
  PutDdayBody,
  PutPauseBody,
  RhythmView,
  SealDeclarationBody,
} from '../../learning/v1/settings.js';

// 하위 = IF-LR-062
export const SettingsGetRoute = defineRoute({
  id: 'gateway.settings.get',
  ifId: 'IF-GW-160',
  method: 'GET',
  path: '/api/v1/settings',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: LearnerProfile },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-009', 'FR-SET-019', 'FR-SET-020', 'FR-PRG-022', 'FR-PRG-027'],
});
// 하위 = IF-LR-063
export const SettingsPatchRoute = defineRoute({
  id: 'gateway.settings.patch',
  ifId: 'IF-GW-161',
  method: 'PATCH',
  path: '/api/v1/settings',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PatchProfileBody },
  response: { 200: LearnerProfile },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-009', 'FR-SET-010', 'FR-PRG-022', 'FR-PRG-027'],
});
// 하위 = IF-LR-064
export const SettingsPoliciesRoute = defineRoute({
  id: 'gateway.settings.policies',
  ifId: 'IF-GW-162',
  method: 'GET',
  path: '/api/v1/settings/policies',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: PolicyStatusView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-CUR-017', 'FR-SET-018'],
});
// 하위 = IF-LR-065
export const SettingsPoliciesPreviewRoute = defineRoute({
  id: 'gateway.settings.policies_preview',
  ifId: 'IF-GW-163',
  method: 'POST',
  path: '/api/v1/settings/policies:preview',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PolicyPreviewBody },
  response: { 200: PolicyPreview },
  deadlineMs: 60000,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-018', 'FR-PRG-028', 'FR-PRG-029'],
});
// 하위 = IF-LR-066
export const SettingsPoliciesSwitchRoute = defineRoute({
  id: 'gateway.settings.policies_switch',
  ifId: 'IF-GW-164',
  method: 'POST',
  path: '/api/v1/settings/policies:switch',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PolicySwitchBody },
  response: { 200: PolicySwitchResult },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-018'],
});
// 하위 = IF-LR-067
export const SettingsOnboardingRoute = defineRoute({
  id: 'gateway.settings.onboarding',
  ifId: 'IF-GW-165',
  method: 'POST',
  path: '/api/v1/settings/onboarding',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: OnboardingBody },
  response: { 200: OnboardingResult },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-SET-019', 'FR-PRG-014', 'FR-PRG-025'],
});
// 하위 = IF-LR-068
export const SettingsPausePutRoute = defineRoute({
  id: 'gateway.settings.pause_put',
  ifId: 'IF-GW-166',
  method: 'PUT',
  path: '/api/v1/settings/pause',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PutPauseBody },
  response: { 200: RhythmView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-021'],
});
// 하위 = IF-LR-069
export const SettingsPauseDeleteRoute = defineRoute({
  id: 'gateway.settings.pause_delete',
  ifId: 'IF-GW-167',
  method: 'DELETE',
  path: '/api/v1/settings/pause',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: {},
  response: { 200: RhythmView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-020', 'FR-PRG-021'],
});
// 하위 = IF-LR-070
export const SettingsDdayPutRoute = defineRoute({
  id: 'gateway.settings.dday_put',
  ifId: 'IF-GW-168',
  method: 'PUT',
  path: '/api/v1/settings/dday',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PutDdayBody },
  response: { 200: RhythmView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-019', 'FR-CUR-024'],
});
// 하위 = IF-LR-071
export const SettingsDdayDeleteRoute = defineRoute({
  id: 'gateway.settings.dday_delete',
  ifId: 'IF-GW-169',
  method: 'DELETE',
  path: '/api/v1/settings/dday',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: {},
  response: { 200: RhythmView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-019'],
});
// idem = declaration_id
// 하위 = IF-LR-072
export const SettingsDeclarationsRoute = defineRoute({
  id: 'gateway.settings.declarations',
  ifId: 'IF-GW-170',
  method: 'POST',
  path: '/api/v1/settings/declarations',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: SealDeclarationBody },
  response: { 201: DeclarationAck },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-STD-027', 'FR-PRG-025', 'FR-DSH-012'],
});
// 하위 = IF-LR-048
export const CardsListRoute = defineRoute({
  id: 'gateway.cards.list',
  ifId: 'IF-GW-171',
  method: 'GET',
  path: '/api/v1/cards',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: CardListQuery },
  response: { 200: Page(CardView) },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-030', 'FR-PRG-031'],
});
// 하위 = IF-LR-049
export const CardsSuspendRoute = defineRoute({
  id: 'gateway.cards.suspend',
  ifId: 'IF-GW-172',
  method: 'POST',
  path: '/api/v1/cards/{card_id}:suspend',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ card_id: CardId }), body: CardActionBody },
  response: { 200: CardView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-031'],
});
// 하위 = IF-LR-050
export const CardsRetireRoute = defineRoute({
  id: 'gateway.cards.retire',
  ifId: 'IF-GW-173',
  method: 'POST',
  path: '/api/v1/cards/{card_id}:retire',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ card_id: CardId }), body: CardActionBody },
  response: { 200: CardView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-031'],
});
// 하위 = IF-LR-051
export const CardsResumeRoute = defineRoute({
  id: 'gateway.cards.resume',
  ifId: 'IF-GW-174',
  method: 'POST',
  path: '/api/v1/cards/{card_id}:resume',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ card_id: CardId }), body: CardActionBody },
  response: { 200: CardView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-PRG-031'],
});
export const GW_SETTINGS_ROUTES = [
  SettingsGetRoute,
  SettingsPatchRoute,
  SettingsPoliciesRoute,
  SettingsPoliciesPreviewRoute,
  SettingsPoliciesSwitchRoute,
  SettingsOnboardingRoute,
  SettingsPausePutRoute,
  SettingsPauseDeleteRoute,
  SettingsDdayPutRoute,
  SettingsDdayDeleteRoute,
  SettingsDeclarationsRoute,
  CardsListRoute,
  CardsSuspendRoute,
  CardsRetireRoute,
  CardsResumeRoute,
] as const;
