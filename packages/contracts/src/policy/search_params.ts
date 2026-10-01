import { z } from 'zod';
import { S } from '../common/schema.js';

// [Brief 결정 §4.8 — CR-43 T1 저작] policy/search_params@v1.yaml 의 zod. 값 출처 = ARC-01 §10.4(SP-4 V2 가중 10·5·1, 짧은 토큰 3자, V3 전환 20,000, CR-24).
export const SearchParamsV1 = S({
  version: z.literal('search_params@v1'),
  bm25: S({ title: z.number().positive(), alias: z.number().positive(), body: z.number().positive() }),
  strip_chars: z.string().min(1).max(200), // 질의 토큰에서 지울 문자 집합(구두점·따옴표)
  short_token_len: z.number().int().min(1).max(10), // 이 길이 이하 토큰은 instr() 경로
  v3_switch_docs: z.number().int().min(1), // 문서 수가 이 값을 넘으면 V3 엔진
});
export type SearchParamsV1 = z.infer<typeof SearchParamsV1>;
