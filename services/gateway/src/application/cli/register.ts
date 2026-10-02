import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { registerCliRoutes } from '../../http/cli/routes.js';
import { createCliHandlers } from './handlers.js';

export function registerCli(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): void {
  registerCliRoutes(app, createCliHandlers(deps, ctx));
}
