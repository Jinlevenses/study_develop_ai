// ARC-01 §17.3 `eventing` 공개 API — 진입 파일(STD-DIR-31: import + export {}, `export *` 금지).

import type {
  InboxConfig,
  InboxDeps,
  InboxFailureCode,
  InboxHandlerDef,
  InboxOutcome,
  InboxProcessor,
} from './inbox.js';
import { defineInboxHandler, inboxError, inboxErrorCode, inboxPlugin } from './inbox.js';
import type { AppendEventInput, EventPayloadRegistry, Outbox, OutboxOptions } from './outbox.js';
import { appendEvent, createOutbox } from './outbox.js';
import type { DeliveryFailure, InboxTransport, Relay, RelayOptions, RelayRouting } from './relay.js';
import { backoffDelayMs, startRelay } from './relay.js';
import type { PurgeResult } from './retention.js';
import { purgeInfraOnce } from './retention.js';
import { rewindCursors } from './rewind.js';
import type { EventingSnapshot } from './snapshot-read.js';
import { readEventingSnapshot } from './snapshot-read.js';
import { readEventTimeline } from './timeline.js';
import type { InboxTransportOptions } from './transport.js';
import { createInboxTransport } from './transport.js';

export type {
  AppendEventInput,
  DeliveryFailure,
  EventingSnapshot,
  EventPayloadRegistry,
  InboxConfig,
  InboxDeps,
  InboxFailureCode,
  InboxHandlerDef,
  InboxOutcome,
  InboxProcessor,
  InboxTransport,
  InboxTransportOptions,
  Outbox,
  OutboxOptions,
  PurgeResult,
  Relay,
  RelayOptions,
  RelayRouting,
};
export {
  appendEvent,
  backoffDelayMs,
  createInboxTransport,
  createOutbox,
  defineInboxHandler,
  inboxError,
  inboxErrorCode,
  inboxPlugin,
  purgeInfraOnce,
  readEventingSnapshot,
  readEventTimeline,
  rewindCursors,
  startRelay,
};
