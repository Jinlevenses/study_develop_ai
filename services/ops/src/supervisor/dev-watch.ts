import { watch } from 'node:fs';
import path from 'node:path';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { appPath, joinInside, SERVICE_DIRS } from './bundle.js';

// ADR-012 §10 · CR-07 · AP-12 — dev 프로파일 파일 감시. `node --watch` 대신 정상 수명주기(IPC shutdown → fork)로 영향 서비스만 재기동한다.
export type DevWatchHandle = { close(): void };
/** `onEvent`는 이벤트마다 절대 경로 1개를 받는다(debounce는 호출자가 한다). */
export type DevWatchFactory = (
  roots: readonly string[],
  onEvent: (absPath: string) => void,
  /** watcher `error` 이벤트와 ENOENT 이외의 `watch()` 실패(EMFILE 등)를 받는다 — 호출자가 `supervisor.dev_watch.error` warn으로 남긴다. */
  onError: (root: string, e: unknown) => void,
) => DevWatchHandle;
export type Timers = { after(ms: number, fn: () => void): () => void };

export const DEV_DEBOUNCE_MS = 300;
const SERVICES: readonly ServiceName[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];

export function watchRoots(appRoot: string): string[] {
  return [
    ...Object.values(SERVICE_DIRS).map((dir) => appPath(appRoot, `services/${dir}/src`)),
    appPath(appRoot, 'packages/contracts/src'),
    appPath(appRoot, 'packages/shared-kernel/src'),
  ];
}

export type ChangeImpact = { readonly services: readonly ServiceName[]; readonly supervisorChanged: boolean };

/** 변경 경로 → 영향. `services/<dir>/src/supervisor/**`는 경고만, `services/<dir>/src/**`는 그 서비스, `packages/**`는 5개 전부. */
export function mapChanges(appRoot: string, paths: readonly string[]): ChangeImpact {
  const services = new Set<ServiceName>();
  let supervisorChanged = false;
  for (const p of paths) {
    const rel = path.relative(appRoot, p).split(path.sep).join('/');
    const svc = /^services\/([^/]+)\/src\/(.*)$/.exec(rel);
    if (svc !== null) {
      if ((svc[2] ?? '').startsWith('supervisor/')) {
        supervisorChanged = true;
        continue;
      }
      for (const name of SERVICES) {
        if (SERVICE_DIRS[name] === svc[1]) {
          services.add(name);
        }
      }
    } else if (rel.startsWith('packages/')) {
      for (const name of SERVICES) {
        services.add(name);
      }
    }
  }
  return { services: SERVICES.filter((s) => services.has(s)), supervisorChanged };
}

export type DevWatcherOptions = {
  readonly appRoot: string;
  readonly factory: DevWatchFactory;
  readonly timers: Timers;
  readonly onImpact: (impact: ChangeImpact) => void;
  readonly onError: (root: string, e: unknown) => void;
};

/** 300ms debounce로 이벤트를 모아 한 번에 처리한다. `close()`는 대기 중 타이머와 watcher를 모두 해제한다. */
export function createDevWatcher(o: DevWatcherOptions): DevWatchHandle {
  let batch: string[] = [];
  let cancel: (() => void) | null = null;
  const handle = o.factory(
    watchRoots(o.appRoot),
    (p) => {
      batch.push(p);
      if (cancel === null) {
        cancel = o.timers.after(DEV_DEBOUNCE_MS, () => {
          cancel = null;
          const paths = batch;
          batch = [];
          o.onImpact(mapChanges(o.appRoot, paths));
        });
      }
    },
    o.onError,
  );
  return {
    close(): void {
      cancel?.();
      cancel = null;
      batch = [];
      handle.close();
    },
  };
}

function errnoCode(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}

/** 실제 `fs.watch(recursive)`. 없는 루트(ENOENT, 아직 만들어지지 않은 서비스)만 조용히 건너뛰고, 그 밖의 실패·watcher `error`는 `onError`로 보고한다. */
export const realDevWatch: DevWatchFactory = (roots, onEvent, onError) => {
  const watchers: ReturnType<typeof watch>[] = [];
  for (const root of roots) {
    try {
      const w = watch(root, { recursive: true }, (_event, filename) => {
        onEvent(filename === null ? root : (joinInside(root, filename.toString()) ?? root));
      });
      w.on('error', (e) => onError(root, e));
      watchers.push(w);
    } catch (e) {
      if (errnoCode(e) !== 'ENOENT') {
        onError(root, e);
      }
    }
  }
  return {
    close(): void {
      for (const w of watchers) {
        w.close();
      }
    },
  };
};
