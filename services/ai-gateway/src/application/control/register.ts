import { createUlid } from '@fathom/shared-kernel/ids/ids';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import { registerControlRoutes } from '../../http/control/routes.js';
import { getMode } from './get-mode.js';
import { listProviders } from './list-providers.js';
import type { ControlDeps } from './ports.js';
import { recomputeMode } from './recompute-mode.js';

export function registerControl(app: ServiceApp, deps: ControlDeps): void {
  const { infra } = deps;
  if (deps.outbox === null) {
    throw new Error('invariant: ai-gateway outbox missing');
  }
  // 기동 1회 재산정 — 동의 라우트(IF-AI-027)는 R1+라 R0는 상태가 바뀌지 않는 한 쓰기 0.
  recomputeMode({
    db: infra.db,
    store: infra.store,
    outbox: deps.outbox,
    clock: deps.clock,
    newId: createUlid(deps.clock),
    log: deps.log,
    safeMode: deps.flags.safe_mode,
  });
  registerControlRoutes(app, {
    mode: () => getMode({ store: infra.store, safeMode: deps.flags.safe_mode }),
    providers: () => listProviders({ store: infra.store }),
  });
}
