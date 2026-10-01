import { z } from 'zod';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';

export const AutostartView = S({
  enabled: z.boolean(),
  method: z.enum(['launchd', 'schtasks', 'systemd_user', 'unsupported']),
  path: z.string().max(1024).nullable(),
});
export type AutostartView = z.infer<typeof AutostartView>;
export const PutAutostartBody = S({ enabled: z.boolean() });
export type PutAutostartBody = z.infer<typeof PutAutostartBody>;
export const AutostartGetRoute = defineRoute({
  id: 'ops.autostart.get',
  ifId: 'IF-OP-035',
  method: 'GET',
  path: '/internal/v1/autostart',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: AutostartView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-024'],
});
export const AutostartPutRoute = defineRoute({
  id: 'ops.autostart.put',
  ifId: 'IF-OP-036',
  method: 'PUT',
  path: '/internal/v1/autostart',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: PutAutostartBody },
  response: { 200: AutostartView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-024'],
});
export const OP_AUTOSTART_ROUTES = [AutostartGetRoute, AutostartPutRoute] as const;
