import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import { ROUTING } from '@fathom/contracts/events/routing.gen';
import type { EventPayloadRegistry, RelayRouting } from '@fathom/shared-kernel/eventing/eventing';

// content 생산 이벤트 — 페이로드 검증 레지스트리 + 목적지별 라우팅(생성물 `ROUTING.content`: gateway notify · learning durable).
export const CONTENT_EVENTS = { payloads: EVENT_PAYLOADS, routing: ROUTING.content } satisfies {
  payloads: EventPayloadRegistry;
  routing: RelayRouting;
};
