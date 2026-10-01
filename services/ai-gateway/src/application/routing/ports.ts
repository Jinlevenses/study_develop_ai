import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type RoutingPorts = { readonly db: SqlitePort; readonly cacheDb: SqlitePort; readonly assetsDir: string };
export type RoutingDeps = ServiceDeps<null> & { readonly infra: RoutingPorts };
