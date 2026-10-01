import { z } from 'zod';
import { ArtifactId, CaseId, ConceptId, ItemId, Sha256Hex, Ulid } from '../../../../common/ids.js';
import { AttemptPhase, DialogKind } from '../../../../common/practice.js';
import { S } from '../../../../common/schema.js';
import { ItemDeliveryPreSubmit } from '../../../content/v1/pre-submit/item.js';
// biome-ignore lint/suspicious/noImportCycles: [Brief 결정 E1] 순환 import는 getter로 TDZ를 피한다(IF-LR-004 응답 ↔ BlockViewPreSubmit.block)
import { BlockSummary } from '../sessions.js';

export const BlockViewPreSubmit = S({
  session_id: Ulid,
  get block() {
    return BlockSummary;
  }, // [Brief 결정 E1] 순환 import TDZ 회피
  payload: z.discriminatedUnion('kind', [
    S({
      kind: z.literal('lesson'),
      concept_id: ConceptId,
      entry_stage: z.enum(['theory', 'code', 'core', 'pretest', 'problem', 'problem_definition']),
      page_content_hash: Sha256Hex,
    }),
    S({
      kind: z.literal('items'),
      phase: AttemptPhase,
      items: z.array(ItemDeliveryPreSubmit).min(1).max(20),
      attempted_item_ids: z.array(ItemId).max(20),
    }),
    S({
      kind: z.literal('blank_note'),
      concept_id: ConceptId,
      ladder_step: z.enum(['BN-1', 'BN-2', 'BN-3', 'BN-4', 'BN-5']),
      item: ItemDeliveryPreSubmit,
    }),
    S({ kind: z.literal('dialog'), dialog_kind: DialogKind, concept_id: ConceptId, dialog_id: Ulid.nullable() }),
    S({ kind: z.literal('lab'), item: ItemDeliveryPreSubmit, runner_enabled: z.boolean() }),
    S({ kind: z.literal('case'), case_id: CaseId, run_id: Ulid.nullable() }),
    S({ kind: z.literal('artifact'), artifact_id: ArtifactId, run_id: Ulid.nullable() }),
    S({ kind: z.literal('jol'), concept_ids: z.array(ConceptId).min(1).max(20) }),
    S({ kind: z.literal('reflection'), prompts_ko: z.array(z.string().max(200)).min(1).max(5) }),
    S({ kind: z.literal('triage'), inbox_ids: z.array(Ulid).min(1).max(10) }),
  ]),
});
export type BlockViewPreSubmit = z.infer<typeof BlockViewPreSubmit>;
