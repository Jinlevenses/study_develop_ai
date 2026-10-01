import { z } from 'zod';
import { S } from '../common/schema.js';

export const VClass = z.enum(['V-ci', 'V-live', 'V-field']);
export type VClass = z.infer<typeof VClass>;
export const ReqId = z.string().regex(/^(FR|NFR)-[A-Z]+-\d{3}$/);
export type ReqId = z.infer<typeof ReqId>;
export const VerificationClass = S({
  default: z.literal('V-build'),
  exceptions: z.record(ReqId, S({ build: z.boolean(), beyond: z.array(VClass).min(1) })),
});
export type VerificationClass = z.infer<typeof VerificationClass>;
