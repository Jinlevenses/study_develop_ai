import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type HostPorts = { readonly db: SqlitePort };
export type HostDeps = ServiceDeps<null> & { readonly infra: HostPorts };
