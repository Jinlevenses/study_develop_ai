import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { SupervisorControl } from '../../infra/supervisor-ipc/client.js';
import type { OpsPeers } from '../health/ports.js';

export type BackupPorts = { readonly db: SqlitePort; readonly supervisor: SupervisorControl | null; readonly peers: OpsPeers };
export type BackupDeps = ServiceDeps<null> & { readonly infra: BackupPorts };
