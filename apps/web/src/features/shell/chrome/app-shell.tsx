import { LiveRegion } from '@fathom/ui/components/live-region';
import { Toaster } from '@fathom/ui/components/toast';
import { MOTION_CONFIG_PROPS } from '@fathom/ui/motion';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import type { ReactElement } from 'react';
import { ContextPanel } from './context-panel.js';
import { type GlobalPath, useGlobalHotkeys } from './global-hotkeys.js';
import { AppHeader } from './header.js';
import { BottomTabs, NavRail } from './nav-rail.js';
import { useShellDeps } from './shell-deps.js';

/** GLB-SHELL — 헤더·레일·본문·Context 패널·하단 탭·라이브 리전·토스트(SCR §2.1). */
export function AppShell(): ReactElement {
  const { hotkeys } = useShellDeps();
  const navigate = useNavigate();
  useGlobalHotkeys(hotkeys, (to: GlobalPath) => {
    void navigate({ to });
  });
  return (
    <MotionConfig {...MOTION_CONFIG_PROPS}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-(--z-toast) focus:rounded-control focus:bg-surface-3 focus:px-3 focus:py-2"
      >
        본문으로 건너뛰기
      </a>
      <div className="flex min-h-dvh flex-col bg-bg text-fg">
        <AppHeader />
        <div className="flex min-h-0 flex-1">
          <NavRail />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6">
            <Outlet />
          </main>
          <ContextPanel />
        </div>
        <BottomTabs />
      </div>
      <LiveRegion politeness="polite" message="" />
      <LiveRegion politeness="assertive" message="" />
      <Toaster />
    </MotionConfig>
  );
}
