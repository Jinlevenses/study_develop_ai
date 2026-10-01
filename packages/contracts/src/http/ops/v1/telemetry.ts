import { z } from 'zod';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const TripwireView = S({
  computed_at: EpochMs,
  learning: z
    .array(
      S({
        id: z.string().regex(/^(TW-(0[1-9]|1[0-3])|GR-\d{2})$/),
        value: z.number().nullable(),
        threshold: z.number().nullable(),
        state: z.enum(['ok', 'warn', 'trip', 'insufficient_data']),
      }),
    )
    .max(40),
  resource: S({
    idle_rss_total_mb: z.number().nullable(),
    idle_rss_limit_mb: z.number(),
    cold_start_ms: z.number().nullable(),
    cold_start_limit_ms: z.number(),
    disk_projection_15y_mb: z.number().nullable(),
  }),
});
export type TripwireView = z.infer<typeof TripwireView>;
export const TripwireSettings = S({
  action_strength: z.enum(['observe', 'suggest', 'auto_adjust']),
  muted: z.array(z.string().regex(/^(TW-(0[1-9]|1[0-3])|GR-\d{2})$/)).max(20),
});
export type TripwireSettings = z.infer<typeof TripwireSettings>;
export const SloView = S({
  computed_at: EpochMs,
  window: z.literal('1h'),
  slos: z
    .array(
      S({
        id: z.enum(['first_item_p95', 'grading_p95', 'outbox_oldest_age', 'restart_time', 'eventloop_p99']),
        target_ms: z.number(),
        value_ms: z.number().nullable(),
        ok: z.boolean().nullable(),
      }),
    )
    .max(10),
});
export type SloView = z.infer<typeof SloView>;
export const TelemetryTripwiresRoute = defineRoute({
  id: 'ops.telemetry.tripwires',
  ifId: 'IF-OP-045',
  method: 'GET',
  path: '/internal/v1/telemetry/tripwires',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: TripwireView },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-AVL-008', 'FR-SET-021'],
});
export const TelemetrySloRoute = defineRoute({
  id: 'ops.telemetry.slo',
  ifId: 'IF-OP-046',
  method: 'GET',
  path: '/internal/v1/telemetry/slo',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: SloView },
  freeze: 'D',
  slice: 'R1',
  fr: ['NFR-PERF-*', 'TW-12'],
});
export const TelemetrySettingsRoute = defineRoute({
  id: 'ops.telemetry.settings',
  ifId: 'IF-OP-047',
  method: 'PUT',
  path: '/internal/v1/telemetry/settings',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: TripwireSettings },
  response: { 200: TripwireSettings },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-021'],
});
export const OP_TELEMETRY_ROUTES = [TelemetryTripwiresRoute, TelemetrySloRoute, TelemetrySettingsRoute] as const;
