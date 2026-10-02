import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { GATEWAY_LIMITS } from '../../config.js';
import { createRateLimiter } from '../../domain/session/guards-rate-limit.js';
import { createActivityTracker } from '../../infra/activity/activity.js';
import { registerInternalRoutes } from '../../http/internal/routes.js';
import { registerSessionRoutes } from '../../http/session/routes.js';
import { createCliTokenReader } from '../cli/cli-token.js';
import { nodeSessionCrypto } from './crypto.js';
import { createSessionHandlers } from './handlers.js';
import { createPublicAuth } from './public-auth.js';
import { loadOrCreateSessionKey } from './session-key.js';
import { createSessionReader } from './session-reader.js';

// 세션 결선(IF-GW-002·003·004·006·199) — `session.key` 로드, `ctx.publicAuth` 설정, 라우트 등록.

export async function registerSession(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): Promise<void> {
  const key = await loadOrCreateSessionKey(deps.home, { randomBytes: ctx.randomBytes, log: deps.log });
  const crypto = nodeSessionCrypto;
  const activity = createActivityTracker(deps.clock);
  const reader = createSessionReader({ key, crypto, clock: deps.clock });
  ctx.activity = activity;
  ctx.sessionReader = reader;
  ctx.publicAuth = createPublicAuth({
    key,
    crypto,
    clock: deps.clock,
    listenPort: () => ctx.listenPort(),
    appVersion: deps.appVersion,
    limiter: createRateLimiter({
      max: GATEWAY_LIMITS.rateMax,
      windowMs: GATEWAY_LIMITS.rateWindowMs,
      maxKeys: GATEWAY_LIMITS.rateMaxKeys,
    }),
    cliToken: createCliTokenReader(deps.home),
    activity,
  });
  registerSessionRoutes(app, createSessionHandlers({ key, crypto, reader, deps, ctx }));
  registerInternalRoutes(app, () => activity.view(ctx.hub.activeStreams()));
}
