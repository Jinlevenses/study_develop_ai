import { StreamOpenRoute } from '@fathom/contracts/http/gateway/v1/stream';
import type { RouteContext, ServiceApp } from '@fathom/shared-kernel/service/service';
import type { FastifyReply } from 'fastify';

// IF-GW-005 라우트 등록만 — 핸들러는 application/stream/register.ts.

export function registerStreamRoutes(
  app: ServiceApp,
  handler: (c: RouteContext<typeof StreamOpenRoute>, reply: FastifyReply) => Promise<void>,
): void {
  app.stream(StreamOpenRoute, handler);
}
