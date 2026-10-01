import { z } from 'zod';
import { ArtifactId, ObjKey, Ulid } from '../../../../common/ids.js';
import { ArtifactTemplateKind } from '../../../../common/practice.js';
import { S } from '../../../../common/schema.js';

export const ArtifactRunPostSubmit = S({
  phase: z.literal('post_submit'),
  run_id: Ulid,
  artifact_id: ArtifactId,
  template_kind: ArtifactTemplateKind,
  state: z.enum(['graded', 'awaiting_self_grade', 'rebuttal']),
  submitted_text: z.string().max(40_000),
  attempt_id: Ulid,
  verdict_id: Ulid.nullable(),
  dimensions: z.record(ObjKey, S({ label_ko: z.string().max(60), score: z.number().min(0), max: z.number().min(1) })),
  rebuttal_dialog_ids: z.array(Ulid).max(3),
  exemplar_md: z.string().max(40_000).nullable(),
});
export type ArtifactRunPostSubmit = z.infer<typeof ArtifactRunPostSubmit>;
