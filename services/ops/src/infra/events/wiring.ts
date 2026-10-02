import { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import { ROUTING, SUBSCRIPTIONS } from '@fathom/contracts/events/routing.gen';
import type { InboxConfig, InboxHandlerDef } from '@fathom/shared-kernel/eventing/eventing';
import type { ServiceDefinition } from '@fathom/shared-kernel/service/service';
import { INBOX_HANDLERS } from './handlers.js';

// IF-01 §9.3·§9.5 — 생산(routing)·소비(subscriptions) 결선. 매니페스트는 `SUBSCRIPTIONS`(같은 JSON에서 생성)로 재구성한다.
export const EVENTS: NonNullable<ServiceDefinition<null>['events']> = {
  payloads: EVENT_PAYLOADS,
  routing: ROUTING['ops-api'],
};

export function inboxConfig(handlers: readonly InboxHandlerDef[] = INBOX_HANDLERS): InboxConfig {
  return {
    mode: 'durable',
    manifest: ConsumerManifest.parse({
      consumer: 'ops-api',
      subscriptions: Object.entries(SUBSCRIPTIONS['ops-api']).map(([type, s]) => ({
        type,
        schema_versions: [...s.schema_versions],
        mode: s.mode,
        on_poison: s.on_poison,
        reads: [...s.reads],
      })),
    }),
    handlers,
  };
}
