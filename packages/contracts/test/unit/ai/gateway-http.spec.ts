import { describe, expect, it } from 'vitest';
import {
  CreateWorkOrderBody,
  DecideWorkOrderBody,
  WorkOrderPurpose,
  WorkOrderView,
} from '../../../src/ai/work-order.js';
import {
  CalibrationStatus,
  CalibrationStatusList,
  ConfirmCardList,
  ConfirmCardsQuery,
  ConfirmGoldBody,
  GoldExportLine,
  GoldExportQuery,
  GoldImportQuery,
  GoldImportResult,
  GoldItemView,
  RunCalibrationBody,
} from '../../../src/http/ai-gateway/v1/calibration.js';
import {
  FirewallAction,
  FirewallLogEntry,
  FirewallPatterns,
  FirewallPreviewBody,
  FirewallPreviewResult,
  PutFirewallPatternsBody,
  UserPattern,
} from '../../../src/http/ai-gateway/v1/firewall.js';
import {
  CreateJobBody,
  JobItemKey,
  JobListQuery,
  JobResultPage,
  JobView,
} from '../../../src/http/ai-gateway/v1/jobs.js';
import { AiPreferences, ModeReason, ModeView } from '../../../src/http/ai-gateway/v1/mode.js';
import {
  ConsentBody,
  GenericCliDefinition,
  ProbeBody,
  ProbeRunView,
  ProviderConfigBody,
  ProviderList,
  ProviderView,
} from '../../../src/http/ai-gateway/v1/providers.js';
import { PutSecretBody, SecretList, SecretMeta, UnlockSecretsBody } from '../../../src/http/ai-gateway/v1/secrets.js';
import {
  BudgetView,
  CallLogEntry,
  CallLogQuery,
  PutBudgetBody,
  UsageQuery,
  UsageSummary,
} from '../../../src/http/ai-gateway/v1/usage.js';
import { WorkOrderListQuery } from '../../../src/http/ai-gateway/v1/work-orders.js';
import { contextRef, generateJobPayload, judgeJobPayload, judgeOk, noulAnswer, SHA, ULID, ULID_B } from './samples.js';

const woView = {
  work_order_id: ULID,
  purpose: 'import',
  requested_by: 'content',
  state: 'approval_required',
  tasks: [{ task_id: 'AI-G05', calls: 80 }],
  estimate: { calls: 80, krw: 1200, quota_pct: 25, duration_s: 600 },
  threshold_exceeded: { calls: true, krw: true, quota: true },
  reservation: null,
  usage: { calls: 0, krw: 0 },
  created_at: 1,
  decided_at: null,
  decided_by: null,
};

describe('ai/work-order.ts', () => {
  it('UT-CON-142 WorkOrderPurpose 10, CreateWorkOrderBody.tasks 0개 거부, WorkOrderView, DecideWorkOrderBody [FR-AI-026]', () => {
    expect(WorkOrderPurpose.options).toHaveLength(10);
    const create = {
      work_order_id: ULID,
      purpose: 'generation',
      requested_by: 'user',
      context_ref: contextRef,
      tasks: [{ task_id: 'AI-G01', calls: 10, est_input_tokens: null, est_output_tokens: 500 }],
    };
    expect(CreateWorkOrderBody.safeParse(create).success).toBe(true);
    expect(CreateWorkOrderBody.safeParse({ ...create, tasks: [] }).success).toBe(false);
    expect(CreateWorkOrderBody.safeParse({ ...create, tasks: Array(21).fill(create.tasks[0]) }).success).toBe(false);
    expect(CreateWorkOrderBody.safeParse({ ...create, tasks: [{ ...create.tasks[0], calls: 0 }] }).success).toBe(false);
    expect(
      CreateWorkOrderBody.safeParse({ ...create, tasks: [{ ...create.tasks[0], task_id: 'SYS-CANARY' }] }).success,
    ).toBe(false);
    expect(CreateWorkOrderBody.safeParse({ ...create, purpose: 'chat' }).success).toBe(false);
    expect(CreateWorkOrderBody.safeParse({ ...create, requested_by: 'learning' }).success).toBe(false);

    expect(WorkOrderView.safeParse(woView).success).toBe(true);
    expect(WorkOrderView.safeParse({ ...woView, reservation: { calls: 80, krw: 1200, expires_at: 9 } }).success).toBe(
      true,
    );
    expect(WorkOrderView.safeParse({ ...woView, state: 'pending' }).success).toBe(false);
    expect(WorkOrderView.safeParse({ ...woView, estimate: { ...woView.estimate, quota_pct: 101 } }).success).toBe(
      false,
    );
    expect(WorkOrderView.safeParse({ ...woView, extra: 1 }).success).toBe(false);

    expect(DecideWorkOrderBody.safeParse({ decision: 'approve', cap: null }).success).toBe(true);
    expect(DecideWorkOrderBody.safeParse({ decision: 'approve', cap: { calls: 10, krw: null } }).success).toBe(true);
    expect(DecideWorkOrderBody.safeParse({ decision: 'approve', cap: { calls: -1, krw: null } }).success).toBe(false);
    expect(DecideWorkOrderBody.safeParse({ decision: 'defer', cap: null }).success).toBe(false);
    expect(WorkOrderListQuery.parse({}).limit).toBe(50);
    expect(WorkOrderListQuery.safeParse({ state: 'approved' }).success).toBe(true);
    expect(WorkOrderListQuery.safeParse({ state: 'x' }).success).toBe(false);
  });
});

