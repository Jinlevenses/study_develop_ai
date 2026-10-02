import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import { registerBff } from './application/bff/register.js';
import { registerCli } from './application/cli/register.js';
import { registerSession } from './application/session/register.js';
import { registerStream } from './application/stream/register.js';
import type { GatewayContext } from './config.js';
import { gatewayFallbacks } from './constants.js';
import { registerWebShell } from './http/static/register.js';
import { registerSecurityHeaders } from './http/static/security-headers.js';

// 동결 대상(frozen.lock, INT-1a) — 등록 함수 호출 순서만 둔다. 와일드카드 웹 셸이 마지막이다.

export async function registerAll(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): Promise<void> {
  ctx.fallbacks = gatewayFallbacks(ctx.opts.profileOverride ?? deps.profile);
  ctx.bindServer(app.fastify.server);
  registerSecurityHeaders(app, deps, ctx);
  await registerSession(app, deps, ctx);
  registerStream(app, deps, ctx);
  registerCli(app, deps, ctx);
  registerBff(app, deps, ctx);
  await registerWebShell(app, deps, ctx);
}
