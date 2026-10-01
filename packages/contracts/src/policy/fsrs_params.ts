import { z } from 'zod';
import { S } from '../common/schema.js';

const P = z.number().min(0).max(1);

// [Brief 결정 §4.6 — CR-43 T1 저작] policy/fsrs_params@v1.yaml 의 zod. 값 출처 = ARC-01 §10.4(ts-fsrs 5.4.2 default_w 21개·enable_fuzz false = SP-3 구속).
export const FsrsParamsV1 = S({
  version: z.literal('fsrs_params@v1'),
  impl: z.literal('ts-fsrs@5.4.2'),
  w: z.array(z.number()).length(21),
  enable_fuzz: z.literal(false),
  enable_short_term: z.boolean(),
  request_retention: S({
    A: z.number().min(0.7).max(0.97),
    B: z.number().min(0.7).max(0.97),
    C: z.number().min(0.7).max(0.97),
  }),
  forecast: S({
    window_days: z.literal(30),
    band: S({ min_history_windows: z.number().int().min(1), default_pct: P }),
    governor: z.literal('lower_bound'),
  }),
});
export type FsrsParamsV1 = z.infer<typeof FsrsParamsV1>;