const createJob = {
  job_id: ULID,
  kind: 'judge',
  task_id: 'AI-J03',
  work_order_id: ULID_B,
  priority: 'normal',
  not_before: null,
  dedupe_key: null,
  context_ref: contextRef,
  items: [{ item_key: 'item-01', judge: judgeJobPayload, generate: null }],
};
const jobView = {
  job_id: ULID,
  kind: 'generate',
  task_id: 'AI-G05',
  work_order_id: ULID_B,
  state: 'queued',
  items_total: 3,
  items_done: 0,
  items_failed: 0,
  attempts: 0,
  created_at: 1,
  started_at: null,
  finished_at: null,
  next_attempt_at: null,
  outcome: null,
  result_ref: null,
  prompt_version: null,
  last_error: null,
};

describe('ai-gateway jobs.ts', () => {
  it('UT-CON-143 JobItemKey, CreateJobBody kind 불일치 거부(issue path [items,0,judge]), JobView.attempts 4 거부, JobResultPage [FR-AI-010]', () => {
    expect(JobItemKey.safeParse('k8s.probes.i01#2').success).toBe(true);
    expect(JobItemKey.safeParse('Upper').success).toBe(false);
    expect(JobItemKey.safeParse('').success).toBe(false);
    expect(JobItemKey.safeParse('a'.repeat(161)).success).toBe(false);

    expect(CreateJobBody.safeParse(createJob).success).toBe(true);
    const generateJob = {
      ...createJob,
      kind: 'generate',
      task_id: 'AI-G05',
      items: [{ item_key: 'item-01', judge: null, generate: generateJobPayload }],
    };
    expect(CreateJobBody.safeParse(generateJob).success).toBe(true);

    // kind='judge'인데 judge 없음·generate 있음 → path ['items', 0, 'judge']
    const mismatch = CreateJobBody.safeParse({
      ...createJob,
      items: [{ item_key: 'item-01', judge: null, generate: generateJobPayload }],
    });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues.map((i) => i.path)).toContainEqual(['items', 0, 'judge']);
    expect(mismatch.error?.issues.some((i) => i.message === 'payload does not match kind')).toBe(true);
    // 둘 다 있어도 위반, 반대 방향은 path가 'generate'
    expect(
      CreateJobBody.safeParse({
        ...createJob,
        items: [{ item_key: 'item-01', judge: judgeJobPayload, generate: generateJobPayload }],
      }).success,
    ).toBe(false);
    const reverse = CreateJobBody.safeParse({
      ...generateJob,
      items: [{ item_key: 'item-01', judge: judgeJobPayload, generate: null }],
    });
    expect(reverse.error?.issues.map((i) => i.path)).toContainEqual(['items', 0, 'generate']);
    // 둘째 항목만 위반이면 path의 인덱스는 1
    const second = CreateJobBody.safeParse({
      ...createJob,
      items: [createJob.items[0], { item_key: 'item-02', judge: null, generate: null }],
    });
    expect(second.error?.issues.map((i) => i.path)).toEqual([['items', 1, 'judge']]);
    expect(CreateJobBody.safeParse({ ...createJob, items: [] }).success).toBe(false);
    expect(CreateJobBody.safeParse({ ...createJob, priority: 'urgent' }).success).toBe(false);
    expect(CreateJobBody.safeParse({ ...createJob, extra: 1 }).success).toBe(false);

    expect(JobView.safeParse(jobView).success).toBe(true);
    expect(JobView.safeParse({ ...jobView, attempts: 3 }).success).toBe(true);
    expect(JobView.safeParse({ ...jobView, attempts: 4 }).success).toBe(false);
    expect(JobView.safeParse({ ...jobView, state: 'paused' }).success).toBe(false);
    expect(JobView.safeParse({ ...jobView, last_error: 'TIMEOUT' }).success).toBe(true);
    expect(JobView.safeParse({ ...jobView, last_error: 'OOPS' }).success).toBe(false);

    const page = {
      job_id: ULID,
      task_id: 'AI-J03',
      items: [{ item_key: 'item-01', status: 'ok', judge: judgeOk, generate: null }],
      next_cursor: null,
    };
    expect(JobResultPage.safeParse(page).success).toBe(true);
    expect(JobResultPage.safeParse({ ...page, items: [{ ...page.items[0], status: 'pending' }] }).success).toBe(false);
    expect(JobResultPage.safeParse({ ...page, items: Array(201).fill(page.items[0]) }).success).toBe(false);
    expect(JobListQuery.parse({}).limit).toBe(50);
    expect(JobListQuery.safeParse({ state: 'waiting_window', task_id: 'AI-G01' }).success).toBe(true);
  });
});

