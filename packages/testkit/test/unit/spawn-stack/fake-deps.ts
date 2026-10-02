import type { ProcResult, StackDeps, StackService } from '../../../src/spawn-stack.js';
import { APP_ROOT } from '../../../src/spawn-stack.js';

// 주입형 fake deps — 프로세스·파일·시계 전부 메모리(UT-TK-050~061은 spawn 0).

export const HOME = '/tmp/fake-stack-home';
export const SERVICES: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];
export const SUP_PID = 4000;
export const BOOT_ID = '01J00000000000000000000001';

export type RegistrySpec = {
  state?: string;
  services?: Partial<Record<string, { pid: number | null; port: number | null; state: string }>>;
  extra?: Record<string, unknown>;
};

export function registryJson(spec: RegistrySpec = {}): string {
  const services: Record<string, unknown> = {};
  SERVICES.forEach((svc, i) => {
    const o = spec.services?.[svc] ?? { pid: 4001 + i, port: 5001 + i, state: 'ready' };
    services[svc] = {
      pid: o.pid,
      port: o.port,
      state: o.state,
      started_at: 1_790_000_000_000,
      restarts: 0,
      last_exit_code: null,
      reason: null,
    };
  });
  return JSON.stringify({
    v: 1,
    boot_id: BOOT_ID,
    profile: 'test',
    app_version: '0.0.0',
    supervisor_pid: SUP_PID,
    state: spec.state ?? 'ready',
    updated_at: 1_790_000_000_000,
    services,
    notices: [],
    ...spec.extra,
  });
}

export function lockJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pid: SUP_PID,
    boot_id: BOOT_ID,
    version: '0.0.0',
    started_at: 1_790_000_000_000,
    profile: 'test',
    ...extra,
  });
}

export const REGISTRY_PATH = `${HOME}/run/registry.json`;
export const LOCK_PATH = `${HOME}/run/supervisor.lock`;
export const TOKEN_PATH = `${HOME}/run/cli.token`;
export const TOKEN = 'A'.repeat(43);

export type SpawnCall = { bin: string; args: readonly string[]; env: Readonly<Record<string, string>>; cwd: string };
export type Fake = {
  deps: StackDeps;
  files: Map<string, string>;
  missing: Set<string>;
  alive: Set<number>;
  clock: { t: number };
  sleeps: number[];
  calls: SpawnCall[];
  signals: [number, string][];
  log: string[];
  onSpawn: (call: SpawnCall) => ProcResult | null;
  onSleep: (n: number) => void;
  onSignal: (pid: number, sig: string) => void;
  fetchCalls: { url: string; init: RequestInit }[];
  fetchResponse: () => Response;
};

export function proc(over: Partial<ProcResult> = {}): ProcResult {
  return { exitCode: 0, stdout: '', stderrTail: '', timedOut: false, spawnError: null, ...over };
}

export function createFake(): Fake {
  const files = new Map<string, string>();
  const f: Fake = {
    files,
    missing: new Set(),
    alive: new Set([SUP_PID, ...SERVICES.map((_, i) => 4001 + i)]),
    clock: { t: 0 },
    sleeps: [],
    calls: [],
    signals: [],
    log: [],
    onSpawn: () => null,
    onSleep: () => undefined,
    onSignal: () => undefined,
    fetchCalls: [],
    fetchResponse: () => new Response('{}', { status: 500 }),
    deps: undefined as unknown as StackDeps,
  };
  const children = (dir: string): string[] => {
    const prefix = `${dir}/`;
    const names = new Set<string>();
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split('/')[0] ?? '');
      }
    }
    return [...names];
  };
  f.deps = {
    spawn: (bin, args, o) => {
      const call = { bin, args, env: o.env, cwd: o.cwd };
      f.calls.push(call);
      if (args.includes('down')) {
        f.log.push('spawn:down');
      }
      const custom = f.onSpawn(call);
      f.clock.t += 0;
      return Promise.resolve(custom ?? proc());
    },
    readText: (p) => {
      if (p.includes('/tmp/egress') || p.includes('/logs/')) {
        f.log.push(`read:${p}`);
      }
      return Promise.resolve(files.get(p) ?? null);
    },
    listFiles: (dir) => Promise.resolve(children(dir)),
    removeDir: (dir) => {
      f.log.push(`remove:${dir}`);
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${dir}/`)) {
          files.delete(key);
        }
      }
      return Promise.resolve();
    },
    exists: (p) => {
      if (p.startsWith(APP_ROOT)) {
        return Promise.resolve(!f.missing.has(p));
      }
      return Promise.resolve(files.has(p) || children(p).length > 0);
    },
    isAlive: (pid) => f.alive.has(pid),
    signal: (pid, sig) => {
      f.signals.push([pid, sig]);
      f.onSignal(pid, sig);
    },
    now: () => f.clock.t,
    sleep: (ms) => {
      f.sleeps.push(ms);
      f.clock.t += ms;
      f.onSleep(f.sleeps.length);
      return Promise.resolve();
    },
    env: (name) => ({ PATH: '/usr/bin', HOME: '/home/x', LANG: 'C.UTF-8' })[name as string],
    fetch: (input, init) => {
      f.fetchCalls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(f.fetchResponse());
    },
  };
  files.set(REGISTRY_PATH, registryJson());
  files.set(LOCK_PATH, lockJson());
  files.set(TOKEN_PATH, `${TOKEN}\n`);
  return f;
}
