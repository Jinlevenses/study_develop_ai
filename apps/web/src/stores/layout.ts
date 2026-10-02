import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { readPref, writePref } from '../lib/ui-prefs.js';

export interface LayoutState {
  /** 이 세션에서 토글한 라우트별 Context 패널 상태(없으면 `fathom.ctx.<route id>` 저장값, 기본 열림). */
  contextOpen: Record<string, boolean>;
  /** `lg` 미만에서 Context 패널을 Drawer로 여는 상태(저장하지 않음). */
  drawerOpen: boolean;
  focusMode: boolean;
  toggleContext: (routeId: string) => void;
  toggleDrawer: () => void;
  closeDrawer: () => void;
  toggleFocus: () => void;
}

export function contextPrefKey(routeId: string): `fathom.ctx.${string}` {
  return `fathom.ctx.${routeId}`;
}

/** 라우트의 Context 패널 열림 여부 — 세션 토글 > 저장값 > 기본(열림). */
export function resolveContextOpen(
  contextOpen: Readonly<Record<string, boolean>>,
  routeId: string,
  storage?: Storage | null,
): boolean {
  const toggled = contextOpen[routeId];
  if (toggled !== undefined) {
    return toggled;
  }
  return readPref(contextPrefKey(routeId), storage) !== '0';
}

/** 레이아웃 상태 — 서버 데이터를 복사하지 않는다(STD-WEB-11). */
export function createLayoutStore(storage?: Storage | null): UseBoundStore<StoreApi<LayoutState>> {
  return create<LayoutState>()((set, get) => ({
    contextOpen: {},
    drawerOpen: false,
    focusMode: false,
    toggleContext: (routeId) => {
      const next = !resolveContextOpen(get().contextOpen, routeId, storage);
      writePref(contextPrefKey(routeId), next ? '1' : '0', storage);
      set((s) => ({ contextOpen: { ...s.contextOpen, [routeId]: next } }));
    },
    toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
    closeDrawer: () => set({ drawerOpen: false }),
    toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  }));
}

export const useLayoutStore: UseBoundStore<StoreApi<LayoutState>> = createLayoutStore();