const providerView = {
  provider_id: 'anthropic-api',
  kind: 'llm_api',
  family: 'anthropic',
  display_name: 'Anthropic API',
  status: 'ok',
  consent: { granted: true, granted_at: 1, scopes: ['judge', 'generate'] },
  probe: null,
  breaker: 'closed',
  billing_mode: 'metered',
  trust: 'verified',
  models_by_tier: { low: 'haiku', mid: null, high: null },
  capabilities: { structured_output: true, json_schema_flag: false, streaming: true, multi_turn: true },
  external_processor: true,
};
const cli = {
  id: 'gcli-mytool',
  display_name: '내 도구',
  bin: '/usr/local/bin/mytool',
  args: ['--model', '{model}'],
  stdin: 'prompt',
  extract: { kind: 'json_pointer', pointer: '/result' },
  probe: { args: ['--version'], expect_regex: null },
  isolation: { flags: ['--no-tools'], home: 'empty_tmp' },
  models: { low: null, mid: null, high: null },
  timeout_ms: 60_000,
  family: 'other',
  billing_mode: 'subscription',
};

describe('ai-gateway providers.ts', () => {
  it('UT-CON-144 ProviderView, ProviderConfigBody.models_by_tier 공백 포함 거부, GenericCliDefinition(id gcli-x 거부·bin a;b 거부·stdin 리터럴) [FR-AI-024][IR-018]', () => {
    expect(ProviderView.safeParse(providerView).success).toBe(true);
    expect(ProviderView.safeParse({ ...providerView, provider_id: 'foo-api' }).success).toBe(false);
    expect(ProviderView.safeParse({ ...providerView, status: 'broken' }).success).toBe(false);
    expect(ProviderList.safeParse({ providers: [providerView] }).success).toBe(true);
    expect(ProbeBody.safeParse({ probe_id: ULID, providers: null, live: false }).success).toBe(true);
    expect(ProbeBody.safeParse({ probe_id: ULID, providers: ['jev'], live: true }).success).toBe(true);
    expect(ProbeRunView.safeParse({ probe_id: ULID, state: 'running', results: [] }).success).toBe(true);
    expect(ConsentBody.safeParse({ granted: true, scopes: ['judge'] }).success).toBe(true);
    expect(ConsentBody.safeParse({ granted: true, scopes: ['judge', 'generate', 'batch', 'judge'] }).success).toBe(
      false,
    );

    const cfg = {
      enabled: true,
      billing_mode: 'local',
      models_by_tier: { low: 'llama3.2:3b', mid: null, high: 'org/model-x' },
      base_url: 'http://127.0.0.1:11434/v1',
      max_concurrency: 1,
      pinned_model: null,
    };
    expect(ProviderConfigBody.safeParse(cfg).success).toBe(true);
    expect(
      ProviderConfigBody.safeParse({ ...cfg, models_by_tier: { ...cfg.models_by_tier, low: 'llama 3' } }).success,
    ).toBe(false);
    expect(
      ProviderConfigBody.safeParse({ ...cfg, models_by_tier: { ...cfg.models_by_tier, mid: 'a'.repeat(81) } }).success,
    ).toBe(false);
    expect(ProviderConfigBody.safeParse({ ...cfg, max_concurrency: 21 }).success).toBe(false);
    expect(ProviderConfigBody.safeParse({ ...cfg, base_url: 'not a url' }).success).toBe(false);

    expect(GenericCliDefinition.safeParse(cli).success).toBe(true);
    expect(GenericCliDefinition.safeParse({ ...cli, id: 'gcli-x' }).success).toBe(false); // 접미 2~24자
    expect(GenericCliDefinition.safeParse({ ...cli, id: 'mytool' }).success).toBe(false);
    expect(GenericCliDefinition.safeParse({ ...cli, bin: 'a;b' }).success).toBe(false); // 셸 메타문자 금지
    expect(GenericCliDefinition.safeParse({ ...cli, bin: 'my tool' }).success).toBe(false); // 공백 금지
    expect(GenericCliDefinition.safeParse({ ...cli, bin: 'C:\\tools\\mytool.exe' }).success).toBe(true);
    expect(GenericCliDefinition.safeParse({ ...cli, stdin: 'argv' }).success).toBe(false); // 비밀·프롬프트는 stdin만
    expect(GenericCliDefinition.safeParse({ ...cli, extract: { kind: 'text' } }).success).toBe(true);
    expect(
      GenericCliDefinition.safeParse({ ...cli, extract: { kind: 'json_pointer', pointer: 'result' } }).success,
    ).toBe(false);
    expect(GenericCliDefinition.safeParse({ ...cli, timeout_ms: 999 }).success).toBe(false);
    expect(GenericCliDefinition.safeParse({ ...cli, extra: 1 }).success).toBe(false);
  });
});

