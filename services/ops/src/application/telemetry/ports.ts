import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { OpsPeers } from '../health/ports.js';

export type TelemetryPorts = { readonly db: SqlitePort; readonly peers: OpsPeers };
export type TelemetryDeps = ServiceDeps<null> & { readonly infra: TelemetryPorts };
