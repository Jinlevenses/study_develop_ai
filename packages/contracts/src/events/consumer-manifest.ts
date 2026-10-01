import { z } from 'zod';
import { ServiceName } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EventType } from './envelope.js';

export const ConsumerManifest = S({
  consumer: ServiceName,
  subscriptions: z
    .array(
      S({
        type: EventType,
        schema_versions: z.array(z.number().int().min(1)).min(1),
        mode: z.enum(['durable', 'notify']),
        on_poison: z.enum(['halt', 'dead_letter', 'drop']), // drop = notify 전용
        reads: z.array(z.string().regex(/^(\*|[a-z_]+(\.[a-z_]+)*)$/)).min(1), // '*' = payload 전체(gateway SSE 중계)
      }),
    )
    .max(40),
});
export type ConsumerManifest = z.infer<typeof ConsumerManifest>;
