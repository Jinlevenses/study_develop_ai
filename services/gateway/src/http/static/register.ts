import fastifyStatic from '@fastify/static';
import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { registerDevProxy } from '../../infra/dev-proxy/dev-proxy.js';
import { resolveStaticTarget } from '../../infra/static/resolve.js';
import { registerStaticRoutes } from './static-route.js';

// 웹 셸(AP-12) — 정적 루트가 정해지면 정적 + SPA 폴백, dev 프로파일이면 Vite 프록시. 와일드카드라 registerAll의 마지막이다.

type Shell =
  | { readonly kind: 'static'; readonly root: string }
  | { readonly kind: 'proxy' }
  | { readonly kind: 'none' };

/** 루트 결정: `opts.webRoot`가 있으면 그 값(`null` = 정적 없음) · 아니면 dev → 프록시 · 그 밖 → 저장소의 `apps/web/dist/`. */
function decideShell(deps: ServiceDeps<null>, ctx: GatewayContext): Shell {
  const { webRoot, profileOverride } = ctx.opts;
  if (webRoot !== undefined) {
    return webRoot === null ? { kind: 'none' } : { kind: 'static', root: webRoot };
  }
  return (profileOverride ?? deps.profile) === 'dev' ? { kind: 'proxy' } : { kind: 'static', root: ctx.defaultWebRoot };
}

export async function registerWebShell(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): Promise<void> {
  const shell = decideShell(deps, ctx);
  if (shell.kind === 'none') {
    return;
  }
  if (shell.kind === 'proxy') {
    await registerDevProxy(app, ctx);
    return;
  }
  // 루트는 sendFile 호출마다 넘긴다 — 플러그인에 `root`를 주면 디렉터리가 없을 때 기동이 실패한다(여기서는 경고만).
  await app.fastify.register(fastifyStatic, { serve: false });
  if ((await resolveStaticTarget(shell.root, '/index.html')).kind !== 'file') {
    deps.log.warn({ event: 'gateway.static.web_root_missing' }, 'web root has no index.html');
  }
  registerStaticRoutes(app, shell.root, ctx);
}
