import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type AutostartPorts = { readonly db: SqlitePort };
export type AutostartDeps = ServiceDeps<null> & { readonly infra: AutostartPorts };
