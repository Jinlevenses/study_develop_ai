import { z } from 'zod';
import { S } from '../common/schema.js';

const P = z.number().min(0).max(1);

// [Brief 결정 §4.6 — CR-43 T1 저작] policy/ldi_params@v1.yaml 의 zod. 값 출처 = REQ-01 §12.5 부록 A(미확정 — `provisional: true`, CR-28).
export const LdiParamsV1 = S({
  version: z.literal('ldi_params@v1'),
  provisional: z.boolean(),
  retention_weights: S({ core: P, standard: P, breadth: P, archive: P, retired: z.literal(0) }),
  depth_by_level: S({
    L0: z.number().min(0),
    L1: z.number().min(0),
    L2: z.number().min(0),
    L3: z.number().min(0),
    L4: z.number().min(0),
    L5: z.number().min(0),
  }),
  retrievability: S({ recognition_factor: P }),
  evidence: S({ grader_weight: P, formats_weight: P, formats_target: z.number().int().min(1) }),
  validity: S({ valid: P, cl_x: P, deprecated: P }),
  provisional_factor: P,
});
export type LdiParamsV1 = z.infer<typeof LdiParamsV1>;
