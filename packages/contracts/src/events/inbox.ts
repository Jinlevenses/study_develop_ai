import { z } from 'zod';
import { ServiceName } from '../common/ids.js';
import { defineRoute } from '../common/route.js';
import { S } from '../common/schema.js';
import { IntegrationEventEnvelope } from './envelope.js';

export const InboxDelivery = S({ producer: ServiceName, events: z.array(IntegrationEventEnvelope).min(1).max(100) }); // producer_seq 오름차순
export type InboxDelivery = z.infer<typeof InboxDelivery>;
export const InboxAck = S({ acked_through_seq: z.number().int().min(0) });
export type InboxAck = z.infer<typeof InboxAck>;

// IF-COM-004 (IF-01 §3.1). ※※ allowedCallers는 정적 상한일 뿐이다 — 실제 허용 생산자는 소비자 매니페스트로 런타임 검사한다(IF §3.3-1).
export const InboxDeliverRoute = defineRoute({
  id: 'common.inbox.deliver',
  ifId: 'IF-COM-004',
  method: 'POST',
  path: '/internal/v1/inbox',
  allowedCallers: ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'],
  idempotent: false,
  paginated: false,
  request: { body: InboxDelivery },
  response: { 200: InboxAck },
  bodyLimitBytes: 8_388_608,
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
