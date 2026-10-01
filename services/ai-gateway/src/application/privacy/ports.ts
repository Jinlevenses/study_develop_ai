import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type PrivacyPorts = { readonly db: SqlitePort };
export type PrivacyDeps = ServiceDeps<null> & { readonly infra: PrivacyPorts };
