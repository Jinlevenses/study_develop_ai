import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { Operation } from './operations.js';

export const SystemShutdownBody = S({ op_id: Ulid, grace_ms: z.number().int().min(0).max(10_000) });
export type SystemShutdownBody = z.infer<typeof SystemShutdownBody>;

// idem = op_id
export const SystemShutdownRoute = defineRoute({
  id: 'ops.system.shutdown',
  ifId: 'IF-OP-050',
  method: 'POST',
  path: '/internal/v1/system:shutdown',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: SystemShutdownBody },
  response: { 202: Operation },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-SET-001', 'FR-SET-015'],
});
export const ServicesRestartRoute = defineRoute({
  id: 'ops.services.restart',
  ifId: 'IF-OP-051',
  method: 'POST',
  path: '/internal/v1/services/{svc}:restart',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ svc: z.string().regex(/^[a-z-]{1,40}$/) }) },
  response: { 202: Operation },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-002', 'FR-SET-003'],
});
export const OP_SYSTEM_ROUTES = [SystemShutdownRoute, ServicesRestartRoute] as const;
