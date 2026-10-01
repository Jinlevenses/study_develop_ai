import { z } from 'zod';
import { SystemTaskId, TaskId } from '../ai/tasks.js';
import { ProviderId } from '../common/ids.js';
import { S } from '../common/schema.js';
import { StudyDay } from '../common/time.js';

const Rpm = S({ rpm: z.number().int().min(1), concurrency: z.number().int().min(1) });
const QuotaWin = S({
  five_hour_calls: z.number().int().min(0).nullable(),
  five_hour_tokens: z.number().int().min(0).nullable(),
  weekly_calls: z.number().int().min(0).nullable(),
});
export const AiPolicyV1 = S({
  version: z.literal('ai_policy@v1'),
  budget: S({
    monthly_krw: z.number().int().min(0),
    degrade_day: z.number().int().min(1).max(31),
    warn: z.number(),
    stop: z.number(),
    per_call_usd_cap: z.number().min(0).nullable(),
  }),
  jev: S({
    rps: z.number().int(),
    burst: z.number().int(),
    concurrency: z.number().int(),
    monthly_krw_cap: z.number().int().min(0),
    timeout_ms: S({ interactive: z.number().int(), background: z.number().int() }),
  }),
  bulk: S({ calls: z.number().int(), krw: z.number().int(), quota_pct: z.number() }), // 판정 = 엄격 초과(>)
  quota_windows: z.record(z.string().regex(/^(claude-cli|codex-cli|gemini-cli|gcli-\*)$/), QuotaWin),
  batch_window: S({ idle_min: z.number().int(), require_ac: z.boolean() }),
  yield_interactive_cli: S({ enabled: z.boolean(), resume_after_min: z.number().int() }),
  cli_concurrency: z.number().int().min(1),
  cli_per_minute: z.number().int().min(1),
  rate_limits: z.record(ProviderId, Rpm),
  aimd: S({ decrease: z.number(), recover_per_min: z.number() }),
  breaker: S({
    window_s: z.number().int(),
    failures: z.number().int(),
    error_rate: z.number(),
    min_calls: z.number().int(),
    open_s: z.number().int(),
    open_max_s: z.number().int(),
  }),
  mode: S({ upgrade_hold_s: z.number().int() }),
  cache_ttl_days: S({
    judge: z.number().int(),
    generate: z.number().int(),
    max: z.number().int(),
    per_task: z.record(z.union([TaskId, SystemTaskId]), z.number().int().min(0)),
  }),
  fx_krw_per_usd: z.number().positive(),
  pricing: S({
    as_of: StudyDay.nullable(),
    models: z.array(
      S({ provider: ProviderId, match: z.string().max(80), in: z.number(), out: z.number(), cache_read: z.number() }),
    ),
    unknown_model: S({ in: z.number(), out: z.number(), cache_read: z.number() }),
  }),
  cli_env: S({ pass_proxy: z.boolean() }),
  deadlines_ms: S({
    interactive_max: z.number().int(),
    conversational_max: z.number().int(),
    background_max: z.number().int(),
  }),
  work_order: S({ approval_ttl_days: z.number().int(), approved_ttl_days: z.number().int() }),
  confirm_cards: S({ per_day_max: z.number().int() }),
  calibration: S({
    gold_confirmed_min: z.number().int(),
    gold_confirmed_min_with_cross_review: z.number().int(),
    recalibrate_suggest_at: z.number().int(),
  }),
});
export type AiPolicyV1 = z.infer<typeof AiPolicyV1>;
