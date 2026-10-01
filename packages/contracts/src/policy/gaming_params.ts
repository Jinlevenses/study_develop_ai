import { z } from 'zod';
import { FormatId, FsrsRating } from '../common/domain.js';
import { S } from '../common/schema.js';

const P = z.number().min(0).max(1);
const TMin = S({
  floor_ms: z.number().int().min(0),
  base_ms: z.number().int().min(0),
  chars_per_s: z.number().positive(),
});

// [Brief 결정 §4.6 — CR-43 T1 저작] policy/gaming_params@v1.yaml 의 zod. 값 출처 = FR-QST-025(t_min 공식)·FR-LAB-005.
// t_min_ms_by_format 키 = FormatId 33종 전부(zod 4 record 전수 의미).
export const GamingParamsV1 = S({
  version: z.literal('gaming_params@v1'),
  t_min_ms_by_format: z.record(FormatId, TMin),
  personalize_after: S({ responses: z.number().int().min(1), quantile: P }),
  rapid: S({ w: P, grade_cap: FsrsRating }),
  hint_penalty: S({ factor_per_step: P }),
});
export type GamingParamsV1 = z.infer<typeof GamingParamsV1>;
