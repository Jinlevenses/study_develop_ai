import { ErrorPanel } from '@fathom/ui/components/error-panel';
import { Skeleton } from '@fathom/ui/components/skeleton';
import { showToast } from '@fathom/ui/components/toast';
import { type ReactElement, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BootState } from '../../../lib/bootstrap.js';
import { AppOffShell } from './app-off-shell.js';
import { ReconnectScreen } from './reconnect-screen.js';
import type { QueueCountsSource } from './shell-deps.js';

type Ready = Extract<BootState, { kind: 'ready' }>;

/** api-client·SSE가 부트 이후에 올리는 신호(세션 끊김·버전 불일치)를 BootGate로 전달한다. */
export type BootSignal =
  | { readonly kind: 'session_lost'; readonly code: string }
  | { readonly kind: 'version_mismatch' };

export interface BootSignals {
  sessionLost(code: string): void;
  versionMismatch(): void;
  subscribe(listener: (signal: BootSignal) => void): () => void;
}

export function createBootSignals(): BootSignals {
  const listeners = new Set<(signal: BootSignal) => void>();
  return {
    sessionLost: (code) => {
      for (const l of [...listeners]) {
        l({ kind: 'session_lost', code });
      }
    },
    versionMismatch: () => {
      for (const l of [...listeners]) {
        l({ kind: 'version_mismatch' });
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface BootGateProps {
  readonly boot: () => Promise<BootState>;
  readonly signals: BootSignals;
  readonly queueCounts: QueueCountsSource;
  readonly children: (ready: Ready) => ReactNode;
}

type Phase = { readonly kind: 'booting' } | BootState;

function notifyNewVersion(): void {
  // 자동 새로고침은 하지 않는다 — 무한 루프 방지(STD-WEB-42).
  showToast({
    type: 'warn',
    title: '새 버전이 준비되었습니다',
    description: '새로고침하면 적용됩니다',
    action: { label: '새로고침', onSelect: () => location.reload() },
  });
}

/** ST-BOOT·ST-SESSION-LOST·AppOffShell·ST-ERROR를 가르는 부트 관문(SCR §2.2). */
export function BootGate({ boot, signals, queueCounts, children }: BootGateProps): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'booting' });
  const [attempt, setAttempt] = useState(0);
  const toasted = useRef(false);
  // StrictMode가 효과를 두 번 돌려도 부트(토큰 교환 포함)는 시도당 한 번만 실행한다.
  const inflight = useRef<{ readonly attempt: number; readonly promise: Promise<BootState> } | null>(null);
  const counts = useSyncExternalStore(queueCounts.subscribe, queueCounts.getSnapshot);

  useEffect(() => {
    const off = signals.subscribe((signal) => {
      if (signal.kind === 'session_lost') {
        setPhase({ kind: 'session_lost', code: signal.code });
      } else if (!toasted.current) {
        toasted.current = true;
        notifyNewVersion();
      }
    });
    return off;
  }, [signals]);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'booting' });
    if (inflight.current === null || inflight.current.attempt !== attempt) {
      inflight.current = { attempt, promise: boot() };
    }
    void inflight.current.promise.then((next) => {
      if (cancelled) {
        return;
      }
      if (next.kind === 'ready' && next.versionMismatch && !toasted.current) {
        toasted.current = true;
        notifyNewVersion();
      }
      setPhase(next);
    });
    return () => {
      cancelled = true;
    };
  }, [boot, attempt]);

  switch (phase.kind) {
    case 'booting':
      return <Skeleton shape="block" delayMs={300} />;
    case 'session_lost':
      return <ReconnectScreen />;
    case 'app_off':
      return <AppOffShell unsent={counts.pending + counts.sending} />;
    case 'error': {
      const f = phase.failure;
      const problem =
        f.kind === 'problem'
          ? { title: f.problem.title, code: f.problem.code, detail: f.problem.detail, error_id: f.problem.error_id }
          : { title: '앱을 시작하지 못했습니다', code: 'WEB-BOOT' };
      return (
        <main className="mx-auto flex min-h-dvh max-w-(--measure-read) flex-col justify-center p-6">
          <ErrorPanel problem={problem} actions={[{ label: '다시 시도', onSelect: () => setAttempt((n) => n + 1) }]} />
        </main>
      );
    }
    case 'ready':
      return <>{children(phase)}</>;
  }
}
