import {
  SessionCsrfRoute,
  SessionExchangeRoute,
  SessionLogoutRoute,
  SessionStatusRoute,
} from '@fathom/contracts/http/gateway/v1/session';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { createSessionHandlers } from '../../application/session/handlers.js';

// IF-GW-002·003·004·006 라우트 등록만 — 핸들러는 application/session/handlers.ts.

export function registerSessionRoutes(app: ServiceApp, h: ReturnType<typeof createSessionHandlers>): void {
  app.route(SessionExchangeRoute, h.exchange);
  app.route(SessionCsrfRoute, h.csrf);
  app.route(SessionLogoutRoute, h.logout);
  app.route(SessionStatusRoute, h.status);
}
