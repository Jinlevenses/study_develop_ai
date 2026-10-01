import { z } from 'zod';
import { DataClass } from '../common/domain.js';
import { ObjKey } from '../common/ids.js';
import { S } from '../common/schema.js';

export const ContextRef = S({
  kind: z.enum(['attempt', 'dialog_turn', 'blank_note', 'item', 'import', 'pack', 'calibration', 'appeal', 'system']),
  phase: z.enum(['pre_submit', 'post_submit', 'n_a']),
  id: z.string().max(160),
});
export type ContextRef = z.infer<typeof ContextRef>;
export const ContextBlock = S({
  // 모든 외부 송출 텍스트 단위(ADR-016 §1)
  key: ObjKey,
  text: z.string().max(200_000),
  data_class: DataClass,
  untrusted: z.boolean(),
  source_ref: z.string().max(200).nullable(),
});
export type ContextBlock = z.infer<typeof ContextBlock>;
