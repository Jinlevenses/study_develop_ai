import { Drawer, DrawerContent } from '@fathom/ui/components/drawer';
import { useRouterState } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { resolveContextOpen, useLayoutStore } from '../../../stores/layout.js';

const EMPTY_LINE = '이 화면의 맥락 정보가 여기에 표시됩니다';

/** 현재 화면의 라우트 id(경로 템플릿) — `fathom.ctx.<route id>` 키에 쓴다. */
export function useRouteId(): string {
  return useRouterState({ select: (s) => s.matches.at(-1)?.routeId ?? '__root__' });
}

/** `lg` 이상은 우측 `aside`, 그 아래는 Drawer(Mod+\로 연다). */
export function ContextPanel(): ReactElement | null {
  const routeId = useRouteId();
  const contextOpen = useLayoutStore((s) => s.contextOpen);
  const drawerOpen = useLayoutStore((s) => s.drawerOpen);
  const closeDrawer = useLayoutStore((s) => s.closeDrawer);
  const open = resolveContextOpen(contextOpen, routeId);
  return (
    <>
      {open ? (
        <aside
          aria-label="맥락 패널"
          className="hidden w-(--shell-context-w) shrink-0 border-l border-border bg-surface-1 p-4 lg:block"
        >
          <p>{EMPTY_LINE}</p>
        </aside>
      ) : null}
      <Drawer open={drawerOpen} onOpenChange={(next) => (next ? undefined : closeDrawer())}>
        <DrawerContent title="맥락 패널" side="right">
          <p>{EMPTY_LINE}</p>
        </DrawerContent>
      </Drawer>
    </>
  );
}
