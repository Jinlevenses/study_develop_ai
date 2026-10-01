import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { ContentClient } from '../practice/ports.js';

export type CurriculumRefPorts = { readonly db: SqlitePort; readonly content: ContentClient };
export type CurriculumRefDeps = ServiceDeps<null> & { readonly infra: CurriculumRefPorts };
