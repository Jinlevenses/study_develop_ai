import { z } from 'zod';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs, EpochMs } from '../../../common/time.js';

export const ActivityView = S({
  last_user_activity_at: EpochMs.nullable(),
  idle_ms: DurationMs,
  active_streams: z.number().int().min(0),
});
export type ActivityView = z.infer<typeof ActivityView>;
// last_user_activity_at = 마지막 브라우저 상태 변경 요청 또는 SSE 외 GET 시각(heartbeat·SSE 유지는 활동 아님)
export const InternalActivityRoute = defineRoute({
  id: 'gateway.internal.activity',
  ifId: 'IF-GW-199',
  method: 'GET',
  path: '/internal/v1/activity',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: ActivityView },
  freeze: 'D',
  slice: 'R1',
  fr: [],
});
export const GW_INTERNAL_ROUTES = [InternalActivityRoute] as const;
