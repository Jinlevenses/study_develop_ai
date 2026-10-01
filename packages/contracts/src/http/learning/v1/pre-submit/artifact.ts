import { z } from 'zod';
import { ArtifactId, Ulid } from '../../../../common/ids.js';
import { ArtifactTemplateKind } from '../../../../common/practice.js';
import { S } from '../../../../common/schema.js';
import { EpochMs } from '../../../../common/time.js';
import { ItemDeliveryPreSubmit } from '../../../content/v1/pre-submit/item.js';

export const ArtifactRunPreSubmit = S({
  phase: z.literal('pre_submit'),
  run_id: Ulid,
  artifact_id: ArtifactId,
  template_kind: ArtifactTemplateKind,
  template_md: z.string().max(20_000),
  item: ItemDeliveryPreSubmit,
  draft: S({ text: z.string().max(40_000), updated_at: EpochMs }).nullable(),
});
export type ArtifactRunPreSubmit = z.infer<typeof ArtifactRunPreSubmit>;
