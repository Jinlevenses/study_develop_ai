import { z } from 'zod';
import { DecideWorkOrderBody, WorkOrderView } from '../../../ai/work-order.js';
import { DegradedPart } from '../../../common/degraded.js';
import { GoldId, ProviderId, Ulid } from '../../../common/ids.js';
import { Page, PageQuery } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import {
  CalibrationStatusList,
  ConfirmCardList,
  ConfirmCardsQuery,
  ConfirmGoldBody,
  GoldItemView,
  RunCalibrationBody,
} from '../../ai-gateway/v1/calibration.js';
import {
  FirewallLogEntry,
  FirewallPatterns,
  FirewallPreviewBody,
  FirewallPreviewResult,
  PutFirewallPatternsBody,
} from '../../ai-gateway/v1/firewall.js';
import { JobListQuery, JobView } from '../../ai-gateway/v1/jobs.js';
import { AiPreferences, ModeView } from '../../ai-gateway/v1/mode.js';
import {
  ConsentBody,
  GenericCliDefinition,
  ProbeBody,
  ProbeRunView,
  ProviderConfigBody,
  ProviderView,
} from '../../ai-gateway/v1/providers.js';
import { PutSecretBody, SecretList, SecretMeta, UnlockResult, UnlockSecretsBody } from '../../ai-gateway/v1/secrets.js';
import {
  BudgetView,
  CallLogEntry,
  CallLogQuery,
  PutBudgetBody,
  UsageQuery,
  UsageSummary,
} from '../../ai-gateway/v1/usage.js';
import { WorkOrderListQuery } from '../../ai-gateway/v1/work-orders.js';

