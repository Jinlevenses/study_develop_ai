// 서비스 런타임 상태(준비·종료·진행 중 요청·무결성) — composition root(createService/buildServiceApp)가 서비스당 1개 만든다(STD-TS-16).

export type IntegrityStatus = 'ok' | 'pending' | 'failed';

export interface ServiceState {
  ready: boolean;
  shuttingDown: boolean;
  integrity: IntegrityStatus;
  /** `integrity === 'failed'`일 때 실패한 파일 이름(readyz reasons용). */
  integrityFailedFiles: string[];
  readonly inFlight: number;
  enterRequest(): void;
  leaveRequest(): void;
  /** 진행 중 요청이 0이 되면 true, `timeoutMs` 안에 안 되면 false. */
  waitIdle(timeoutMs: number): Promise<boolean>;
}

export function createServiceState(init: { readonly ready: boolean }): ServiceState {
  let inFlight = 0;
  const idleWaiters = new Set<() => void>();
  const state: ServiceState = {
    ready: init.ready,
    shuttingDown: false,
    integrity: 'ok',
    integrityFailedFiles: [],
    get inFlight(): number {
      return inFlight;
    },
    enterRequest(): void {
      inFlight += 1;
    },
    leaveRequest(): void {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) {
        for (const w of [...idleWaiters]) {
          idleWaiters.delete(w);
          w();
        }
      }
    },
    waitIdle(timeoutMs: number): Promise<boolean> {
      if (inFlight === 0) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          idleWaiters.delete(onIdle);
          resolve(false);
        }, timeoutMs);
        timer.unref();
        const onIdle = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        idleWaiters.add(onIdle);
      });
    },
  };
  return state;
}
