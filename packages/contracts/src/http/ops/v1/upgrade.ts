import { z } from 'zod';
import { SemVer, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { Operation } from './operations.js';

export const UpgradeBody = S({ op_id: Ulid, bundle_path: z.string().min(1).max(1024) });
export type UpgradeBody = z.infer<typeof UpgradeBody>;
export const RollbackBody = S({ op_id: Ulid });
export type RollbackBody = z.infer<typeof RollbackBody>;
export const UpgradeStatus = S({
  current_version: SemVer,
  previous_version: SemVer.nullable(),
  rollback_available: z.boolean(),
  last_op: Operation.nullable(),
});
export type UpgradeStatus = z.infer<typeof UpgradeStatus>;

// idem = op_id
export const UpgradePrepareRoute = defineRoute({
  id: 'ops.upgrade.prepare',
  ifId: 'IF-OP-030',
  method: 'POST',
  path: '/internal/v1/upgrade/prepare',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: UpgradeBody },
  response: { 202: Operation },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-005', 'FR-SET-007', 'CR-17'],
});
// idem = op_id
export const UpgradeRollbackRoute = defineRoute({
  id: 'ops.upgrade.rollback',
  ifId: 'IF-OP-031',
  method: 'POST',
  path: '/internal/v1/upgrade/rollback',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: RollbackBody },
  response: { 202: Operation },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-007'],
});
export const UpgradeStatusRoute = defineRoute({
  id: 'ops.upgrade.status',
  ifId: 'IF-OP-032',
  method: 'GET',
  path: '/internal/v1/upgrade/status',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: UpgradeStatus },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-SET-007'],
});
export const OP_UPGRADE_ROUTES = [UpgradePrepareRoute, UpgradeRollbackRoute, UpgradeStatusRoute] as const;
