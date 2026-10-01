import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type LearnerModelPorts = { readonly db: SqlitePort };
export type LearnerModelDeps = ServiceDeps<null> & { readonly infra: LearnerModelPorts };
