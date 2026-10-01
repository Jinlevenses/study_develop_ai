import { z } from 'zod';
import { AiErrorClass } from '../../../ai/errors.js';
import { SystemTaskId, TaskId } from '../../../ai/tasks.js';
import { DataClass } from '../../../common/domain.js';
import { ProviderId, SemVer, Ulid } from '../../../common/ids.js';
import { Cursor, Page } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs, StudyDay } from '../../../common/time.js';
import { FirewallAction } from './firewall.js';
import { ProviderFamily } from './providers.js';

export const CostBasis = z.enum(['reported', 'computed', 'subscription', 'free']);
export type CostBasis = z.infer<typeof CostBasis>;
export const UsageSummary = S({
  period: z.enum(['day', 'month']),
  period_start: StudyDay,
  money: S({
    krw_spent: z.number().int(),
    krw_budget: z.number().int(),
    ratio: z.number().min(0),
    split: S({ metered_krw: z.number().int(), subscription_nominal_krw: z.number().int() }),
  }), // 과금분·구독분 분리(FR-AI-007)
  quota: z
    .array(
      S({
        provider_id: ProviderId,
        window: z.enum(['5h', 'week']),
        used_pct: z.number().min(0),
        resets_at: EpochMs.nullable(),
      }),
    )
    .max(16),
  by_task: z
    .array(
      S({
        task_id: TaskId,
        calls: z.number().int(),
        krw: z.number().int(),
        p95_ms: z.number().nullable(),
        fail_rate: z.number().min(0).max(1),
        fallback_rate: z.number().min(0).max(1),
      }),
    )
    .max(32),
  by_provider: z.array(S({ provider_id: ProviderId, calls: z.number().int(), krw: z.number().int() })).max(16),
  accepted_item_cost_krw: z.number().nullable(),
});
export type UsageSummary = z.infer<typeof UsageSummary>;
export const CallLogQuery = S({
  task_id: TaskId.optional(),
  provider_id: ProviderId.optional(),
  outcome: z.enum(['ok', 'error', 'timeout', 'fallback', 'cache_hit']).optional(),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CallLogQuery = z.infer<typeof CallLogQuery>;
export const CallLogEntry = S({
  // 방화벽 차단(block)은 호출 0 → ai_firewall_log·FirewallLogEntry에만(CR-39)
  call_id: Ulid,
  ts: EpochMs,
  task_id: TaskId.or(SystemTaskId),
  provider_id: ProviderId,
  model: z.string().max(80),
  family: ProviderFamily,
  transport: z.enum(['api', 'cli', 'jev', 'local']),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  cost: S({ basis: CostBasis, krw: z.number().min(0), usd: z.number().min(0).nullable() }),
  latency_ms: DurationMs,
  outcome: z.enum(['ok', 'error', 'timeout', 'fallback', 'cache_hit']),
  error_class: AiErrorClass.nullable(),
  cache_hit: z.boolean(),
  prompt_version: SemVer.nullable(),
  firewall_action: FirewallAction,
  firewall_decision_id: Ulid,
  data_class: DataClass,
  external_processor: z.boolean(),
  route_trace: z
    .array(S({ provider_id: ProviderId, decision: z.enum(['selected', 'skipped']), reason: z.string().max(60) }))
    .max(16),
});
export type CallLogEntry = z.infer<typeof CallLogEntry>;
export const BudgetView = S({
  monthly_krw: z.number().int().min(0),
  warn_ratio: z.number(),
  hard_stop_ratio: z.number(),
  degrade_day: z.number().int().min(1).max(31), // 20일차 80% 강등
  per_call_usd_cap: z.number().min(0).nullable(),
  bulk_threshold: S({ calls: z.number().int(), krw: z.number().int(), quota_pct: z.number() }),
  subscription_windows: S({ five_hour_calls: z.number().int().nullable(), weekly_calls: z.number().int().nullable() }),
  batch_window: S({ idle_min: z.number().int(), require_ac: z.boolean() }),
});
export type BudgetView = z.infer<typeof BudgetView>;
export const PutBudgetBody = S({
  monthly_krw: z.number().int().min(0).max(10_000_000),
  per_call_usd_cap: z.number().min(0).nullable(),
  bulk_threshold: S({
    calls: z.number().int().min(1),
    krw: z.number().int().min(0),
    quota_pct: z.number().min(1).max(100),
  }).optional(),
  subscription_windows: S({
    five_hour_calls: z.number().int().min(0).nullable(),
    weekly_calls: z.number().int().min(0).nullable(),
  }).optional(),
});
export type PutBudgetBody = z.infer<typeof PutBudgetBody>;
export const UsageQuery = S({ period: z.enum(['day', 'month']).default('month') });
export type UsageQuery = z.infer<typeof UsageQuery>;
export const UsageSummaryRoute = defineRoute({
  id: 'ai-gateway.usage.summary',
  ifId: 'IF-AI-035',
  method: 'GET',
  path: '/internal/v1/usage',
  allowedCallers: ['gateway', 'ops-api'],
  idempotent: false,
  paginated: false,
  request: { query: UsageQuery },
  response: { 200: UsageSummary },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-007', 'FR-AI-021', 'FR-AI-025'],
});
export const UsageCallsRoute = defineRoute({
  id: 'ai-gateway.usage.calls',
  ifId: 'IF-AI-036',
  method: 'GET',
  path: '/internal/v1/usage/calls',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: true,
  request: { query: CallLogQuery },
  response: { 200: Page(CallLogEntry) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-021'],
});
export const UsageBudgetRoute = defineRoute({
  id: 'ai-gateway.usage.budget',
  ifId: 'IF-AI-037',
  method: 'GET',
  path: '/internal/v1/usage/budget',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: BudgetView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-007'],
});
export const UsageBudgetPutRoute = defineRoute({
  id: 'ai-gateway.usage.budget_put',
  ifId: 'IF-AI-038',
  method: 'PUT',
  path: '/internal/v1/usage/budget',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PutBudgetBody },
  response: { 200: BudgetView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-007', 'FR-AI-025'],
});
export const AI_USAGE_ROUTES = [UsageSummaryRoute, UsageCallsRoute, UsageBudgetRoute, UsageBudgetPutRoute] as const;
