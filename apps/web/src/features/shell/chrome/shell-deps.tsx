import type { SessionStatus as SessionStatusT } from '@fathom/contracts/http/gateway/v1/session';
import { createContext, type ReactElement, type ReactNode, useContext, useEffect, useState } from 'react';
import type { ApiClient } from '../../../lib/api-client.js';
import type { AttemptQueue, QueueCounts } from '../../../lib/attempt-queue.js';
import type { HotkeyManager } from '../../../lib/hotkeys.js';
import type { SseConnection } from '../../../lib/sse.js';

/** attempt 큐 개수의 외부 스토어(`useSyncExternalStore`용) — `getSnapshot`은 변경 시에만 새 객체를 돌려준다. */
export interface QueueCountsSource {
  getSnapshot(): QueueCounts;
  subscribe(listener: () => void): () => void;
}

export interface QueueCountsHandle {
  readonly source: QueueCountsSource;
  /** `openAttemptQueue`의 `onChange`에 연결한다. */
  readonly notify: (counts: QueueCounts) => void;
}

const EMPTY_COUNTS: QueueCounts = { pending: 0, sending: 0, failed_permanent: 0, retryInMs: null };

export function createQueueCountsSource(initial: QueueCounts = EMPTY_COUNTS): QueueCountsHandle {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    source: {
      getSnapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    notify: (counts) => {
      if (
        counts.pending === current.pending &&
        counts.sending === current.sending &&
        counts.failed_permanent === current.failed_permanent &&
        counts.retryInMs === current.retryInMs
      ) {
        return;
      }
      current = counts;
      for (const l of [...listeners]) {
        l();
      }
    },
  };
}

export interface ShellDeps {
  readonly api: ApiClient;
  readonly sse: SseConnection;
  /** IndexedDB를 쓸 수 없으면 null(셸은 큐 없이도 동작한다). */
  readonly queue: AttemptQueue | null;
  readonly queueCounts: QueueCountsSource;
  readonly hotkeys: HotkeyManager;
  /** 부트스트랩이 돌려준 세션 상태(부트 전·테스트는 null). */
  readonly status: SessionStatusT | null;
}

const ShellDepsContext = createContext<ShellDeps | null>(null);

export function ShellDepsProvider({ value, children }: { value: ShellDeps; children: ReactNode }): ReactElement {
  return <ShellDepsContext.Provider value={value}>{children}</ShellDepsContext.Provider>;
}

export function useShellDeps(): ShellDeps {
  const deps = useContext(ShellDepsContext);
  if (deps === null) {
    throw new Error('ShellDepsProvider 밖에서 셸 의존성을 읽었습니다');
  }
  return deps;
}

export interface QueueHostProps {
  /** 큐를 연다(호출 시점에 곧바로 flush되므로 BootGate가 `ready`가 된 뒤에만 마운트된다). 앱 수명 동안 한 번만 열도록 호출 측이 메모이즈한다. */
  readonly open: () => Promise<AttemptQueue | null>;
  readonly children: (queue: AttemptQueue | null) => ReactNode;
}

/**
 * attempt 큐를 `ready` 이후에 여는 호스트(Brief §4.6-5). 세션 교환·status·csrf가 끝나기 전에는 마운트되지 않으므로
 * 큐의 즉시 flush가 쿠키·CSRF 없이 나가 영구 실패로 굳는 일이 없다. 열리기 전에는 아무것도 그리지 않는다.
 */
export function QueueHost({ open, children }: QueueHostProps): ReactNode {
  const [state, setState] = useState<{ readonly queue: AttemptQueue | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void open().then((queue) => {
      if (!cancelled) {
        setState({ queue });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);
  return state === null ? null : children(state.queue);
}
