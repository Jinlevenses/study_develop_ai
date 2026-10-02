import { OP_ERRORS } from '@fathom/contracts/http/ops/v1/errors';
import type { ServiceDefinition, ServiceDeps } from '@fathom/shared-kernel/service/service';
import { registerApp } from './app.js';
import type { AutostartPorts } from './application/autostart/ports.js';
import type { BackupPorts } from './application/backup/ports.js';
import type { DoctorPorts } from './application/doctor/ports.js';
import type { HealthPorts } from './application/health/ports.js';
import type { HostPorts } from './application/host/ports.js';
import type { TelemetryPorts } from './application/telemetry/ports.js';
import type { UpgradePorts } from './application/upgrade/ports.js';
import { OPS_DB, openInfra } from './infra/db/open.js';
import { EVENTS, inboxConfig } from './infra/events/wiring.js';

export const SVC = 'ops-api' as const;
// ops-api는 IF-COM-003 metrics·IF-COM-005~010 admin의 유일한 호출자다 — supervisor가 5키 전부 채우므로 readyz peers를 막지 않는다.
export const PEERS = ['gateway', 'content', 'learning', 'ai-gateway'] as const;

export type OpsInfra = BackupPorts &
  HealthPorts &
  DoctorPorts &
  HostPorts &
  UpgradePorts &
  AutostartPorts &
  TelemetryPorts;
export type OpsDeps = ServiceDeps<null> & { readonly infra: OpsInfra };

export function serviceDefinition(entry: string): ServiceDefinition<null> {
  return {
    svc: SVC,
    entry,
    contractsHash: null,
    databases: [OPS_DB],
    peers: PEERS,
    events: EVENTS,
    inbox: inboxConfig(),
    errors: OP_ERRORS,
    register: (app, deps) => registerApp(app, { ...deps, infra: openInfra(deps) }),
  };
}
