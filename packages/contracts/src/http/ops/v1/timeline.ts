import { z } from 'zod';
import { ServiceName, Ulid } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { EventType } from '../../../events/envelope.js';

export const TimelineView = S({ correlation_id: Ulid, entries: z.array(S({
  ts: EpochMs, svc: ServiceName, kind: z.enum(['outbox', 'inbox', 'inbox_dead', 'log']), type: EventType.nullable(),
  event_id: Ulid.nullable(), causation_id: Ulid.nullable(), summary: z.string().max(300),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).nullable() })).max(1000) });
export type TimelineView = z.infer<typeof TimelineView>;
