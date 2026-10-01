import type { ChildProcess } from 'node:child_process';
import { fork, spawn } from 'node:child_process';
import type { SupervisedService } from '@fathom/contracts/admin/ipc';
import { treeKill } from '@fathom/shared-kernel/proc/proc';

// ADR-012 §2·§4 · Brief §4.1.4 — 자식 생성 어댑터. `detached`(POSIX) = 자식이 프로세스 그룹 리더가 되어 `treeKill`이 손자까지 닿는다.
// supervisor 사망 시 정리는 그룹이 아니라 IPC 끊김으로 한다(서비스가 disconnect → exit).
export type ChildSpec = {
  readonly svc: SupervisedService;
  readonly kind: 'fork' | 'spawn';
  readonly entry: string;
  readonly args: readonly string[];
  readonly execArgv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
};
export interface ChildHandle {
  readonly pid: number | null;
  send(msg: unknown): boolean;
  treeKill(): void;
  onMessage(cb: (m: unknown) => void): void;
  onExit(cb: (code: number | null, signal: string | null) => void): void;
  onLine(cb: (stream: 'stdout' | 'stderr', line: string) => void): void;
  /** 자식 핸들·파이프의 오류(STD-TS-34 — 삼키지 않고 supervisor 로그로 보고한다). */
  onError(cb: (what: string, e: unknown) => void): void;
}
export type SpawnChild = (spec: ChildSpec) => ChildHandle;

export const MAX_LINE_CHARS = 8000;
const EXIT_SETTLE_MS = 200; // 'exit' 뒤 IPC 'disconnect'(마지막 메시지 도착)를 기다리는 상한

/** 스트림 조각을 줄로 나눈다(마지막 미완 줄은 버퍼, 줄당 8,000자 초과분 절단). */
export function createLineSplitter(onLine: (line: string) => void): { push(chunk: string): void; flush(): void } {
  let pending = '';
  const emit = (line: string): void => onLine(line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line);
  return {
    push(chunk: string): void {
      pending += chunk;
      let nl = pending.indexOf('\n');
      while (nl >= 0) {
        emit(pending.slice(0, nl).replace(/\r$/, ''));
        pending = pending.slice(nl + 1);
        nl = pending.indexOf('\n');
      }
      if (pending.length > MAX_LINE_CHARS * 4) {
        emit(pending);
        pending = '';
      }
    },
    flush(): void {
      if (pending !== '') {
        emit(pending);
        pending = '';
      }
    },
  };
}

function launch(spec: ChildSpec, platform: NodeJS.Platform): ChildProcess {
  const detached = platform !== 'win32';
  if (spec.kind === 'fork') {
    return fork(spec.entry, [...spec.args], {
      execArgv: [...spec.execArgv],
      env: { ...spec.env },
      cwd: spec.cwd,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
      detached,
      windowsHide: true,
    });
  }
  return spawn(process.execPath, [...spec.execArgv, spec.entry, ...spec.args], {
    env: { ...spec.env },
    cwd: spec.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached,
    windowsHide: true,
    shell: false,
  });
}

export function realSpawnChild(deps?: { platform?: NodeJS.Platform }): SpawnChild {
  const platform = deps?.platform ?? process.platform;
  return (spec: ChildSpec): ChildHandle => {
    const child = launch(spec, platform);
    const pid = child.pid ?? null;
    const messageCbs: ((m: unknown) => void)[] = [];
    const exitCbs: ((code: number | null, signal: string | null) => void)[] = [];
    const lineCbs: ((stream: 'stdout' | 'stderr', line: string) => void)[] = [];
    const errorCbs: ((what: string, e: unknown) => void)[] = [];
    const report = (what: string, e: unknown): void => {
      for (const cb of errorCbs) {
        cb(what, e);
      }
    };
    let exitInfo: { code: number | null; signal: string | null } | null = null;
    let exitFired = false;
    let spawnFailed = false;

    const fireExit = (): void => {
      if (exitFired || exitInfo === null) {
        return;
      }
      exitFired = true;
      for (const cb of exitCbs) {
        cb(exitInfo.code, exitInfo.signal);
      }
    };
    const attach = (stream: 'stdout' | 'stderr', source: NodeJS.ReadableStream | null): void => {
      if (source === null) {
        return;
      }
      source.setEncoding('utf8');
      const splitter = createLineSplitter((line) => {
        for (const cb of lineCbs) {
          cb(stream, line);
        }
      });
      source.on('data', (chunk: string) => splitter.push(chunk));
      source.on('end', () => splitter.flush());
      source.on('error', (e: unknown) => report(`${stream}_pipe`, e)); // 자식 사망 시 파이프가 깨질 수 있다 — 판정은 종료 코드로, 오류는 보고만.
    };
    attach('stdout', child.stdout);
    attach('stderr', child.stderr);
    child.on('message', (m: unknown) => {
      for (const cb of messageCbs) {
        cb(m);
      }
    });
    child.on('error', (e: unknown) => {
      if (pid === null) {
        spawnFailed = true;
        exitInfo = { code: null, signal: 'spawn_error' };
        fireExit();
        return;
      }
      report('child', e); // 실행 중 자식의 오류(kill·send 실패 등) — 종료 판정은 'exit'이 한다.
    });
    child.on('exit', (code, signal) => {
      if (spawnFailed) {
        return;
      }
      exitInfo = { code, signal };
      // 종료 직전 보낸 IPC 메시지(`fatal`)가 'exit'보다 늦게 도착할 수 있다 — 채널이 닫힐 때까지(상한 200ms) 기다린다.
      if (child.connected) {
        child.once('disconnect', fireExit);
        setTimeout(fireExit, EXIT_SETTLE_MS).unref();
      } else {
        fireExit();
      }
    });

    return {
      pid,
      send(msg: unknown): boolean {
        if (!child.connected) {
          return false;
        }
        try {
          child.send(msg as Parameters<ChildProcess['send']>[0], () => undefined);
          return true;
        } catch {
          return false;
        }
      },
      treeKill(): void {
        if (pid === null) {
          return;
        }
        try {
          treeKill(pid);
        } catch {
          // 이미 사라진 프로세스(EPERM 등)는 종료 코드 경로에서 처리된다.
        }
      },
      onMessage(cb): void {
        messageCbs.push(cb);
      },
      onExit(cb): void {
        exitCbs.push(cb);
        fireExit();
      },
      onLine(cb): void {
        lineCbs.push(cb);
      },
      onError(cb): void {
        errorCbs.push(cb);
      },
    };
  };
}
