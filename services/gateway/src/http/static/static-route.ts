import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GatewayContext } from '../../config.js';
import { checkHost } from '../../domain/session/guards.js';
import { isGuardedPath, rawPathOf } from '../../domain/session/path.js';
import { cachePolicy } from '../../infra/static/cache-policy.js';
import { isSpaRoute, resolveStaticTarget } from '../../infra/static/resolve.js';

// 정적 파일 + SPA 폴백(AP-12, NFR-PORT-006). GET·HEAD `/`·`/*` — 와일드카드라 registerAll의 마지막에 등록한다.

const NOT_FOUND = (): AppError => new AppError('GW-NOTFOUND-900', 404, '정의되지 않은 경로다.');

/** dev 프록시 preHandler와 정적 핸들러가 공유하는 1·2단계: Host 421 · API/내부 경로 404(SPA가 API 404를 먹지 않게). */
export function guardWebShellRequest(req: FastifyRequest, ctx: GatewayContext): void {
  const port = ctx.listenPort();
  if (port === null) {
    throw new Error('invariant: gateway listen port unknown');
  }
  const host = req.headers.host;
  if (!checkHost(host, port)) {
    throw new AppError('GW-AUTH-005', 421, 'Host가 허용되지 않는다.');
  }
  if (isGuardedPath(req.url)) {
    throw NOT_FOUND();
  }
}

function serve(reply: FastifyReply, root: string, rel: string): FastifyReply {
  return reply.header('cache-control', cachePolicy(rel)).sendFile(rel, root, { cacheControl: false, dotfiles: 'deny' });
}

export function createStaticHandler(
  root: string,
  ctx: GatewayContext,
): (req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply> {
  return async (req, reply): Promise<FastifyReply> => {
    guardWebShellRequest(req, ctx);
    const target = await resolveStaticTarget(root, rawPathOf(req.url));
    if (target.kind === 'forbidden') {
      throw NOT_FOUND();
    }
    if (target.kind === 'file') {
      return serve(reply, root, target.rel);
    }
    if (!isSpaRoute(target.rel)) {
      throw NOT_FOUND();
    }
    const index = await resolveStaticTarget(root, '/index.html');
    if (index.kind !== 'file') {
      throw NOT_FOUND();
    }
    return serve(reply, root, 'index.html');
  };
}

export function registerStaticRoutes(app: ServiceApp, root: string, ctx: GatewayContext): void {
  const handler = createStaticHandler(root, ctx);
  app.fastify.route({ method: ['GET', 'HEAD'], url: '/', handler });
  app.fastify.route({ method: ['GET', 'HEAD'], url: '/*', handler });
}