const usage = {
  period: 'month',
  period_start: '2026-10-01',
  money: {
    krw_spent: 1000,
    krw_budget: 30000,
    ratio: 0.03,
    split: { metered_krw: 800, subscription_nominal_krw: 200 },
  },
  quota: [{ provider_id: 'claude-cli', window: '5h', used_pct: 10, resets_at: null }],
  by_task: [{ task_id: 'AI-J03', calls: 5, krw: 10, p95_ms: 900, fail_rate: 0, fallback_rate: 0.1 }],
  by_provider: [{ provider_id: 'jev', calls: 5, krw: 10 }],
  accepted_item_cost_krw: null,
};
const callLog = {
  call_id: ULID,
  ts: 1,
  task_id: 'AI-J03',
  provider_id: 'jev',
  model: 'jev-1',
  family: 'typesafe',
  transport: 'jev',
  input_tokens: null,
  output_tokens: null,
  cost: { basis: 'free', krw: 0, usd: null },
  latency_ms: 100,
  outcome: 'ok',
  error_class: null,
  cache_hit: false,
  prompt_version: '1.0.0',
  firewall_action: 'pass',
  firewall_decision_id: ULID_B,
  data_class: 'C0',
  external_processor: true,
  route_trace: [{ provider_id: 'jev', decision: 'selected', reason: 'primary' }],
};

