import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';

export const SystemShutdownBody = S({ op_id: Ulid, grace_ms: z.number().int().min(0).max(10_000) });
export type SystemShutdownBody = z.infer<typeof SystemShutdownBody>;
