import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, type RenderResult, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach } from 'vitest';
import type { ShellDeps } from '../../../../src/features/shell/chrome/shell-deps.js';
import { createQueueCountsSource, ShellDepsProvider } from '../../../../src/features/shell/chrome/shell-deps.js';
import { createApiClient } from '../../../../src/lib/api-client.js';
import { createCsrfStore } from '../../../../src/lib/csrf.js';
import { createHotkeyManager } from '../../../../src/lib/hotkeys.js';
import { createQueryClient } from '../../../../src/lib/query-client.js';
import { createSseConnection } from '../../../../src/lib/sse.js';
import { createAppRouter } from '../../../../src/router.js';
import { useHatStore } from '../../../../src/stores/hat.js';
import { useHotkeysStore } from '../../../../src/stores/hotkeys.js';
import { useLayoutStore } from '../../../../src/stores/layout.js';
import { usePaletteStore } from '../../../../src/stores/palette.js';
import { FakeEventSource } from '../../lib/support/fake-event-source.js';
import { fakeFetch, problemResponse } from '../../lib/support/fixtures.js';

// happy-dom에 없는 브라우저 API — Radix가 마운트 때 쓴다.
class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = FakeResizeObserver;
}
Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.setPointerCapture ??= () => undefined;

export const SAMPLE_ULID = '01J0000000000000000000000A';

export interface RenderedApp {
  readonly utils: RenderResult;
  readonly router: ReturnType<typeof createAppRouter>;
  readonly deps: ShellDeps;
  readonly sse: ReturnType<typeof createSseConnection>;
  readonly fetchCalls: () => string[];
  readonly queueCounts: ReturnType<typeof createQueueCountsSource>;
  readonly es: () => FakeEventSource;
}

export interface RenderOptions {
  readonly responses?: Parameters<typeof fakeFetch>;
  readonly startSse?: boolean;
}

export function resetStores(): void {
  window.localStorage.clear();
  useHatStore.setState({ hat: 'learn' });
  usePaletteStore.setState({ open: false, query: '' });
  useHotkeysStore.setState({ helpOpen: false });
  useLayoutStore.setState({ contextOpen: {}, drawerOpen: false, focusMode: false });
}

afterEach(() => {
  cleanup();
  resetStores();
});

/** 메모리 히스토리로 앱 셸 전체(라우터 + Query + 셸 의존성)를 렌더한다. */
export function renderApp(path: string, opts: RenderOptions = {}): RenderedApp {
  FakeEventSource.instances = [];
  const f = fakeFetch(...(opts.responses ?? [() => problemResponse(404, 'GW-NOTFOUND-001')]));
  const csrf = createCsrfStore();
  const api = createApiClient({ fetch: f.fetch, csrf, newKey: () => 'K' });
  const queryClient = createQueryClient();
  const queueCounts = createQueueCountsSource();
  const sse = createSseConnection({
    EventSourceCtor: FakeEventSource,
    invalidate: () => undefined,
    api,
    onSessionLost: () => undefined,
    onResync: () => undefined,
    onFlushAttempts: () => undefined,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(typeof h === 'number' ? h : undefined),
  });
  if (opts.startSse !== false) {
    sse.start();
  }
  const hotkeys = createHotkeyManager({ platform: 'other', now: () => Date.now() });
  const deps: ShellDeps = { api, sse, queue: null, queueCounts: queueCounts.source, hotkeys, status: null };
  const router = createAppRouter({ queryClient, api }, createMemoryHistory({ initialEntries: [path] }));
  const tree: ReactElement = (
    <ShellDepsProvider value={deps}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ShellDepsProvider>
  );
  const utils = render(tree);
  return {
    utils,
    router,
    deps,
    sse,
    fetchCalls: () => f.calls.map((c) => c.url),
    queueCounts,
    es: () => {
      const e = FakeEventSource.instances[0];
      if (e === undefined) {
        throw new Error('SSE가 시작되지 않았습니다');
      }
      return e;
    },
  };
}
