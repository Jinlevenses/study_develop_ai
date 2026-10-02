import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import type { HotkeyManager } from '../../../lib/hotkeys.js';
import { useHatStore } from '../../../stores/hat.js';
import { useHotkeysStore } from '../../../stores/hotkeys.js';
import { useLayoutStore } from '../../../stores/layout.js';
import { usePaletteStore } from '../../../stores/palette.js';

export type GlobalPath = '/' | '/map' | '/review/weekly' | '/inbox' | '/settings' | '/ai' | '/ops' | '/curation';

interface GoTarget {
  readonly key: string;
  readonly to: GlobalPath;
  /** 관리 대상은 모자를 `admin`으로 먼저 바꾼다. */
  readonly admin: boolean;
}

// SCR §2.3 전역 키맵 — `G` 다음 한 글자.
const GO_TARGETS: readonly GoTarget[] = [
  { key: 'H', to: '/', admin: false },
  { key: 'M', to: '/map', admin: false },
  { key: 'R', to: '/review/weekly', admin: false },
  { key: 'I', to: '/inbox', admin: false },
  { key: 'S', to: '/settings', admin: true },
  { key: 'A', to: '/ai', admin: true },
  { key: 'O', to: '/ops', admin: true },
  { key: 'C', to: '/curation', admin: true },
];

const LG_QUERY = '(min-width: 1280px)';

function isLargeViewport(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(LG_QUERY).matches
  );
}

/**
 * 전역 단축키(SCR §2.3): Mod+K 팔레트(K1) · ? 도움말(K2) · Escape 닫기(K3) · Mod+\ Context 토글 ·
 * Mod+Shift+F 집중 모드 · 시퀀스 G→H·M·R·I·S·A·O·C. `document` keydown 리스너 1개가 `handleKeyDown`으로 넘긴다.
 */
export function useGlobalHotkeys(hotkeys: HotkeyManager, navigate: (to: GlobalPath) => void): void {
  const routeId = useRouterState({ select: (s) => s.matches.at(-1)?.routeId ?? '__root__' });
  const routeIdRef = useRef(routeId);
  routeIdRef.current = routeId;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const offs: (() => void)[] = [];
    offs.push(hotkeys.register('global', 'Mod+K', () => usePaletteStore.getState().openPalette()));
    offs.push(hotkeys.register('global', '?', () => useHotkeysStore.getState().openHelp()));
    offs.push(
      hotkeys.register(
        'global',
        'Escape',
        () => {
          if (usePaletteStore.getState().open) {
            usePaletteStore.getState().closePalette();
          }
          if (useHotkeysStore.getState().helpOpen) {
            useHotkeysStore.getState().closeHelp();
          }
        },
        { allowInInput: true },
      ),
    );
    offs.push(
      hotkeys.register('global', 'Mod+\\', () => {
        const layout = useLayoutStore.getState();
        if (isLargeViewport()) {
          layout.toggleContext(routeIdRef.current);
        } else {
          layout.toggleDrawer();
        }
      }),
    );
    offs.push(hotkeys.register('global', 'Mod+Shift+F', () => useLayoutStore.getState().toggleFocus()));
    for (const target of GO_TARGETS) {
      offs.push(
        hotkeys.registerSequence('G', target.key, () => {
          if (target.admin) {
            useHatStore.getState().setHat('admin');
          }
          navigateRef.current(target.to);
        }),
      );
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      hotkeys.handleKeyDown(e);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const off of offs) {
        off();
      }
    };
  }, [hotkeys]);
}
