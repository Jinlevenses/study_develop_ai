import { CliBootstrapTokenRoute, CliShutdownRoute, CliStatusRoute } from '@fathom/contracts/http/gateway/v1/cli';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { createCliHandlers } from '../../application/cli/handlers.js';

// IF-GW-001·180·181 라우트 등록만 — 핸들러는 application/cli/handlers.ts.

export function registerCliRoutes(app: ServiceApp, h: ReturnType<typeof createCliHandlers>): void {
  app.route(CliBootstrapTokenRoute, h.bootstrapToken);
  app.route(CliStatusRoute, h.status);
  app.route(CliShutdownRoute, h.shutdown);
}
