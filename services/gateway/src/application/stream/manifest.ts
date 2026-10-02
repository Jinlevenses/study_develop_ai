import { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import { SUBSCRIPTIONS } from '@fathom/contracts/events/routing.gen';

// gateway 소비자 매니페스트 — 17구독, 전부 notify/drop(IF-COM-004). SSE 중계라 payload 전체를 읽는다(`reads: ['*']`).

export function gatewayManifest(): ConsumerManifest {
  return ConsumerManifest.parse({
    consumer: 'gateway',
    subscriptions: Object.entries(SUBSCRIPTIONS.gateway).map(([type, s]) => ({ type, ...s })),
  });
}
