import { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import { SUBSCRIPTIONS } from '@fathom/contracts/events/routing.gen';
import type { InboxConfig, InboxHandlerDef } from '@fathom/shared-kernel/eventing/eventing';

// content 소비 매니페스트(SUBSCRIPTIONS.content 6구독) — 전부 durable. IT-00 핸들러 0개: 구독 이벤트가 오면 HANDLER-MISSING 독 이벤트로 3회째 격리(유실 0).
export function contentManifest(): ConsumerManifest {
  return ConsumerManifest.parse({
    consumer: 'content',
    subscriptions: Object.entries(SUBSCRIPTIONS.content).map(([type, s]) => ({ type, ...s })),
  });
}

export function buildContentInbox(handlers: readonly InboxHandlerDef[]): InboxConfig {
  return { mode: 'durable', manifest: contentManifest(), handlers };
}
