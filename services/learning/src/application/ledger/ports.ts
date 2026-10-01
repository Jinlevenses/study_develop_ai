import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type LedgerPorts = { readonly db: SqlitePort };
export type LedgerDeps = ServiceDeps<null> & { readonly infra: LedgerPorts };
