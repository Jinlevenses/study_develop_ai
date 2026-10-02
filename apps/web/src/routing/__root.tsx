import { createRootRouteWithContext } from '@tanstack/react-router';
import { AppShell } from '../features/shell/chrome/app-shell.js';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import type { RouterContext } from '../lib/router-context.js';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
  notFoundComponent: () => <RouteStub scr="" title="페이지를 찾을 수 없습니다" notFound />,
});
