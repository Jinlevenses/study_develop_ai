import { z } from 'zod';
import { ContextBlock, ContextRef } from './data-class.js';
import { Level } from '../common/domain.js';
import { ConceptId, ItemId, KuId, MisconceptionId, ObjKey, ProviderId, SemVer, TrackId, Ulid } from '../common/ids.js';
import { ArtifactTemplateKind, DialogMove } from '../common/practice.js';
import { S } from '../common/schema.js';
import { DurationMs, EpochMs } from '../common/time.js';
import { ProviderFamily } from '../http/ai-gateway/v1/providers.js';
import { CostBasis } from '../http/ai-gateway/v1/usage.js';

export const GenerateRequest = S({
  lane: z.enum(['interactive', 'conversational']),                            // background는 IF-AI-010
  input: z.record(z.string(), z.unknown()),                                   // 2차 검증 = GENERATE_INPUTS[task_id] (AI-VAL-012)
  blocks: z.array(ContextBlock).max(64), context_ref: ContextRef,             // context_ref = blank_note·pre_submit → 403 AI-POLICY-001
  stream: z.boolean(), deadline_ms: z.number().int().min(100).max(120_000),
  family_exclude: z.array(ProviderFamily).max(4), local_only: z.boolean(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;
export const GenerateUnavailableReason = z.enum(['offline', 'no_consented_provider', 'auth_invalid', 'breaker_open', 'deadline', 'firewall_blocked',
  'budget_exhausted', 'quota_exhausted', 'task_disabled', 'provider_error', 'schema_violation', 'content_refused', 'busy']);
export type GenerateUnavailableReason = z.infer<typeof GenerateUnavailableReason>;
export const GenerateResult = z.discriminatedUnion('status', [
  S({ status: z.literal('ok'), output: z.record(z.string(), z.unknown()), schema_id: z.string().regex(/^ai\/[A-Za-z]+@\d+$/),
      provider_id: ProviderId, model: z.string().max(80), prompt_version: SemVer, repaired: z.boolean(), cache_hit: z.boolean(),
      call_id: Ulid, firewall_decision_id: Ulid, cost: S({ basis: CostBasis, krw: z.number().min(0), usd: z.number().min(0).nullable() }), latency_ms: DurationMs }),
  S({ status: z.literal('streaming'), stream_ref: Ulid, expires_at: EpochMs, provider_id: ProviderId, prompt_version: SemVer, call_id: Ulid }),
  S({ status: z.literal('unavailable'), reason: GenerateUnavailableReason, retry_after_ms: z.number().int().min(0).nullable() }),
]);
export type GenerateResult = z.infer<typeof GenerateResult>;
export const GenerateJobPayload = S({ input: z.record(z.string(), z.unknown()), blocks: z.array(ContextBlock).max(64),
  family_exclude: z.array(ProviderFamily).max(4), local_only: z.boolean() });
export type GenerateJobPayload = z.infer<typeof GenerateJobPayload>;

// 과업별 입력(GENERATE_INPUTS)
export const G01Input = S({ blueprint: S({ format: z.enum(['mcq', 'ox', 'cloze', 'short']), level: Level, bloom: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  count: z.number().int().min(1).max(5), target_ku_ids: z.array(KuId).min(1).max(10), forbidden: z.array(z.string().max(60)).max(10) }),
  recent_items_digest: z.array(z.string().max(200)).max(50) });
export type G01Input = z.infer<typeof G01Input>;
export const G02Input = S({ track: TrackId, level: Level, scenario_kind: z.enum(['incident', 'tradeoff', 'design']), target_ku_ids: z.array(KuId).max(20) });
export type G02Input = z.infer<typeof G02Input>;
export const G03Input = S({ lab_spec_md: z.string().max(8000), lang: z.enum(['js', 'ts']), complexity_target: z.string().max(20).nullable() });
export type G03Input = z.infer<typeof G03Input>;
export const G04Input = S({ item_id: ItemId, missing: z.array(z.enum(['explanation', 'per_option'])).min(1) });
export type G04Input = z.infer<typeof G04Input>;
export const G05Input = S({ chunk_keys: z.array(ObjKey).min(1).max(32), target_track: TrackId.nullable() });
export type G05Input = z.infer<typeof G05Input>;
export const G06Input = S({ verdict_id: Ulid, units: z.record(ObjKey, S({ status: z.enum(['correct', 'partial', 'missing', 'error']), ku_id: KuId.nullable() })) });
export type G06Input = z.infer<typeof G06Input>;
export const G07Input = S({ move: DialogMove, target_ku_id: KuId.nullable(), target_mc_id: MisconceptionId.nullable(),
  constraints: S({ max_sentences: z.literal(3), single_question: z.literal(true), no_answer: z.literal(true) }) });
export type G07Input = z.infer<typeof G07Input>;
export const G08Input = S({ concept_id: ConceptId, level: Level });
export type G08Input = z.infer<typeof G08Input>;
export const G09Input = S({ item_id: ItemId, count: z.number().int().min(1).max(5) });
export type G09Input = z.infer<typeof G09Input>;
export const G11Input = S({ item_id: ItemId });
export type G11Input = z.infer<typeof G11Input>;
export const G12Input = S({ target: z.discriminatedUnion('kind', [S({ kind: z.literal('item'), item_id: ItemId }), S({ kind: z.literal('concept'), concept_id: ConceptId })]),
  output_kind: z.enum(['model_answer', 'exemplar_note']) });
export type G12Input = z.infer<typeof G12Input>;
export const G13Input = S({ concept_id: ConceptId, artifact_kind: ArtifactTemplateKind.nullable() });
export type G13Input = z.infer<typeof G13Input>;
