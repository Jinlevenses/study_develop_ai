import type { FakeClock } from '@fathom/testkit/clock';
import { createFakeClock } from '@fathom/testkit/clock';
import type { CliDeps, LaunchOptions } from '../../src/lib/deps.js';
import type { GatewayClient, GatewayResult } from '../../src/lib/gateway-client.js';

export const HOME = '/data/fathom';
export const BOOT = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
export const TOKEN = 'T'.repeat(43);
export const SENTINEL = 'S'.repeat(43);
export const OPEN_URL = `http://127.0.0.1:4747/#bt=${SENTINEL}`;

export const LOCK_PATH = `${HOME}/run/supervisor.lock`;
export const REGISTRY_PATH = `${HOME}/run/registry.json`;
export const TOKEN_PATH = `${HOME}/run/cli.token`;

export type ServiceSpec = { state: string; port?: number | null; reason?: string | null; restarts?: number };
export function lockText(pid = 4242, bootId = BOOT): string {
  return JSON.stringify({ pid, boot_id: bootId, version: '1.2.3', started_at: 1, profile: 'test' });
}
export function registryText(
  services: Record<string, ServiceSpec>,
  o: { state?: string; bootId?: string; notices?: string[] } = {},
): string {
  const entries: Record<string, unknown> = {};
  for (const [svc, s] of Object.entries(services)) {
    entries[svc] = {
      pid: s.state === 'stopped' ? null : 100,
      port: s.port ?? null,
      state: s.state,
      started_at: 1,
      restarts: s.restarts ?? 0,
      last_exit_code: null,
      reason: s.reason ?? null,
    };
  }
  return JSON.stringify({
    v: 1,
    boot_id: o.bootId ?? BOOT,
    profile: 'test',
    app_version: '1.2.3',
    supervisor_pid: 4242,
    state: o.state ?? 'ready',
    updated_at: 1,
    services: entries,
    notices: o.notices ?? [],
  });
}
export const ALL_READY: Record<string, ServiceSpec> = {
  gateway: { state: 'ready', port: 4747 },
  content: { state: 'ready', port: 4762 },
  learning: { state: 'ready', port: 4763 },
  'ai-gateway': { state: 'ready', port: 4764 },
  'ops-api': { state: 'ready', port: 4761 },
};

export const okJson = (status: number, body: unknown): GatewayResult => ({
  ok: true,
  value: { status, body, problem: null },
});

export type GatewayCall = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  key?: string;
  port: number;
  token: string;
  appVersion: string;
};
export type FakeEnv = {
  readonly deps: CliDeps;
  readonly clock: FakeClock;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly files: Map<string, string>;
  readonly alive: Set<number>;
  readonly launches: LaunchOptions[];
  readonly browser: string[];
  readonly killed: number[];
  readonly gatewayCalls: GatewayCall[];
  readonly routes: Map<string, GatewayResult>;
  readonly sleeps: number[];
  hooks: { onSleep: (ms: number) => void; onLaunch: (o: LaunchOptions) => void };
  launchExit: { resolve: (code: number | null) => void } | null;
  browserOk: boolean;
  killOk: boolean;
  launchThrows: boolean;
};

export function createFakeEnv(
  over: Partial<CliDeps> = {},
  envMap: Record<string, string> = { FATHOM_HOME: HOME, PATH: '/usr/bin' },
): FakeEnv {
  const clock = createFakeClock();
  const files = new Map<string, string>([['/app/package.json', JSON.stringify({ version: '1.2.3' })]]);
  const f: FakeEnv = {
    clock,
    stdout: [],
    stderr: [],
    files,
    alive: new Set<number>(),
    launches: [],
    browser: [],
    killed: [],
    gatewayCalls: [],
    routes: new Map<string, GatewayResult>(),
    sleeps: [],
    hooks: { onSleep: () => undefined, onLaunch: () => undefined },
    launchExit: null,
    browserOk: true,
    killOk: true,
    launchThrows: false,
    deps: undefined as unknown as CliDeps,
  };
  const client = (port: number, token: string, appVersion: string): GatewayClient => ({
    get(path) {
      f.gatewayCalls.push({ method: 'GET', path, port, token, appVersion });
      return Promise.resolve(f.routes.get(`GET ${path}`) ?? okJson(404, null));
    },
    post(path, body, key) {
      f.gatewayCalls.push({ method: 'POST', path, body, key, port, token, appVersion });
      return Promise.resolve(f.routes.get(`POST ${path}`) ?? okJson(404, null));
    },
  });
  const deps: CliDeps = {
    stdout: { write: (s) => void f.stdout.push(s) },
    stderr: { write: (s) => void f.stderr.push(s) },
    env: (n) => envMap[n],
    platform: 'linux',
    clock,
    appRoot: '/app',
    runtime: 'src',
    nodeVersion: 'v22.22.2',
    launchSupervisor(o) {
      if (f.launchThrows) {
        throw new Error('spawn failed');
      }
      f.launches.push(o);
      f.hooks.onLaunch(o);
      const exited = new Promise<number | null>((resolve) => {
        f.launchExit = { resolve };
      });
      f.alive.add(5000);
      return { pid: 5000, exited };
    },
    isAlive: (pid) => f.alive.has(pid),
    readText: (p) => Promise.resolve(files.get(p) ?? null),
    mkdirp: () => Promise.resolve(),
    gateway: client,
    openBrowser(url) {
      f.browser.push(url);
      return Promise.resolve(f.browserOk);
    },
    killPid(pid) {
      f.killed.push(pid);
      return Promise.resolve(f.killOk);
    },
    sleep(ms) {
      f.sleeps.push(ms);
      clock.advance(ms);
      f.hooks.onSleep(ms);
      return Promise.resolve();
    },
    ...over,
  };
  return Object.assign(f, { deps });
}

export function stdoutText(f: FakeEnv): string {
  return f.stdout.join('');
}
export function stderrText(f: FakeEnv): string {
  return f.stderr.join('');
}
