import { z } from 'zod';
import { Sha256Hex } from './ids.js';
import { S } from './schema.js';

export const NdjsonEnd = S({ kind: z.literal('end'), count: z.number().int().min(0), sha256: Sha256Hex }); // sha256 = header~마지막 데이터 줄까지 바이트(\n 포함)의 해시
export type NdjsonEnd = z.infer<typeof NdjsonEnd>;