describe('ai-gateway secrets.ts · usage.ts', () => {
  it('UT-CON-145 PutSecretBody.secret 7자 거부, SecretMeta.last4 길이 4, CallLogEntry.task_id SYS-CANARY 통과, UsageSummary [NFR-SEC-004][FR-AI-007]', () => {
    expect(PutSecretBody.safeParse({ secret: 'a'.repeat(8), store: 'auto', verify: true }).success).toBe(true);
    expect(PutSecretBody.safeParse({ secret: 'a'.repeat(7), store: 'auto', verify: true }).success).toBe(false);
    expect(PutSecretBody.safeParse({ secret: 'a'.repeat(4097), store: 'file', verify: false }).success).toBe(false);
    expect(PutSecretBody.safeParse({ secret: 'a'.repeat(8), store: 'env', verify: false }).success).toBe(false);
    const meta = { provider_id: 'anthropic-api', source: 'keychain', last4: 'abcd', verified_at: null };
    expect(SecretMeta.safeParse(meta).success).toBe(true);
    expect(SecretMeta.safeParse({ ...meta, last4: 'abc' }).success).toBe(false);
    expect(SecretMeta.safeParse({ ...meta, last4: 'abcde' }).success).toBe(false);
    expect(SecretMeta.safeParse({ ...meta, secret: 'sk-leak' }).success).toBe(false); // 비밀 원문 필드 없음
    expect(
      SecretList.safeParse({ secrets: [meta], store: { backend: 'file', locked: false, kek_kind: 'passphrase' } })
        .success,
    ).toBe(true);
    expect(UnlockSecretsBody.safeParse({ passphrase: 'a'.repeat(12) }).success).toBe(true);
    expect(UnlockSecretsBody.safeParse({ passphrase: 'a'.repeat(11) }).success).toBe(false);

    expect(CallLogEntry.safeParse(callLog).success).toBe(true);
    expect(CallLogEntry.safeParse({ ...callLog, task_id: 'SYS-CANARY' }).success).toBe(true);
    expect(CallLogEntry.safeParse({ ...callLog, task_id: 'SYS-OTHER' }).success).toBe(false);
    expect(CallLogEntry.safeParse({ ...callLog, firewall_action: 'drop' }).success).toBe(false);
    expect(CallLogEntry.safeParse({ ...callLog, transport: 'grpc' }).success).toBe(false);
    expect(CallLogQuery.safeParse({ task_id: 'AI-J01', outcome: 'cache_hit' }).success).toBe(true);
    expect(CallLogQuery.safeParse({ outcome: 'weird' }).success).toBe(false);

    expect(UsageSummary.safeParse(usage).success).toBe(true);
    expect(UsageSummary.safeParse({ ...usage, period: 'week' }).success).toBe(false);
    expect(UsageSummary.safeParse({ ...usage, quota: [{ ...usage.quota[0], window: '1h' }] }).success).toBe(false);
    expect(UsageQuery.parse({}).period).toBe('month');
    expect(UsageQuery.safeParse({ period: 'day' }).success).toBe(true);
    expect(UsageQuery.safeParse({ period: 'year' }).success).toBe(false);
    const budget = {
      monthly_krw: 30000,
      warn_ratio: 0.8,
      hard_stop_ratio: 1,
      degrade_day: 20,
      per_call_usd_cap: 0.5,
      bulk_threshold: { calls: 50, krw: 1000, quota_pct: 20 },
      subscription_windows: { five_hour_calls: 30, weekly_calls: null },
      batch_window: { idle_min: 10, require_ac: true },
    };
    expect(BudgetView.safeParse(budget).success).toBe(true);
    expect(BudgetView.safeParse({ ...budget, degrade_day: 32 }).success).toBe(false);
    expect(PutBudgetBody.safeParse({ monthly_krw: 30000, per_call_usd_cap: null }).success).toBe(true);
    expect(PutBudgetBody.safeParse({ monthly_krw: 10_000_001, per_call_usd_cap: null }).success).toBe(false);
    expect(
      PutBudgetBody.safeParse({
        monthly_krw: 1,
        per_call_usd_cap: null,
        bulk_threshold: { calls: 0, krw: 0, quota_pct: 20 },
      }).success,
    ).toBe(false);
  });
});

