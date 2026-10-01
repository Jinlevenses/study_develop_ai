import type { RunModeArgs } from '@fathom/contracts/admin/ipc';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import { DEFAULT_EXEC_ARGV_DIST, joinInside, SERVICE_DIRS } from './bundle.js';
import type { ChildSpec, SpawnChild } from './child.js';
import type { Timers } from './dev-watch.js';

// IF-IPC-011 · Brief §4.1.11 — 단명 run_mode 자식(봉투 없음). 같은 진입 파일을 `--mode=migrate|restore|verify`로 띄우고 stdout·stderr 꼬리를 모은다.
export const RUN_MODE_TIMEOUT_MS = 600_000;
const TAIL_LINES = 200;
const TAIL_LINE_CHARS = 2000;
export type RunModeResult = { readonly exit_code: number; readonly tail: readonly string[] };

export function runModeArgv(args: RunModeArgs): string[] {
  if (args.mode === 'migrate') {
    return [
      '--mode=migrate',
      ...(args.dry_run ? ['--dry-run'] : []),
      ...(args.db_copy_dir === null ? [] : [`--db-copy-dir=${args.db_copy_dir}`]),
    ];
  }
  if (args.mode === 'restore') {
    return ['--mode=restore', `--from=${args.from}`, `--rewind-cursors=${canonicalJson(args.rewind_cursors)}`];
  }
  return [
    '--mode=verify',
    ...(args.replay ? ['--replay'] : []),
    ...(args.db_copy_dir === null ? [] : [`--db-copy-dir=${args.db_copy_dir}`]),
  ];
}

export type RunModeEntry = { readonly entry: string; readonly execArgv: readonly string[]; readonly cwd: string };

const ABSOLUTE_DIR = /^(\/|[A-Za-z]:[\\/])/;

/**
 * migrate에 `app_dir`가 있으면 그 설치본의 dist 진입을 쓴다(업그레이드 사전 검사).
 * 상대 경로·결합 거부(`null`)면 `null`을 돌려주고 호출자는 실행하지 않는다(STD-TS-42).
 */
export function runModeEntry(svc: ServiceName, args: RunModeArgs, base: RunModeEntry): RunModeEntry | null {
  if (args.mode === 'migrate' && args.app_dir !== null) {
    const entry = ABSOLUTE_DIR.test(args.app_dir)
      ? joinInside(args.app_dir, `services/${SERVICE_DIRS[svc]}/dist/main.js`)
      : null;
    return entry === null ? null : { entry, execArgv: DEFAULT_EXEC_ARGV_DIST, cwd: args.app_dir };
  }
  return base;
}

export type RunModeRunnerDeps = {
  readonly spawnChild: SpawnChild;
  readonly timers: Timers;
  readonly env: Readonly<Record<string, string>>;
  readonly onLine: (svc: ServiceName, stream: 'stdout' | 'stderr', line: string) => void;
  readonly onError?: (svc: ServiceName, what: string, e: unknown) => void;
};

export interface RunModeRunner {
  isBusy(svc: ServiceName): boolean;
  /** 종료 중 — 실행 중인 run_mode 자식을 모두 트리 종료하고 각 결과를 exit_code 70·`supervisor: run_mode aborted`로 마감한다. */
  abortAll(): void;
  run(svc: ServiceName, args: RunModeArgs, base: RunModeEntry): Promise<RunModeResult>;
}

export function createRunModeRunner(d: RunModeRunnerDeps): RunModeRunner {
  const busy = new Set<ServiceName>();
  const aborts = new Set<() => void>();
  return {
    isBusy: (svc) => busy.has(svc),
    abortAll(): void {
      for (const abort of [...aborts]) {
        abort();
      }
    },
    run(svc, args, base): Promise<RunModeResult> {
      if (busy.has(svc)) {
        return Promise.resolve({ exit_code: 75, tail: ['supervisor: run_mode busy'] });
      }
      const target = runModeEntry(svc, args, base);
      if (target === null) {
        return Promise.resolve({ exit_code: 64, tail: ['supervisor: run_mode app_dir must be an absolute path'] });
      }
      busy.add(svc);
      const spec: ChildSpec = {
        svc,
        kind: 'fork',
        entry: target.entry,
        args: runModeArgv(args),
        execArgv: target.execArgv,
        env: d.env,
        cwd: target.cwd,
      };
      return new Promise<RunModeResult>((resolve) => {
        const tail: string[] = [];
        const push = (line: string): void => {
          tail.push(line.length > TAIL_LINE_CHARS ? line.slice(0, TAIL_LINE_CHARS) : line);
          if (tail.length > TAIL_LINES) {
            tail.shift();
          }
        };
        let child: ReturnType<SpawnChild>;
        let cancel: () => void = () => undefined;
        let settled = false;
        const abort = (): void => {
          push('supervisor: run_mode aborted');
          child.treeKill();
          finish(70);
        };
        const finish = (exitCode: number): void => {
          if (settled) {
            return;
          }
          settled = true;
          cancel();
          aborts.delete(abort);
          busy.delete(svc);
          resolve({ exit_code: exitCode, tail: [...tail] });
        };
        try {
          child = d.spawnChild(spec);
        } catch {
          push('supervisor: run_mode spawn failed');
          finish(70);
          return;
        }
        aborts.add(abort);
        child.onLine((stream, line) => {
          push(line);
          d.onLine(svc, stream, line);
        });
        child.onMessage(() => undefined);
        child.onError((what, e) => d.onError?.(svc, what, e));
        child.onExit((code) => finish(code ?? 70));
        cancel = d.timers.after(RUN_MODE_TIMEOUT_MS, () => {
          push('supervisor: run_mode timeout');
          child.treeKill();
          finish(70);
        });
      });
    },
  };
}
