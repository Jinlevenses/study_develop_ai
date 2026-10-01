import { LR_ERRORS } from '@fathom/contracts/http/learning/v1/errors';
import type { ServiceDefinition, ServiceDeps } from '@fathom/shared-kernel/service/service';
import { registerApp } from './app.js';
import type { CurriculumRefPorts } from './application/curriculum-ref/ports.js';
import type { InsightPorts } from './application/insight/ports.js';
import type { LearnerModelPorts } from './application/learner-model/ports.js';
import type { LedgerPorts } from './application/ledger/ports.js';
import type { PracticePorts } from './application/practice/ports.js';
import { LEARNING_DB, openInfra } from './infra/db/open.js';
import { EVENTS, inboxConfig } from './infra/events/wiring.js';
import { INSIGHT_DB } from './infra/insight-db/open.js';
import { ledgerGuardCheck } from './jobs/integrity.js';
import { learningSnapshotExtras } from './jobs/snapshot.js';

export const SVC = 'learning' as const;
export const PEERS = ['content'] as const;

export type LearningInfra = PracticePorts & LedgerPorts & LearnerModelPorts & InsightPorts & CurriculumRefPorts;
export type LearningDeps = ServiceDeps<null> & { readonly infra: LearningInfra };

export function serviceDefinition(entry: string): ServiceDefinition<null> {
  return {
    svc: SVC,
    entry,
    contractsHash: null,
    databases: [LEARNING_DB, INSIGHT_DB],
    peers: PEERS,
    events: EVENTS,
    inbox: inboxConfig(),
    errors: LR_ERRORS,
    snapshotExtras: learningSnapshotExtras,
    restoreCheck: (db) => ledgerGuardCheck(db),
    register: (app, deps) => registerApp(app, { ...deps, infra: openInfra(deps) }),
  };
}
