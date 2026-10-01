import { z } from 'zod';
import { AiMode, Facet, FormatId, Level, ModeId, ResponseMode, Stakes, Tier } from '../../../../common/domain.js';
import { ArtifactId, CaseId, ConceptId, ItemId, KuId, ObjKey, Sha256Hex, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { EpochMs } from '../../../../common/time.js';
import { ArtifactRuntimePreSubmit, CaseRuntimePreSubmit } from './case.js';

export const ItemBodyPreSubmit = z.discriminatedUnion('kind', [
  S({ kind: z.literal('ox') }),
  S({ kind: z.literal('choice'), options: z.record(ObjKey, S({ text_md: z.string().max(2000) })), order: z.array(ObjKey).min(2).max(10), multi: z.boolean() }),
  S({ kind: z.literal('text'), max_chars: z.number().int().min(1).max(2000), placeholder_ko: z.string().max(100).nullable() }),
  S({ kind: z.literal('cloze'), template_md: z.string().max(8000), blanks: z.record(ObjKey, S({ max_chars: z.number().int().min(1).max(500) })) }), // 템플릿 안 '{{blank:<key>}}'
  S({ kind: z.literal('matching'), left: z.record(ObjKey, z.string().max(500)), right: z.record(ObjKey, z.string().max(500)) }),
  S({ kind: z.literal('code'), lang: z.enum(['js', 'ts']), mode: z.enum(['write', 'predict_output', 'fix']), starter: z.string().max(65_536),
      public_tests_md: z.string().max(8000).nullable(), runnable: z.boolean() }),
  S({ kind: z.literal('sql'), schema_md: z.string().max(8000), starter: z.string().max(65_536), runnable: z.boolean() }),
  S({ kind: z.literal('positions'), lines: z.record(ObjKey, z.string().max(1000)), order: z.array(ObjKey).max(400), max_select: z.number().int().min(1).max(20) }),
  S({ kind: z.literal('numeric'), unit_hint: z.string().max(40).nullable() }),
  S({ kind: z.literal('essay'), min_chars: z.number().int().min(0), max_chars: z.number().int().max(40_000), kp_count: z.number().int().nullable(),
      rubric_dims: z.array(S({ key: ObjKey, label_ko: z.string().max(60) })).max(10) }),
  S({ kind: z.literal('cond_pair'), parts: S({ a: S({ stem_md: z.string().max(4000), options: z.record(ObjKey, S({ text_md: z.string().max(1000) })) }),
      b: S({ stem_md: z.string().max(4000), options: z.record(ObjKey, S({ text_md: z.string().max(1000) })) }) }), pivot_required: z.boolean() }),
  S({ kind: z.literal('review'), diff_md: z.string().max(65_536), lines: z.record(ObjKey, z.string().max(1000)), order: z.array(ObjKey).max(2000) }),
  S({ kind: z.literal('authoring'), target_ku_ids: z.array(KuId).min(1).max(5), item_format: z.enum(['mcq', 'ox', 'short']) }),
  S({ kind: z.literal('case_decision'), node_key: ObjKey, options: z.record(ObjKey, S({ text_md: z.string().max(2000) })), order: z.array(ObjKey).max(6),
      rationale: z.enum(['none', 'optional', 'required']) }),
]);
export type ItemBodyPreSubmit = z.infer<typeof ItemBodyPreSubmit>;
export const ItemDeliveryPreSubmit = S({
  item_id: ItemId, item_content_hash: Sha256Hex, format: FormatId, mode_id: ModeId,
  concept_id: ConceptId, ku_ids: z.array(KuId).max(20), facet: Facet, response_mode: ResponseMode, tier: Tier, level: Level, stakes: Stakes,
  n_options: z.number().int().min(0),                                             // 추측 보정 c = 1/n (0 = 열린 형식, SP-6 F0)
  stem_md: z.string().max(8000), body: ItemBodyPreSubmit,
  confidence_required: z.boolean(), time_limit_ms: z.number().int().min(1000).nullable(), hints_available: z.number().int().min(0).max(4),
  lineage: S({ source_kind: z.enum(['seed', 't1', 't2', 't3', 't4', 'imported', 'user']), trust: z.enum(['seed', 'verified', 'user', 'llm_unverified']) }),
});
export type ItemDeliveryPreSubmit = z.infer<typeof ItemDeliveryPreSubmit>;
export const SelectSlot = S({
  slot_id: Ulid, kind: z.enum(['items', 'blank_note', 'lab', 'case', 'artifact', 'd4_mcq', 'embedded', 'pretest']),
  concept_id: ConceptId.nullable(), level: Level, mode_id: ModeId, format_candidates: z.array(FormatId).min(1).max(10),
  count: z.number().int().min(1).max(20), target_beta: z.number().nullable(),                 // 적응 난이도(θ̃ 기반)
  response_mode: ResponseMode.nullable(), facet: Facet.nullable(),
  case_id: CaseId.nullable(), variant_seed: z.number().int().min(0).nullable(), artifact_id: ArtifactId.nullable(),
  engine_constraints: S({ calibrated_only: z.boolean(), deterministic_only: z.boolean() }),
});
export type SelectSlot = z.infer<typeof SelectSlot>;
export const SelectItemsRequest = S({
  session_id: Ulid, ai_mode_observed: AiMode, slots: z.array(SelectSlot).min(1).max(60),
  exclude_item_ids: z.array(ItemId).max(2000), exclude_stem_families: z.array(z.string().max(80)).max(500),
});
export type SelectItemsRequest = z.infer<typeof SelectItemsRequest>;
export const SelectItemsResponse = S({
  selected_at: EpochMs, ai_mode: AiMode, runner_enabled: z.boolean(),
  slots: z.array(S({
    slot_id: Ulid, status: z.enum(['ok', 'partial', 'empty']), format_used: FormatId.nullable(),
    items: z.array(ItemDeliveryPreSubmit).max(20),
    case_runtime: CaseRuntimePreSubmit.nullable(), artifact_runtime: ArtifactRuntimePreSubmit.nullable(),
    shortfall: z.enum(['no_pool', 'runner_platform_disabled', 'gate_deferred', 'excluded', 'calibrated_engine_unavailable']).nullable(),
  })),
});
export type SelectItemsResponse = z.infer<typeof SelectItemsResponse>;
