import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import 'd2coding/d2coding-subset.css';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles/app.css';
import type { SessionStatus } from '@fathom/contracts/http/gateway/v1/session';
import { SessionsAttemptsSubmitRoute } from '@fathom/contracts/http/gateway/v1/sessions';
import { showToast } from '@fathom/ui/components/toast';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { type ReactElement, StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { BootGate, type BootSignals, createBootSignals } from './features/shell/chrome/boot-gate.js';
import { createQueueCountsSource, ShellDepsProvider } from './features/shell/chrome/shell-deps.js';
import { createApiClient } from './lib/api-client.js';
import { type AttemptQueue, openAttemptQueue } from './lib/attempt-queue.js';
import { bootstrapSession } from './lib/bootstrap.js';
import { createCsrfStore } from './lib/csrf.js';
import { createHotkeyManager, detectPlatform, parseKeymap } from './lib/hotkeys.js';
import { createUlidFactory } from './lib/idempotency.js';
import type { Invalidation } from './lib/invalidation-map.js';
import { createQueryClient } from './lib/query-client.js';
import { createSseConnection } from './lib/sse.js';
import { registerServiceWorker } from './lib/sw-register.js';
import { applyDocAttrs, readThemePref, resolveDocAttrs, watchSystemTheme, windowMedia } from './lib/theme.js';
import { readPref } from './lib/ui-prefs.js';
import { createAppRouter } from './router.js';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root 요소가 없습니다');
}

let queue: AttemptQueue | null = null;
const csrf = createCsrfStore();
const signals: BootSignals = createBootSignals();
const api = createApiClient({
  fetch: globalThis.fetch.bind(globalThis),
  csrf,
  newKey: createUlidFactory(() => Date.now()),
  onSessionLost: (code) => signals.sessionLost(code),
  onVersionMismatch: () => signals.versionMismatch(),
});
const queryClient = createQueryClient();
const queueCounts = createQueueCountsSource();
const hotkeys = createHotkeyManager({
  platform: detectPlatform(navigator.userAgent),
  now: () => Date.now(),
  keymap: parseKeymap(readPref('fathom.keymap.v1')),
});
const sse = createSseConnection({
  EventSourceCtor: EventSource,
  invalidate: (inv: Invalidation) => {
    if (inv === 'all') {
      void queryClient.invalidateQueries();
      return;
    }
    for (const queryKey of inv) {
      void queryClient.invalidateQueries({ queryKey });
    }
  },
  api,
  onSessionLost: (code) => signals.sessionLost(code),
  onResync: () => showToast({ type: 'info', title: '재연결됨' }),
  onFlushAttempts: () => {
    void queue?.flush();
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(typeof h === 'number' ? h : undefined),
});

function ReadyApp({ status }: { status: SessionStatus }): ReactElement {
  const router = useMemo(() => createAppRouter({ queryClient, api }), []);
  useEffect(() => {
    sse.start();
    return () => sse.stop();
  }, []);
  return (
    <ShellDepsProvider value={{ api, sse, queue, queueCounts: queueCounts.source, hotkeys, status }}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ShellDepsProvider>
  );
}

async function start(root: HTMLElement): Promise<void> {
  const docEl = document.documentElement;
  applyDocAttrs(docEl, resolveDocAttrs(readThemePref(), windowMedia()));
  watchSystemTheme(docEl, readThemePref);
  try {
    queue = await openAttemptQueue({
      send: (rec) =>
        api.call(
          SessionsAttemptsSubmitRoute,
          { params: { session_id: rec.session_id }, body: rec.payload },
          { idempotencyKey: rec.idempotency_key },
        ),
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(typeof h === 'number' ? h : undefined),
      onChange: queueCounts.notify,
    });
  } catch {
    // IndexedDB를 쓸 수 없는 환경 — 큐 없이 셸만 띄운다.
    queue = null;
  }
  const boot = () => bootstrapSession({ location, history, api, csrf });
  createRoot(root).render(
    <StrictMode>
      <BootGate boot={boot} signals={signals} queueCounts={queueCounts.source}>
        {(ready) => <ReadyApp status={ready.status} />}
      </BootGate>
    </StrictMode>,
  );
  void registerServiceWorker();
}

void start(container);
