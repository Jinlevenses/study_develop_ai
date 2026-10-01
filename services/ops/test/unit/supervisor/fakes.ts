import type { SupervisedService } from '@fathom/contracts/admin/ipc';
import { createLogger } from '@fathom/shared-kernel/log/log';
import type { FakeClock } from '@fathom/testkit/clock';
import { createFakeClock } from '@fathom/testkit/clock';
import type { ChildHandle, ChildSpec, SpawnChild } from '../../../src/supervisor/child.js';
import type { DevWatchFactory, Timers } from '../../../src/supervisor/dev-watch.js';
import type { LogSink, LogSvc } from '../../../src/supervisor/log-sink.js';
import type { RegistryFile, RuntimeFilesPort } from '../../../src/supervisor/runtime-files.js';
import { createSupervisor } from '../../../src/supervisor/supervisor.js';
import type { Supervisor, SupervisorDeps, SupervisorOptions } from '../../../src/supervisor/types.js';

export const HASH = 'a'.repeat(64);
export const BOOT_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

/** 이벤트 루프를 한 바퀴 돌려 대기 중인 Promise 연쇄를 마저 처리한다(실제 sleep 아님). */
export function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

export class FakeChild implements ChildHandle {
  readonly sent: Record<string, unknown>[] = [];
  killed = 0;
  sendOk = true;
  private readonly messageCbs: ((m: unknown) => void)[] = [];
  private readonly exitCbs: ((code: number | null, signal: string | null) => void)[] = [];
  private readonly lineCbs: ((stream: 'stdout' | 'stderr', line: string) => void)[] = [];
  private readonly errorCbs: ((what: string, e: unknown) => void)[] = [];
  readonly spec: ChildSpec;
  readonly pid: number;
  constructor(spec: ChildSpec, pid: number) {
    this.spec = spec;
    this.pid = pid;
  }
  send(msg: unknown): boolean {
    if (!this.sendOk) {
      return false;
    }
    this.sent.push(msg as Record<string, unknown>);
    return true;
  }
  treeKill(): void {
    this.killed += 1;
  }
  onMessage(cb: (m: unknown) => void): void {
    this.messageCbs.push(cb);
  }
  onExit(cb: (code: number | null, signal: string | null) => void): void {
    this.exitCbs.push(cb);
  }
  onLine(cb: (stream: 'stdout' | 'stderr', line: string) => void): void {
    this.lineCbs.push(cb);
  }
  onError(cb: (what: string, e: unknown) => void): void {
    this.errorCbs.push(cb);
  }
  // ── 테스트 조작 ──
  message(m: unknown): void {
    for (const cb of this.messageCbs) {
      cb(m);
    }
  }
  error(what: string, e: unknown): void {
    for (const cb of this.errorCbs) {
      cb(what, e);
    }
  }
  exit(code: number | null, signal: string | null = null): void {
    for (const cb of this.exitCbs) {
      cb(code, signal);
    }
  }
  line(stream: 'stdout' | 'stderr', text: string): void {
    for (const cb of this.lineCbs) {
      cb(stream, text);
    }
  }
  listening(port: number): void {
    this.message({ type: 'listening', v: 1, port });
  }
  ready(hash: string = HASH): void {
    this.message({ type: 'ready', v: 1, contracts_hash: hash, schema_versions: {}, app_version: '1.2.3' });
  }
  sentOfType(type: string): Record<string, unknown>[] {
    return this.sent.filter((m) => m.type === type);
  }
}

export function createFakeSpawn(): {
  spawn: SpawnChild;
  children: FakeChild[];
  of(svc: SupervisedService): FakeChild[];
  last(svc: SupervisedService): FakeChild;
} {
  const children: FakeChild[] = [];
  let pid = 1000;
  return {
    children,
    spawn: (spec) => {
      pid += 1;
      const child = new FakeChild(spec, pid);
      children.push(child);
      return child;
    },
    of: (svc) => children.filter((c) => c.spec.svc === svc),
    last(svc): FakeChild {
      const list = children.filter((c) => c.spec.svc === svc);
      const child = list.at(-1);
      if (child === undefined) {
        throw new Error(`no child forked for ${svc}`);
      }
      return child;
    },
  };
}

