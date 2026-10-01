import { z } from 'zod';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const LearningSignals = S({
  from: EpochMs,
  to: EpochMs,
  tripwires: z
    .array(
      S({
        id: z.string().regex(/^(TW-(0[1-9]|1[0-3])|GR-\d{2})$/),
        value: z.number().nullable(),
        threshold: z.number().nullable(),
        state: z.enum(['ok', 'warn', 'trip', 'insufficient_data']),
      }),
    )
    .max(40),
  sessions: S({
    count: z.number().int(),
    median_minutes: z.number().nullable(),
    first_item_p95_ms: z.number().nullable(),
  }),
});
export type LearningSignals = z.infer<typeof LearningSignals>;
// [Brief 결정 §4.3] 표에 스키마 이름이 없는 쿼리(이름 고정)
export const SignalsQuery = S({ from: z.coerce.number().int().min(0), to: z.coerce.number().int().min(0) });
export type SignalsQuery = z.infer<typeof SignalsQuery>;

export const TelemetrySignalsRoute = defineRoute({
  id: 'learning.telemetry.signals',
  ifId: 'IF-LR-090',
  method: 'GET',
  path: '/internal/v1/telemetry/learning-signals',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: { query: SignalsQuery },
  response: { 200: LearningSignals },
  deadlineMs: 5000,
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-AVL-008', 'FR-SET-021'],
});
export const LR_TELEMETRY_ROUTES = [TelemetrySignalsRoute] as const;
