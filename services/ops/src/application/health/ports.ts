import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { SupervisorControl } from '../../infra/supervisor-ipc/client.js';
import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';

export type OpsPeers = Readonly<Record<'gateway' | 'content' | 'learning' | 'ai-gateway', PeerClientPort>>;
export type HealthPorts = { readonly db: SqlitePort; readonly supervisor: SupervisorControl | null; readonly peers: OpsPeers };
export type HealthDeps = ServiceDeps<null> & { readonly infra: HealthPorts };
