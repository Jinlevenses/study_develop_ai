import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type JudgePorts = { readonly db: SqlitePort };
export type JudgeDeps = ServiceDeps<null> & { readonly infra: JudgePorts };