export type FakeTimers = Timers & { advance(ms: number): Promise<void>; pending(): number };
export function createFakeTimers(clock: FakeClock): FakeTimers {
  let seq = 0;
  const items = new Map<number, { at: number; fn: () => void }>();
  return {
    after(ms, fn): () => void {
      seq += 1;
      const id = seq;
      items.set(id, { at: clock.now() + ms, fn });
      return (): void => {
        items.delete(id);
      };
    },
    pending: () => items.size,
    async advance(ms): Promise<void> {
      const target = clock.now() + ms;
      for (;;) {
        const due = [...items.entries()]
          .filter(([, v]) => v.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (due === undefined) {
          break;
        }
        items.delete(due[0]);
        clock.advance(Math.max(0, due[1].at - clock.now()));
        due[1].fn();
        await flush();
      }
      clock.advance(target - clock.now());
      await flush();
    },
  };
}

export type FakeFiles = RuntimeFilesPort & {
  registries: RegistryFile[];
  token: string | null;
  removed: boolean;
  last(): RegistryFile;
};
export function createFakeFiles(): FakeFiles {
  const f: FakeFiles = {
    registries: [],
    token: null,
    removed: false,
    writeRegistry(r): void {
      f.registries.push(r);
    },
    flush: () => Promise.resolve(),
    writeCliToken(t): Promise<void> {
      f.token = t;
      return Promise.resolve();
    },
    removeRunFiles(): Promise<void> {
      f.removed = true;
      return Promise.resolve();
    },
    last(): RegistryFile {
      const r = f.registries.at(-1);
      if (r === undefined) {
        throw new Error('no registry written');
      }
      return r;
    },
  };
  return f;
}

export type CaptureSink = LogSink & { lines: { svc: LogSvc; stream: string; raw: string }[]; closed: boolean };
export function createCaptureSink(): CaptureSink {
  const s: CaptureSink = {
    lines: [],
    closed: false,
    line(svc, stream, raw): void {
      s.lines.push({ svc, stream, raw });
    },
    tail: (svc, n) =>
      s.lines
        .filter((l) => l.svc === svc)
        .map((l) => l.raw)
        .slice(-n),
    sweep: () => Promise.resolve(),
    close(): Promise<void> {
      s.closed = true;
      return Promise.resolve();
    },
  };
  return s;
}

export type LogRecord = Record<string, unknown>;
export type Harness = {
  readonly sup: Supervisor;
  readonly clock: FakeClock;
  readonly timers: FakeTimers;
  readonly spawn: ReturnType<typeof createFakeSpawn>;
  readonly files: FakeFiles;
  readonly sink: CaptureSink;
  readonly realSink: LogSink;
  readonly logs: LogRecord[];
  readonly deps: SupervisorDeps;
  readonly opts: SupervisorOptions;
  events(name: string): LogRecord[];
  start(): Promise<void>;
  /** 4개(+gateway) 자식을 listening → ready까지 진행시킨다. */
  up(): Promise<void>;
};

export type HarnessOptions = Partial<SupervisorOptions> & {
  env?: Record<string, string>;
  platform?: NodeJS.Platform;
  watch?: DevWatchFactory;
  probeTcp?: (port: number) => Promise<boolean>;
  sink?: LogSink;
};

export function createHarness(o: HarnessOptions = {}): Harness {
  const clock = createFakeClock();
  const timers = createFakeTimers(clock);
  const spawn = createFakeSpawn();
  const files = createFakeFiles();
  const capture = createCaptureSink();
  const sink = o.sink ?? capture;
  const logs: LogRecord[] = [];
  const log = createLogger('supervisor', {
    level: 'debug',
    bootId: BOOT_ID,
    clock,
    destination: { write: (chunk: string): void => void logs.push(JSON.parse(chunk) as LogRecord) },
  });
  let counter = 0;
  const randomBytes = (n: number): Uint8Array => {
    counter += 1;
    return Uint8Array.from({ length: n }, (_, i) => (counter * 31 + i * 7 + 3) & 0xff);
  };
  const opts: SupervisorOptions = {
    profile: 'test',
    home: '/home/fathom',
    bundle: { appRoot: '/app', runtime: 'src', appVersion: '1.2.3', contractsHash: HASH },
    bootId: BOOT_ID,
    safeMode: false,
    foreground: false,
    logLevel: 'info',
    entries: {},
    previousCrashed: false,
    ...o,
  };
  const envMap = o.env ?? { PATH: '/usr/bin', HOME: '/home/u', LANG: 'C' };
  const deps: SupervisorDeps = {
    clock,
    timers,
    spawnChild: spawn.spawn,
    randomBytes,
    files,
    sink,
    log,
    env: (n) => envMap[n],
    platform: o.platform ?? 'linux',
    ...(o.watch === undefined ? {} : { watch: o.watch }),
    ...(o.probeTcp === undefined ? {} : { probeTcp: o.probeTcp }),
  };
  const sup = createSupervisor(opts, deps);
  const h: Harness = {
    sup,
    clock,
    timers,
    spawn,
    files,
    sink: capture,
    realSink: sink,
    logs,
    deps,
    opts,
    events: (name) => logs.filter((r) => r.event === name),
    start: () => sup.start(),
    async up(): Promise<void> {
      await sup.start();
      for (const svc of ['ops-api', 'content', 'learning', 'ai-gateway'] as const) {
        if (spawn.of(svc).length > 0) {
          spawn.last(svc).listening(41000 + spawn.last(svc).pid);
          spawn.last(svc).ready();
        }
      }
      await flush();
      const gw = spawn.of('gateway');
      if (gw.length > 0) {
        spawn.last('gateway').listening(42000);
        spawn.last('gateway').ready();
      }
      await flush();
    },
  };
  return h;
}
