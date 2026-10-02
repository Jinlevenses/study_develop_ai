import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { cspFor } from '../../constants.js';
import { isEncodedBypass } from '../../domain/session/path.js';

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

/**
 * 경로 우회 방어(UT-GW-112~115 · SEC-GW-002 · NFR-SEC-019) — 라우터는 `%XX`를 풀고 매칭하지만 공통 파이프라인의 인증은 원본 접두사를 본다.
 * 디코딩하면 `/api/`·`/internal/`인데 원본이 정규형이 아닌 요청(`/%61pi/…`, `/api/v1/%63li/…`)·origin-form이 아닌 요청 대상(`GET http://127.0.0.1:4747/api/…`)은 어느 핸들러에도 닿기 전에 404로 거른다.
 * 파이프라인 훅 뒤에 등록되지만 핸들러보다 앞이라(onRequest 순차 실행) 인증 누락이 응답으로 새지 않는다.
 * 근본 원인(shared-kernel pipeline.ts의 원본 접두사 분류)은 T-00-08에 security 에스컬레이션으로 올렸다 — 수정이 들어와도 이 방어는 무해한 이중 방어다.
 */
export function registerPathGuard(app: ServiceApp): void {
  app.fastify.addHook('onRequest', (req, _reply, done) => {
    if (isEncodedBypass(req.url)) {
      done(new AppError('GW-NOTFOUND-900', 404, '정의되지 않은 경로다.'));
      return;
    }
    done();
  });
}

export function registerSecurityHeaders(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): void {
  registerPathGuard(app);
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