const confirmCard = {
  gold_id: 'gold.AI-J03.017',
  task_id: 'AI-J03',
  question_key: 'q01',
  prompt_ko: '이 라벨이 맞나요?',
  state_preview_md: '미리보기',
  model_label: noulAnswer,
};

describe('ai-gateway mode.ts · calibration.ts', () => {
  it('UT-CON-146 ModeReason 14, ModeView, ConfirmCardList.cards 4개 거부, GoldExportLine 3종 [FR-AI-002][FR-AI-013]', () => {
    expect(ModeReason.options).toHaveLength(14);
    expect(ModeReason.safeParse('gateway_unreachable').success).toBe(true);
    const mode = {
      mode: 'OFFLINE',
      previous_mode: null,
      reasons: ['first_boot'],
      providers: [{ id: 'jev', kind: 'jev', status: 'unconsented' }],
      changed_at: 1,
      safe_mode: false,
    };
    expect(ModeView.safeParse(mode).success).toBe(true);
    expect(ModeView.safeParse({ ...mode, mode: 'ONLINE' }).success).toBe(false);
    expect(ModeView.safeParse({ ...mode, reasons: Array(11).fill('first_boot') }).success).toBe(false);
    expect(
      AiPreferences.safeParse({
        local_only_families: ['import'],
        pinned: { generation: null, explanation: null, dialog: null, import: 'ollama' },
        batch_enabled: true,
        yield_to_interactive_cli: true,
      }).success,
    ).toBe(true);

    expect(ConfirmCardList.safeParse({ cards: [confirmCard], remaining_today: 2 }).success).toBe(true);
    expect(ConfirmCardList.safeParse({ cards: Array(3).fill(confirmCard), remaining_today: 0 }).success).toBe(true);
    expect(ConfirmCardList.safeParse({ cards: Array(4).fill(confirmCard), remaining_today: 0 }).success).toBe(false);
    expect(ConfirmCardsQuery.parse({}).limit).toBe(3);
    expect(ConfirmCardsQuery.safeParse({ limit: '4' }).success).toBe(false);
    expect(ConfirmGoldBody.safeParse({ decision: 'correct', corrected_label: noulAnswer }).success).toBe(true);
    expect(ConfirmGoldBody.safeParse({ decision: 'maybe', corrected_label: null }).success).toBe(false);
    expect(GoldItemView.safeParse({ gold_id: ULID, task_id: 'AI-J01', state: 'skipped', updated_at: 1 }).success).toBe(
      true,
    );
    expect(RunCalibrationBody.safeParse({ job_id: ULID, task_id: 'AI-J03', work_order_id: ULID_B }).success).toBe(true);
    expect(RunCalibrationBody.safeParse({ job_id: ULID, task_id: 'AI-G03', work_order_id: ULID_B }).success).toBe(
      false,
    ); // 판정 과업만
    const status = {
      task_id: 'AI-J03',
      engine: 'J',
      calibrated: false,
      sp1_state: 'unknown',
      gold: { draft: 3, confirmed: 2, required: 20 },
      metrics: null,
      model_version: null,
      drift: false,
      last_run_at: null,
    };
    expect(CalibrationStatus.safeParse(status).success).toBe(true);
    expect(CalibrationStatusList.safeParse({ tasks: [status] }).success).toBe(true);

    const lines = [
      { kind: 'header', v: 1, generated_at: 1, since: null },
      {
        kind: 'gold',
        item: {
          gold_id: 'gold.AI-J03.017',
          task_id: 'AI-J03',
          template_version: '1.0.0',
          state: { key_points: { kp01: '핵심' } },
          question_key: 'q01',
          label: noulAnswer,
          label_state: 'user_confirmed',
          confirmed_at: 5,
        },
      },
      { kind: 'end', count: 1, sha256: SHA },
    ];
    for (const l of lines) {
      expect(GoldExportLine.safeParse(l).success, l.kind).toBe(true);
    }
    expect(GoldExportLine.safeParse({ kind: 'other' }).success).toBe(false);
    expect(GoldExportLine.safeParse({ ...lines[0], v: 2 }).success).toBe(false);
    expect(GoldExportQuery.safeParse({ since: '10' }).success).toBe(true);
    expect(GoldImportQuery.safeParse({ import_id: ULID }).success).toBe(true);
    expect(GoldImportResult.safeParse({ import_id: ULID, inserted: 1, skipped: 0 }).success).toBe(true);
  });
});