export const AiStatusView = S({ mode: ModeView, providers: z.array(ProviderView), degraded: z.array(DegradedPart) }); // ai-gateway 정지 시 mode = OFFLINE 합성 + degraded
export type AiStatusView = z.infer<typeof AiStatusView>;
// 하위 ⊕ IF-AI-039 + IF-AI-025
export const AiStatusRoute = defineRoute({
  id: 'gateway.ai.status',
  ifId: 'IF-GW-105',
  method: 'GET',
  path: '/api/v1/ai/status',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: AiStatusView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-AI-001', 'FR-AI-002'],
});
// 하위 = IF-AI-026
export const AiProbeRoute = defineRoute({
  id: 'gateway.ai.probe',
  ifId: 'IF-GW-106',
  method: 'POST',
  path: '/api/v1/ai/providers:probe',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: ProbeBody },
  response: { 202: ProbeRunView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-001', 'FR-AI-015'],
});
// 하위 = IF-AI-027
export const AiConsentRoute = defineRoute({
  id: 'gateway.ai.consent',
  ifId: 'IF-GW-107',
  method: 'PUT',
  path: '/api/v1/ai/providers/{provider_id}/consent',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }), body: ConsentBody },
  response: { 200: ProviderView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-AI-003', 'FR-SET-008'],
});
// 하위 = IF-AI-028
export const AiProviderConfigRoute = defineRoute({
  id: 'gateway.ai.provider_config',
  ifId: 'IF-GW-108',
  method: 'PUT',
  path: '/api/v1/ai/providers/{provider_id}/config',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }), body: ProviderConfigBody },
  response: { 200: ProviderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-004', 'FR-AI-022', 'FR-SET-008'],
});
// 하위 = IF-AI-029
export const AiGenericCliAddRoute = defineRoute({
  id: 'gateway.ai.generic_cli_add',
  ifId: 'IF-GW-109',
  method: 'POST',
  path: '/api/v1/ai/providers/generic-cli',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: GenericCliDefinition },
  response: { 201: ProviderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-024', 'IR-018'],
});
// 하위 = IF-AI-034
export const AiGenericCliRemoveRoute = defineRoute({
  id: 'gateway.ai.generic_cli_remove',
  ifId: 'IF-GW-110',
  method: 'DELETE',
  path: '/api/v1/ai/providers/generic-cli/{provider_id}',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }) },
  response: { 204: z.null() },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-024'],
});
// 하위 = IF-AI-030
export const AiSecretPutRoute = defineRoute({
  id: 'gateway.ai.secret_put',
  ifId: 'IF-GW-111',
  method: 'PUT',
  path: '/api/v1/ai/secrets/{provider_id}',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }), body: PutSecretBody },
  response: { 200: SecretMeta },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004', 'FR-SET-008'],
});
// 하위 = IF-AI-031
export const AiSecretsRoute = defineRoute({
  id: 'gateway.ai.secrets',
  ifId: 'IF-GW-112',
  method: 'GET',
  path: '/api/v1/ai/secrets',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SecretList },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004'],
});
// 하위 = IF-AI-032
export const AiSecretDeleteRoute = defineRoute({
  id: 'gateway.ai.secret_delete',
  ifId: 'IF-GW-113',
  method: 'DELETE',
  path: '/api/v1/ai/secrets/{provider_id}',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }) },
  response: { 204: z.null() },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004'],
});
// 하위 = IF-AI-033
export const AiSecretsUnlockRoute = defineRoute({
  id: 'gateway.ai.secrets_unlock',
  ifId: 'IF-GW-114',
  method: 'POST',
  path: '/api/v1/ai/secrets:unlock',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: UnlockSecretsBody },
  response: { 200: UnlockResult },
  freeze: 'O',
  slice: 'R2',
  fr: ['NFR-SEC-004'],
});
// 하위 = IF-AI-035
export const AiUsageRoute = defineRoute({
  id: 'gateway.ai.usage',
  ifId: 'IF-GW-115',
  method: 'GET',
  path: '/api/v1/ai/usage',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: UsageQuery },
  response: { 200: UsageSummary },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-007', 'FR-AI-021', 'FR-AI-025'],
});
// 하위 = IF-AI-036
export const AiCallsRoute = defineRoute({
  id: 'gateway.ai.calls',
  ifId: 'IF-GW-116',
  method: 'GET',
  path: '/api/v1/ai/calls',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: CallLogQuery },
  response: { 200: Page(CallLogEntry) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-021'],
});
// 하위 = IF-AI-037
export const AiBudgetRoute = defineRoute({
  id: 'gateway.ai.budget',
  ifId: 'IF-GW-117',
  method: 'GET',
  path: '/api/v1/ai/budget',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: BudgetView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-007'],
});
// 하위 = IF-AI-038
export const AiBudgetPutRoute = defineRoute({
  id: 'gateway.ai.budget_put',
  ifId: 'IF-GW-118',
  method: 'PUT',
  path: '/api/v1/ai/budget',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PutBudgetBody },
  response: { 200: BudgetView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-007', 'FR-AI-025'],
});
// 하위 = IF-AI-040
export const AiPreferencesRoute = defineRoute({
  id: 'gateway.ai.preferences',
  ifId: 'IF-GW-119',
  method: 'GET',
  path: '/api/v1/ai/preferences',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: AiPreferences },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-023'],
});
// 하위 = IF-AI-041
export const AiPreferencesPutRoute = defineRoute({
  id: 'gateway.ai.preferences_put',
  ifId: 'IF-GW-120',
  method: 'PUT',
  path: '/api/v1/ai/preferences',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: AiPreferences },
  response: { 200: AiPreferences },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-023', 'FR-AI-022'],
});
// 하위 = IF-AI-021
export const AiWorkOrdersRoute = defineRoute({
  id: 'gateway.ai.work_orders',
  ifId: 'IF-GW-121',
  method: 'GET',
  path: '/api/v1/ai/work-orders',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: WorkOrderListQuery },
  response: { 200: Page(WorkOrderView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-026'],
});
// 하위 = IF-AI-022
export const AiWorkOrderDecideRoute = defineRoute({
  id: 'gateway.ai.work_order_decide',
  ifId: 'IF-GW-122',
  method: 'POST',
  path: '/api/v1/ai/work-orders/{work_order_id}:decide',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ work_order_id: Ulid }), body: DecideWorkOrderBody },
  response: { 200: WorkOrderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-026'],
});
// 하위 = IF-AI-011
export const AiJobsRoute = defineRoute({
  id: 'gateway.ai.jobs',
  ifId: 'IF-GW-123',
  method: 'GET',
  path: '/api/v1/ai/jobs',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: JobListQuery },
  response: { 200: Page(JobView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-010'],
});
// 하위 = IF-AI-013
export const AiJobCancelRoute = defineRoute({
  id: 'gateway.ai.job_cancel',
  ifId: 'IF-GW-124',
  method: 'POST',
  path: '/api/v1/ai/jobs/{job_id}:cancel',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ job_id: Ulid }) },
  response: { 200: JobView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-010'],
});
// 하위 = IF-AI-042
export const AiCalibrationRoute = defineRoute({
  id: 'gateway.ai.calibration',
  ifId: 'IF-GW-125',
  method: 'GET',
  path: '/api/v1/ai/calibration',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: CalibrationStatusList },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-013', 'FR-AI-014'],
});
// 하위 = IF-AI-043
export const AiConfirmCardsRoute = defineRoute({
  id: 'gateway.ai.confirm_cards',
  ifId: 'IF-GW-126',
  method: 'GET',
  path: '/api/v1/ai/calibration/confirm-cards',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: ConfirmCardsQuery },
  response: { 200: ConfirmCardList },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-013', 'FR-AI-027'],
});
// 하위 = IF-AI-046
export const AiGoldConfirmRoute = defineRoute({
  id: 'gateway.ai.gold_confirm',
  ifId: 'IF-GW-127',
  method: 'POST',
  path: '/api/v1/ai/calibration/gold/{gold_id}:confirm',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ gold_id: GoldId }), body: ConfirmGoldBody },
  response: { 200: GoldItemView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-027'],
});
// 하위 = IF-AI-047
export const AiCalibrationRunRoute = defineRoute({
  id: 'gateway.ai.calibration_run',
  ifId: 'IF-GW-128',
  method: 'POST',
  path: '/api/v1/ai/calibration:run',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: RunCalibrationBody },
  response: { 202: JobView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-014'],
});
// 하위 = IF-AI-050
export const AiFirewallPatternsRoute = defineRoute({
  id: 'gateway.ai.firewall_patterns',
  ifId: 'IF-GW-129',
  method: 'GET',
  path: '/api/v1/ai/firewall/patterns',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: FirewallPatterns },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-019'],
});
// 하위 = IF-AI-051
export const AiFirewallPatternsPutRoute = defineRoute({
  id: 'gateway.ai.firewall_patterns_put',
  ifId: 'IF-GW-130',
  method: 'PUT',
  path: '/api/v1/ai/firewall/patterns',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: PutFirewallPatternsBody },
  response: { 200: FirewallPatterns },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-019'],
});
// 하위 = IF-AI-052
export const AiFirewallLogRoute = defineRoute({
  id: 'gateway.ai.firewall_log',
  ifId: 'IF-GW-131',
  method: 'GET',
  path: '/api/v1/ai/firewall/log',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: PageQuery },
  response: { 200: Page(FirewallLogEntry) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-019', 'FR-AI-021'],
});
// 하위 = IF-AI-053
export const AiFirewallPreviewRoute = defineRoute({
  id: 'gateway.ai.firewall_preview',
  ifId: 'IF-GW-132',
  method: 'POST',
  path: '/api/v1/ai/firewall:preview',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { body: FirewallPreviewBody },
  response: { 200: FirewallPreviewResult },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-019', 'FR-IMP-010'],
});
export const GW_AI_ROUTES = [
  AiStatusRoute,
  AiProbeRoute,
  AiConsentRoute,
  AiProviderConfigRoute,
  AiGenericCliAddRoute,
  AiGenericCliRemoveRoute,
  AiSecretPutRoute,
  AiSecretsRoute,
  AiSecretDeleteRoute,
  AiSecretsUnlockRoute,
  AiUsageRoute,
  AiCallsRoute,
  AiBudgetRoute,
  AiBudgetPutRoute,
  AiPreferencesRoute,
  AiPreferencesPutRoute,
  AiWorkOrdersRoute,
  AiWorkOrderDecideRoute,
  AiJobsRoute,
  AiJobCancelRoute,
  AiCalibrationRoute,
  AiConfirmCardsRoute,
  AiGoldConfirmRoute,
  AiCalibrationRunRoute,
  AiFirewallPatternsRoute,
  AiFirewallPatternsPutRoute,
  AiFirewallLogRoute,
  AiFirewallPreviewRoute,
] as const;
