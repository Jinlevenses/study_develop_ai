import { createRouter, type RouterHistory } from '@tanstack/react-router';
import type { RouterContext } from './lib/router-context.js';
import { routeTree } from './routeTree.gen.js';

/** `history`는 테스트가 메모리 히스토리를 넘길 때만 쓴다(기본 = 브라우저 히스토리). */
export function createAppRouter(ctx: RouterContext, history?: RouterHistory) {
  return createRouter({ routeTree, context: ctx, history, defaultPreload: 'intent', scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
