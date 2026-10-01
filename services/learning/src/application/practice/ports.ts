import type { PeerClientPort } from '@fathom/shared-kernel/http-client/http-client';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

export type ContentClient = PeerClientPort;
export type PracticePorts = { readonly db: SqlitePort; readonly content: ContentClient };
export type PracticeDeps = ServiceDeps<null> & { readonly infra: PracticePorts };
