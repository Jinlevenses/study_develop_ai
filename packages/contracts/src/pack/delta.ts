import { z } from 'zod';
import { ConceptId, ItemId, PackId, SemVer, Sha256Hex, Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { GateStatus } from '../http/content/v1/itembank.js';
import { BlueprintRecord, CaseRecord, ConceptRecord, ItemModelRecord, ItemRecord, KuRecord, MisconceptionRecord, SourceRecord } from './records.js';

const Base = { base_version: Sha256Hex.nullable() };                         // null = 신규 생성
export const PackDeltaOp = z.discriminatedUnion('op', [
  S({ op: z.literal('upsert_concept'), ...Base, record: ConceptRecord }),
  S({ op: z.literal('upsert_ku'), ...Base, record: KuRecord }),
  S({ op: z.literal('alias'), ...Base, concept_id: ConceptId, alias: z.string().max(80) }),
  S({ op: z.literal('deprecate'), ...Base, target_kind: z.enum(['concept', 'ku', 'misconception', 'item']), target_id: z.string().max(160), deprecated_by: z.string().max(160).nullable() }),
  S({ op: z.literal('upsert_misconception'), ...Base, record: MisconceptionRecord }),
  S({ op: z.literal('upsert_item_model'), ...Base, record: ItemModelRecord }),
  S({ op: z.literal('publish_items'), ...Base, records: z.array(ItemRecord).min(1).max(500) }),
  S({ op: z.literal('set_gate_status'), ...Base, item_id: ItemId, gate_status: GateStatus, gate_result_id: Ulid }),
  S({ op: z.literal('quarantine_family'), ...Base, stem_family: z.string().max(80), prompt_version: SemVer.nullable(), evidence_policy: z.enum(['void', 'halve', 'keep']) }),
  S({ op: z.literal('upsert_case'), ...Base, record: CaseRecord }),
  S({ op: z.literal('upsert_blueprint'), ...Base, record: BlueprintRecord }),
  S({ op: z.literal('attach_source'), ...Base, target_kind: z.enum(['concept', 'ku']), target_id: z.string().max(160), source: SourceRecord }),
]);
export type PackDeltaOp = z.infer<typeof PackDeltaOp>;
export const PackDelta = S({ delta_id: Ulid, pack_id: PackId, channel: z.enum(['local', 'user']),
  source: S({ kind: z.enum(['import', 't3', 't4', 'tier_promotion', 'regate', 'pack_refresh']), ref: Ulid }),
  ops: z.array(PackDeltaOp).min(1).max(5000) });
export type PackDelta = z.infer<typeof PackDelta>;
