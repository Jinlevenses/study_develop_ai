import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { cspFor } from '../../constants.js';

// CR-61 · D-STD-24 — 보안 헤더 훅(registerAll 첫 번째: 이후 등록되는 모든 gateway 응답에 적용). `/internal/`·하이잭된 SSE는 제외한다.
// 429 응답에는 problem의 `retry_after_ms`로 `retry-after`를 단다(Brief §4.1.4).

function retryAfterSeconds(payload: unknown): string {
  if (typeof payload === 'string') {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (typeof parsed === 'object' && parsed !== null && 'retry_after_ms' in parsed) {
        const ms = parsed.retry_after_ms;
        if (typeof ms === 'number' && Number.isFinite(ms)) {
          return String(Math.max(1, Math.ceil(ms / 1000)));
        }
      }
    } catch {
      return '1';
    }
  }
  return '1';
}

export function registerSecurityHeaders(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): void {
  const profile = ctx.opts.profileOverride ?? deps.profile;
  app.fastify.addHook('onSend', (req, reply, payload, done) => {
    const q = req.url.indexOf('?');
    const path = q >= 0 ? req.url.slice(0, q) : req.url;
    if (!path.startsWith('/internal/')) {
      reply.header('content-security-policy', cspFor(profile, ctx.listenPort() ?? 0));
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'no-referrer');
      const type = reply.getHeader('content-type');
      if (reply.statusCode === 429 && typeof type === 'string' && type.startsWith('application/problem+json')) {
        reply.header('retry-after', retryAfterSeconds(payload));
      }
    }
    done(null, payload);
  });
}
