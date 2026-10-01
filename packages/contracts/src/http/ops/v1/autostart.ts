import { z } from 'zod';
import { S } from '../../../common/schema.js';

export const AutostartView = S({ enabled: z.boolean(), method: z.enum(['launchd', 'schtasks', 'systemd_user', 'unsupported']), path: z.string().max(1024).nullable() });
export type AutostartView = z.infer<typeof AutostartView>;
export const PutAutostartBody = S({ enabled: z.boolean() });
export type PutAutostartBody = z.infer<typeof PutAutostartBody>;
