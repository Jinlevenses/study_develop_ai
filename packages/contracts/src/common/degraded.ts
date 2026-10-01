import { z } from 'zod';
import { S } from './schema.js';

export const DegradedPart = S({
  part: z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/), // 'home.ai_chip', 'map.layout'
  dependency: z.enum(['gateway', 'content', 'learning', 'ai-gateway', 'ops-api']),
  code: z.string().regex(/^(GW|CT|LR|AI|OP|CLI)-(VAL|AUTH|ACL|NOTFOUND|CONFLICT|DEP|LIMIT|POLICY|INTERNAL)-\d{3}$/),
});
export type DegradedPart = z.infer<typeof DegradedPart>;
