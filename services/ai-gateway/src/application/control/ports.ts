import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type ControlPorts = { readonly db: SqlitePort; readonly firstBoot: 'seeded' | 'present' };
export type ControlDeps = ServiceDeps<null> & { readonly infra: ControlPorts };
