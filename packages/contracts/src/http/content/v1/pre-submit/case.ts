import { z } from 'zod';
import { ArtifactId, CaseId, ObjKey } from '../../../../common/ids.js';
import { ArtifactTemplateKind } from '../../../../common/practice.js';
import { S } from '../../../../common/schema.js';
import { ItemDeliveryPreSubmit } from './item.js';

export const CaseContinuationPreSubmit = S({ next_node: ItemDeliveryPreSubmit.nullable(), finished: z.boolean(), revealed_evidence_keys: z.array(ObjKey).max(20) });
export type CaseContinuationPreSubmit = z.infer<typeof CaseContinuationPreSubmit>;
export const CaseRuntimePreSubmit = S({ case_id: CaseId, variant_id: z.string().max(64), alarm_md: z.string().max(8000),
  evidence: z.record(ObjKey, S({ label_ko: z.string().max(100), cost: z.number().int().min(0), content_md: z.string().max(20_000) })),
  first_node: ItemDeliveryPreSubmit, postmortem_item: ItemDeliveryPreSubmit });
export type CaseRuntimePreSubmit = z.infer<typeof CaseRuntimePreSubmit>;
export const ArtifactRuntimePreSubmit = S({ artifact_id: ArtifactId, template_kind: ArtifactTemplateKind, template_md: z.string().max(20_000), item: ItemDeliveryPreSubmit });
export type ArtifactRuntimePreSubmit = z.infer<typeof ArtifactRuntimePreSubmit>;
