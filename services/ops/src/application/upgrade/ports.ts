import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { SupervisorControl } from '../../infra/supervisor-ipc/client.js';

export type UpgradePorts = { readonly db: SqlitePort; readonly supervisor: SupervisorControl | null };
export type UpgradeDeps = ServiceDeps<null> & { readonly infra: UpgradePorts };