describe('ai-gateway firewall.ts', () => {
  it('UT-CON-147 FirewallAction 4, FirewallPatterns.user_patterns[]에 created_at 없으면 거부, FirewallPreviewResult.masks[].token ⟨SECRET_3⟩ 통과·<SECRET_3> 거부 [FR-AI-019]', () => {
    expect(FirewallAction.options).toEqual(['pass', 'masked', 'force_local', 'block']);
    const user = { pattern_id: ULID, kind: 'domain', value: 'acme.co.kr' };
    expect(UserPattern.safeParse(user).success).toBe(true);
    expect(UserPattern.safeParse({ ...user, value: 'a' }).success).toBe(false);
    expect(UserPattern.safeParse({ ...user, kind: 'ssn' }).success).toBe(false);
    const patterns = {
      builtin_policy: 'firewall_rules@v1',
      builtin_rule_ids: ['FW-SEC-001'],
      user_patterns: [{ ...user, created_at: 1 }],
      local_classifier: { enabled: false, provider_id: null },
    };
    expect(FirewallPatterns.safeParse(patterns).success).toBe(true);
    expect(FirewallPatterns.safeParse({ ...patterns, user_patterns: [user] }).success).toBe(false); // created_at 필수
    expect(
      FirewallPatterns.safeParse({ ...patterns, local_classifier: { enabled: true, provider_id: 'openai-api' } })
        .success,
    ).toBe(false);
    expect(
      FirewallPatterns.safeParse({ ...patterns, local_classifier: { enabled: true, provider_id: 'ollama' } }).success,
    ).toBe(true);
    expect(PutFirewallPatternsBody.safeParse({ user_patterns: [user], local_classifier_enabled: true }).success).toBe(
      true,
    );
    expect(
      PutFirewallPatternsBody.safeParse({ user_patterns: [{ ...user, created_at: 1 }], local_classifier_enabled: true })
        .success,
    ).toBe(false);

    const result = {
      action: 'masked',
      data_class: 'C1',
      masks: [{ block_key: 'answer', start: 0, end: 5, token: '⟨SECRET_3⟩', rule_id: 'FW-SEC-001' }],
      masked_blocks: [{ key: 'answer', text: '⟨SECRET_3⟩ 입니다' }],
    };
    expect(FirewallPreviewResult.safeParse(result).success).toBe(true);
    expect(
      FirewallPreviewResult.safeParse({ ...result, masks: [{ ...result.masks[0], token: '<SECRET_3>' }] }).success,
    ).toBe(false);
    expect(
      FirewallPreviewResult.safeParse({ ...result, masks: [{ ...result.masks[0], token: '⟨SECRET_⟩' }] }).success,
    ).toBe(false);
    expect(
      FirewallPreviewResult.safeParse({ ...result, masks: [{ ...result.masks[0], token: '⟨SECRET_12345⟩' }] }).success,
    ).toBe(false);
    const block = { key: 'answer', text: '내 키는 sk-...', data_class: 'C1', untrusted: true, source_ref: null };
    expect(FirewallPreviewBody.safeParse({ blocks: [block], route: 'external' }).success).toBe(true);
    expect(FirewallPreviewBody.safeParse({ blocks: [], route: 'external' }).success).toBe(false);
    expect(FirewallPreviewBody.safeParse({ blocks: [block], route: 'edge' }).success).toBe(false);
    const log = {
      decision_id: ULID,
      ts: 1,
      task_id: null,
      provider_id: null,
      data_class: 'C3',
      rule_hits: ['FW-SEC-001'],
      action: 'block',
    };
    expect(FirewallLogEntry.safeParse(log).success).toBe(true);
    expect(FirewallLogEntry.safeParse({ ...log, matched_text: 'sk-secret' }).success).toBe(false); // 매칭 원문 필드 없음
  });
});
