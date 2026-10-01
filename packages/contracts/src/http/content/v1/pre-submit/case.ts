import { z } from 'zod';
import { ArtifactId, CaseId, ObjKey } from '../../../../common/ids.js';
import { ArtifactTemplateKind } from '../../../../common/practice.js';
import { S } from '../../../../common/schema.js';
// biome-ignore lint/suspicious/noImportCycles: [Brief 결정 D1] 순환 import는 getter로 TDZ를 피한다(IF-01 §6 스키마 상호 참조)
import { ItemDeliveryPreSubmit } from './item.js';

export const CaseContinuationPreSubmit = S({
  get next_node() {
    return ItemDeliveryPreSubmit.nullable();
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  finished: z.boolean(),
  revealed_evidence_keys: z.array(ObjKey).max(20),
});
export type CaseContinuationPreSubmit = z.infer<typeof CaseContinuationPreSubmit>;
export const CaseRuntimePreSubmit = S({
  case_id: CaseId,
  variant_id: z.string().max(64),
  alarm_md: z.string().max(8000),
  evidence: z.record(
    ObjKey,
    S({ label_ko: z.string().max(100), cost: z.number().int().min(0), content_md: z.string().max(20_000) }),
  ),
  get first_node() {
    return ItemDeliveryPreSubmit;
  }, // [Brief 결정 D1] 순환 import TDZ 회피
  get postmortem_item() {
    return ItemDeliveryPreSubmit;
  }, // [Brief 결정 D1] 순환 import TDZ 회피
});
export type CaseRuntimePreSubmit = z.infer<typeof CaseRuntimePreSubmit>;
export const ArtifactRuntimePreSubmit = S({
  artifact_id: ArtifactId,
  template_kind: ArtifactTemplateKind,
  template_md: z.string().max(20_000),
  get item() {
    return ItemDeliveryPreSubmit;
  }, // [Brief 결정 D1] 순환 import TDZ 회피
});
export type ArtifactRuntimePreSubmit = z.infer<typeof ArtifactRuntimePreSubmit>;
