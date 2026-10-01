import { z } from 'zod';
import { S } from '../common/schema.js';

// [Brief 결정 §4.6 — CR-43 T1 저작] policy/cbm_params@v1.yaml 의 zod. 값 출처 = FR-PRG-013·ARC-01 §10.4(score{correct:[1,2,3], wrong:[0,-2,-6]}).
// correct = 0 초과·엄격 증가, wrong = 0 이하·비증가(C1~C3 확신도 순).
export const CbmParamsV1 = S({
  version: z.literal('cbm_params@v1'),
  score: S({
    correct: z.tuple([z.number(), z.number(), z.number()]),
    wrong: z.tuple([z.number(), z.number(), z.number()]),
  }).refine(
    ({ correct, wrong }) =>
      correct[0] > 0 &&
      correct[0] < correct[1] &&
      correct[1] < correct[2] &&
      wrong[0] <= 0 &&
      wrong[0] >= wrong[1] &&
      wrong[1] >= wrong[2],
    'correct must be > 0 and strictly increasing; wrong must be <= 0 and non-increasing',
  ),
});
export type CbmParamsV1 = z.infer<typeof CbmParamsV1>;
