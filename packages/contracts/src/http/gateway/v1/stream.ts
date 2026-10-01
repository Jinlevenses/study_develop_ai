import { z } from 'zod';
import { AiMode } from '../../../common/domain.js';
import { SemVer, ServiceName, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { EventType } from '../../../events/envelope.js';

export const SseHello = S({
  boot_id: Ulid,
  hub_seq: z.number().int().min(0),
  server_time: EpochMs,
  app_version: SemVer,
  ai_mode: AiMode,
});
export type SseHello = z.infer<typeof SseHello>;
export const SseResync = S({ reason: z.enum(['gateway_restarted', 'ring_overflow', 'unknown_last_event_id']) });
export type SseResync = z.infer<typeof SseResync>;
export const SseEventData = S({
  // event: <integration event type> 일 때의 data 줄(JSON 1줄)
  type: EventType,
  schema_version: z.number().int().min(1),
  event_id: Ulid,
  occurred_at: EpochMs,
  correlation_id: Ulid,
  producer: ServiceName,
  payload: z.record(z.string(), z.unknown()), // = 통합 이벤트 payload 그대로(§9.6 투영 규칙)
});
export type SseEventData = z.infer<typeof SseEventData>;
// SSE 프레임:  id: <boot_id>.<hub_seq>\n event: <type | 'hello' | 'resync'>\n data: <JSON>\n\n
// 하위 (inbox로 수신)
// Last-Event-ID 헤더(스키마 없음)
// SSE 바이트 중계 — 프레임 스키마는 이 응답이 아니라 http/gateway/v1/stream.ts(IF-GW-005)·ai/stream.ts(§2.14)
export const StreamOpenRoute = defineRoute({
  id: 'gateway.stream.open',
  ifId: 'IF-GW-005',
  method: 'GET',
  path: '/api/v1/stream',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: z.string() },
  responseKind: 'sse',
  freeze: 'D',
  slice: 'R1',
  fr: ['IR-016', 'FR-QST-019'],
});
export const GW_STREAM_ROUTES = [StreamOpenRoute] as const;
