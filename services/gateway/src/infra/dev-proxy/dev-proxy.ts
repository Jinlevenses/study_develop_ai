import fastifyHttpProxy from '@fastify/http-proxy';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { DEFAULT_VITE_ORIGIN } from '../../constants.js';
import { guardWebShellRequest } from '../../http/static/static-route.js';

// dev 단일 origin(ARC §14.3) — `http://127.0.0.1:4847` 하나로 Vite(5173)를 중계한다. HMR WebSocket도 같은 origin으로 받는다.
// `undici`를 직접 쓰지 않는다(플러그인 내부 의존은 허용). 업그레이드(WebSocket) 요청도 @fastify/http-proxy(11.x) `handleUpgrade`가
// `fastify.routing`으로 보내므로 preHandler(Host 421 · /api·/internal 404)를 지난다 — IT-102가 `Host: evil.test` 업그레이드 = 421을 검증한다.

export async function registerDevProxy(app: ServiceApp, ctx: GatewayContext): Promise<void> {
  await app.fastify.register(fastifyHttpProxy, {
    upstream: ctx.opts.viteOrigin ?? DEFAULT_VITE_ORIGIN,
    prefix: '/',
    websocket: true,
    httpMethods: ['GET', 'HEAD'],
    preHandler(req, _reply, done): void {
      try {
        guardWebShellRequest(req, ctx);
        done();
      } catch (e) {
        done(e instanceof Error ? e : new Error('invariant: non-error thrown in dev proxy guard'));
      }
    },
  });
}
