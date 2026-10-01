import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type InsightPorts = { readonly db: SqlitePort; readonly insightDb: SqlitePort };
export type InsightDeps = ServiceDeps<null> & { readonly infra: InsightPorts };
