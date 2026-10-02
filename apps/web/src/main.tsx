import './lib/zod-config.js';
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
import { createQueueCountsSource, QueueHost, ShellDepsProvider } from './features/shell/chrome/shell-deps.js';
import { createApiClient } from './lib/api-client.js';
import { type AttemptQueue, openAttemptQueue, readAttemptCounts } from './lib/attempt-queue.js';
import { type BootState, bootstrapSession } from './lib/bootstrap.js';
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

/**
 * 큐는 BootGate가 `ready`가 된 뒤(= #bt 교환·status·csrf 완료 후)에만 연다 — 열자마자 flush하므로
 * 그 전에 열면 쿠키·CSRF 없는 요청이 401을 받아 큐의 판정표가 전부 failed_permanent로 만든다(Brief §4.6-5).
 */
let queuePromise: Promise<AttemptQueue | null> | null = null;
function openQueueOnce(): Promise<AttemptQueue | null> {
  queuePromise ??= openAttemptQueue({
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
  }).then(
    (opened) => {
      queue = opened;
      return opened;
    },
    () => null, // IndexedDB를 쓸 수 없는 환경 — 큐 없이 셸만 띄운다.
  );
  return queuePromise;
}

function ReadyShell({
  status,
  attemptQueue,
}: {
  status: SessionStatus;
  attemptQueue: AttemptQueue | null;
}): ReactElement {
  const router = useMemo(() => createAppRouter({ queryClient, api }), []);
  useEffect(() => {
    sse.start();
    return () => sse.stop();
  }, []);
  return (
    <ShellDepsProvider value={{ api, sse, queue: attemptQueue, queueCounts: queueCounts.source, hotkeys, status }}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ShellDepsProvider>
  );
}

function ReadyApp({ status }: { status: SessionStatus }): ReactElement {
  return (
    <QueueHost open={openQueueOnce}>
      {(attemptQueue) => <ReadyShell status={status} attemptQueue={attemptQueue} />}
    </QueueHost>
  );
}

function start(root: HTMLElement): void {
  const docEl = document.documentElement;
  applyDocAttrs(docEl, resolveDocAttrs(readThemePref(), windowMedia()));
  watchSystemTheme(docEl, readThemePref);
  // 어떤 await보다 먼저 부트스트랩을 시작한다 — `#bt=` 해시는 이 호출의 동기 구간에서 지워진다(NFR-SEC-019).
  let firstBoot: Promise<BootState> | null = bootstrapSession({ location, history, api, csrf });
  const boot = (): Promise<BootState> => {
    const p = firstBoot ?? bootstrapSession({ location, history, api, csrf });
    firstBoot = null; // '다시 시도'는 새로 부트한다
    return p;
  };
  // AppOffShell의 '보내지 못한 응답 n건' — 전송 없이 읽기만 한다(큐는 ready 뒤에 연다).
  void readAttemptCounts({ now: () => Date.now() }).then(
    (counts) => {
      if (queuePromise === null) {
        queueCounts.notify(counts); // 큐가 이미 열렸다면 큐의 onChange가 정본이다
      }
    },
    () => undefined,
  );
  createRoot(root).render(
    <StrictMode>
      <BootGate boot={boot} signals={signals} queueCounts={queueCounts.source}>
        {(ready) => <ReadyApp status={ready.status} />}
      </BootGate>
    </StrictMode>,
  );
  void registerServiceWorker();
}

start(container);
