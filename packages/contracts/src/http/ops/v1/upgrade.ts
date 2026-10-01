import { z } from 'zod';
import { SemVer, Ulid } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';
import { Operation } from './operations.js';

export const UpgradeBody = S({ op_id: Ulid, bundle_path: z.string().min(1).max(1024) });
export type UpgradeBody = z.infer<typeof UpgradeBody>;
export const RollbackBody = S({ op_id: Ulid });
export type RollbackBody = z.infer<typeof RollbackBody>;
export const UpgradeStatus = S({ current_version: SemVer, previous_version: SemVer.nullable(), rollback_available: z.boolean(), last_op: Operation.nullable() });
export type UpgradeStatus = z.infer<typeof UpgradeStatus>;
