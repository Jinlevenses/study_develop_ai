import type { z } from 'zod';
import type { CallerName } from './ids.js';

// ARC-01 §17.2 확정형
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RouteDef {
  id: string; // '<svc>.<group>.<action>'
  ifId: `IF-${'COM' | 'GW' | 'LR' | 'CT' | 'AI' | 'OP'}-${number}`;
  method: HttpMethod;
  path: `/internal/v1/${string}` | `/api/v1/${string}` | '/healthz' | '/readyz';
  allowedCallers: readonly z.infer<typeof CallerName>[];
  idempotent: boolean;
  paginated: boolean;
  request: { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType; bodyKind?: 'json' | 'ndjson' };
  response: Record<number, z.ZodType>; // 성공 상태 → 스키마 (오류는 공통 Problem)
  responseKind?: 'json' | 'sse' | 'ndjson' | 'text';
  deadlineMs?: number;
  bodyLimitBytes?: number;
  freeze: 'D' | 'O';
  slice: 'R0' | 'R1' | 'R2' | 'R3';
  fr: readonly string[];
}
export function defineRoute<const R extends RouteDef>(r: R): R {
  return r;
}
