import { z } from 'zod';
import { ProviderKind, ProviderStatus } from '../../../common/domain.js';
import { ProviderId, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';

// ProviderKind·ProviderStatus = common/domain.ts(CR-54 — ledger/payloads가 서비스 레인 파일을 import하지 않도록)
export const ProviderFamily = z.enum(['anthropic', 'openai', 'google', 'typesafe', 'local', 'other']);
export type ProviderFamily = z.infer<typeof ProviderFamily>;
export const ProbeResult = S({
  installed: z.boolean(),
  version: z.string().max(60).nullable(),
  logged_in: z.boolean().nullable(),
  flags_ok: z.boolean().nullable(),
  missing_flags: z.array(z.string().max(60)).max(20),
  key_present: z.boolean().nullable(),
  models: z.array(z.string().max(80)).max(50),
  latency_ms: DurationMs.nullable(),
  checked_at: EpochMs,
  reason_code: z.string().max(60).nullable(),
});
export type ProbeResult = z.infer<typeof ProbeResult>;
export const ProviderView = S({
  provider_id: ProviderId,
  kind: ProviderKind,
  family: ProviderFamily,
  display_name: z.string().max(60),
  status: ProviderStatus,
  consent: S({
    granted: z.boolean(),
    granted_at: EpochMs.nullable(),
    scopes: z.array(z.enum(['judge', 'generate', 'batch'])),
  }),
  probe: ProbeResult.nullable(),
  breaker: z.enum(['closed', 'open', 'half_open']),
  billing_mode: z.enum(['metered', 'subscription', 'free', 'local']),
  trust: z.enum(['verified', 'unverified']), // API·Jev·Ollama = verified, CLI는 canary 통과 시 verified
  models_by_tier: S({
    low: z.string().max(80).nullable(),
    mid: z.string().max(80).nullable(),
    high: z.string().max(80).nullable(),
  }),
  capabilities: S({
    structured_output: z.boolean(),
    json_schema_flag: z.boolean(),
    streaming: z.boolean(),
    multi_turn: z.boolean(),
  }),
  external_processor: z.boolean(), // 로컬(Ollama) = false
});
export type ProviderView = z.infer<typeof ProviderView>;
export const ProviderList = S({ providers: z.array(ProviderView).max(32) });
export type ProviderList = z.infer<typeof ProviderList>;
export const ProbeBody = S({ probe_id: Ulid, providers: z.array(ProviderId).max(16).nullable(), live: z.boolean() }); // live = doctor --live(소량 실호출, V-live)
export type ProbeBody = z.infer<typeof ProbeBody>;
export const ProbeRunView = S({
  probe_id: Ulid,
  state: z.enum(['running', 'done']),
  results: z.array(S({ provider_id: ProviderId, status: ProviderStatus, probe: ProbeResult })).max(32),
});
export type ProbeRunView = z.infer<typeof ProbeRunView>;
export const ConsentBody = S({ granted: z.boolean(), scopes: z.array(z.enum(['judge', 'generate', 'batch'])).max(3) });
export type ConsentBody = z.infer<typeof ConsentBody>;
export const ProviderConfigBody = S({
  enabled: z.boolean(),
  billing_mode: z.enum(['metered', 'subscription', 'free', 'local']),
  models_by_tier: S({
    low: z
      .string()
      .regex(/^[\w.\-:/]{1,80}$/)
      .nullable(),
    mid: z
      .string()
      .regex(/^[\w.\-:/]{1,80}$/)
      .nullable(),
    high: z
      .string()
      .regex(/^[\w.\-:/]{1,80}$/)
      .nullable(),
  }),
  base_url: z.string().url().nullable(), // ollama: http://127.0.0.1:11434/v1 만 허용(loopback), jev: https만
  max_concurrency: z.number().int().min(1).max(20).nullable(),
  pinned_model: z.string().max(80).nullable(), // jev: models.list에서 고른 고정 모델명
});
export type ProviderConfigBody = z.infer<typeof ProviderConfigBody>;
export const GenericCliDefinition = S({
  // = assets/cli-providers/*.yaml 형식(FR-AI-024)
  id: z.string().regex(/^gcli-[a-z0-9-]{2,24}$/),
  display_name: z.string().max(60),
  bin: z
    .string()
    .max(260)
    .regex(/^[A-Za-z0-9_./\\:-]+$/), // 셸 메타문자·공백 금지
  args: z.array(z.string().max(200)).max(32), // 치환 슬롯은 '{model}'만 — 그 밖의 '{...}' = 422 AI-VAL-012(프롬프트 슬롯 금지)
  stdin: z.literal('prompt'),
  extract: z.discriminatedUnion('kind', [
    S({ kind: z.literal('json_pointer'), pointer: z.string().regex(/^(\/[^/]*)*$/) }),
    S({ kind: z.literal('text') }),
  ]),
  probe: S({ args: z.array(z.string().max(60)).max(4), expect_regex: z.string().max(200).nullable() }),
  isolation: S({ flags: z.array(z.string().max(100)).max(16), home: z.enum(['empty_tmp', 'fathom_cli_home']) }),
  models: S({
    low: z.string().max(80).nullable(),
    mid: z.string().max(80).nullable(),
    high: z.string().max(80).nullable(),
  }),
  timeout_ms: z.number().int().min(1000).max(600_000),
  family: ProviderFamily,
  billing_mode: z.enum(['subscription', 'metered', 'free', 'local']),
});
export type GenericCliDefinition = z.infer<typeof GenericCliDefinition>;
export const ProvidersListRoute = defineRoute({
  id: 'ai-gateway.providers.list',
  ifId: 'IF-AI-025',
  method: 'GET',
  path: '/internal/v1/providers',
  allowedCallers: ['gateway', 'ops-api'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: ProviderList },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-AI-001', 'FR-AI-002'],
});
// idem = probe_id
export const ProvidersProbeRoute = defineRoute({
  id: 'ai-gateway.providers.probe',
  ifId: 'IF-AI-026',
  method: 'POST',
  path: '/internal/v1/providers:probe',
  allowedCallers: ['gateway', 'ops-api'],
  idempotent: true,
  paginated: false,
  request: { body: ProbeBody },
  response: { 202: ProbeRunView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-AI-001', 'FR-AI-015'],
});
export const ProvidersConsentRoute = defineRoute({
  id: 'ai-gateway.providers.consent',
  ifId: 'IF-AI-027',
  method: 'PUT',
  path: '/internal/v1/providers/{provider_id}/consent',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }), body: ConsentBody },
  response: { 200: ProviderView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-AI-003', 'D-14'],
});
export const ProvidersConfigRoute = defineRoute({
  id: 'ai-gateway.providers.config',
  ifId: 'IF-AI-028',
  method: 'PUT',
  path: '/internal/v1/providers/{provider_id}/config',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }), body: ProviderConfigBody },
  response: { 200: ProviderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-004', 'FR-AI-022', 'FR-AI-023'],
});
export const ProvidersGenericCliAddRoute = defineRoute({
  id: 'ai-gateway.providers.generic_cli_add',
  ifId: 'IF-AI-029',
  method: 'POST',
  path: '/internal/v1/providers/generic-cli',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: GenericCliDefinition },
  response: { 201: ProviderView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-024', 'IR-018'],
});
export const ProvidersGenericCliRemoveRoute = defineRoute({
  id: 'ai-gateway.providers.generic_cli_remove',
  ifId: 'IF-AI-034',
  method: 'DELETE',
  path: '/internal/v1/providers/generic-cli/{provider_id}',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ provider_id: ProviderId }) },
  response: { 204: z.null() },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-024'],
});
export const AI_PROVIDERS_ROUTES = [
  ProvidersListRoute,
  ProvidersProbeRoute,
  ProvidersConsentRoute,
  ProvidersConfigRoute,
  ProvidersGenericCliAddRoute,
  ProvidersGenericCliRemoveRoute,
] as const;
