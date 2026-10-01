import { CT_ERRORS } from '@fathom/contracts/http/content/v1/errors';
import type { ServiceDefinition } from '@fathom/shared-kernel/service/service';
import { CONTENT_INBOX_HANDLERS, registerAll } from './app.js';
import { CONTENT_DB } from './infra/db/open.js';
import { buildContentInbox } from './infra/events/inbox.js';
import { CONTENT_EVENTS } from './infra/events/outbox.js';
import { contentIntegrityJob } from './jobs/integrity.js';
import { contentSnapshotJob } from './jobs/snapshot.js';

/** IT-00: 정책 미로딩 — 정책 소비 WP가 `loadPolicies`를 여기에 가산한다. */
export type ContentPolicies = null;

export function createContentDefinition(opts: { readonly entry: string }): ServiceDefinition<ContentPolicies> {
  const base = {
    svc: 'content',
    entry: opts.entry,
    contractsHash: null,
    databases: [CONTENT_DB],
    peers: ['ai-gateway'],
    events: CONTENT_EVENTS,
    inbox: buildContentInbox(CONTENT_INBOX_HANDLERS),
    errors: CT_ERRORS,
    register: registerAll,
  } satisfies ServiceDefinition<ContentPolicies>;
  return { ...base, jobs: [contentSnapshotJob(base), contentIntegrityJob(base)] };
}
