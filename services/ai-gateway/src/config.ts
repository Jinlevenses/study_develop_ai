import { fileURLToPath } from 'node:url';
import { AI_ERRORS } from '@fathom/contracts/http/ai-gateway/v1/errors';
import type { ServiceDefinition, ServiceDeps } from '@fathom/shared-kernel/service/service';
import { registerApp } from './app.js';
import type { ControlPorts } from './application/control/ports.js';
import type { GeneratePorts } from './application/generate/ports.js';
import type { JudgePorts } from './application/judge/ports.js';
import type { PrivacyPorts } from './application/privacy/ports.js';
import type { RoutingPorts } from './application/routing/ports.js';
import { AI_CACHE_DB, AI_DB, openInfra } from './infra/db/open.js';
import { EVENTS, inboxConfig } from './infra/events/wiring.js';

export const SVC = 'ai-gateway' as const;
export const PEERS = [] as const;
/** STD-DIR-06: 자산 디렉터리(dist에서도 `dist/../assets`). */
export const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

export type AiInfra = ControlPorts & RoutingPorts & JudgePorts & GeneratePorts & PrivacyPorts;
export type AiDeps = ServiceDeps<null> & { readonly infra: AiInfra };

/**
 * `contractsHash`: null 유지(CO-19, T-01-09 §4.8 조건 규칙) — supervisor `readBundleInfo`가 아직 `.snapshots/*.json` 평면 목록 해시라
 * `CONTRACTS_HASH`와 달라서, 설정하면 supervisor 기동 시 exit 78이 된다. `assetsDir`는 테스트가 임시 자산 디렉터리를 주입한다.
 */
export function serviceDefinition(entry: string, opts?: { readonly assetsDir?: string }): ServiceDefinition<null> {
  const assetsDir = opts?.assetsDir ?? ASSETS_DIR;
  return {
    svc: SVC,
    entry,
    contractsHash: null,
    databases: [AI_DB, AI_CACHE_DB],
    peers: PEERS,
    events: EVENTS,
    inbox: inboxConfig(),
    errors: AI_ERRORS,
    register: (app, deps) => registerApp(app, { ...deps, infra: openInfra(deps, { assetsDir }) }),
  };
}
