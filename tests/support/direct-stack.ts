import type { ChildProcess, Serializable } from 'node:child_process';
import { fork } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BootstrapEnvelope, IpcServiceToSupervisor, IpcSupervisorToService } from '@fathom/contracts/admin/ipc';
import { fixedUlid } from '@fathom/testkit/ids';
import type { StackRuntime, StackService } from '@fathom/testkit/spawn-stack';
import { APP_ROOT, serviceEntry } from '@fathom/testkit/spawn-stack';

// supervisor 없이 서비스 프로세스를 알려진 토큰으로 직접 띄우는 테스트 전용 런처(T-00-16 §4.4.3, [Brief 결정]).
// supervisor가 만든 호출자 토큰은 설계상 밖으로 나오지 않아(NFR-SEC-003) ACL·봉투·토큰 누출 검증은 이 경로로만 가능하다.

export type DirectOptions = {
  readonly home: string;
  readonly runtime: StackRuntime;
  readonly services: readonly StackService[];
  readonly tokens: Readonly<Record<StackService, string>>;
  readonly cliToken: string;
  readonly contractsHash: string;
  readonly readyTimeoutMs?: number;
};
export type DirectService = {
  readonly svc: StackService;
  readonly pid: number;
  readonly port: number;
  readonly messages: readonly unknown[];
  readonly lines: readonly string[];
  readonly baseUrl: string;
};
type Peers = Readonly<Record<StackService, { url: string }>>;
type Child = {
  readonly child: ChildProcess;
  readonly exit: Promise<number | null>;
  readonly messages: unknown[];
  readonly lines: string[];
  readonly pid: number;
};

const ORDER: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];
const PLACEHOLDER = 'http://127.0.0.1:0';

export function rootVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
  return typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string'
    ? parsed.version
    : '0.0.0';
}

export function placeholderPeers(): Peers {
  return {
    gateway: { url: PLACEHOLDER },
    content: { url: PLACEHOLDER },
    learning: { url: PLACEHOLDER },
    'ai-gateway': { url: PLACEHOLDER },
    'ops-api': { url: PLACEHOLDER },
  };
}

export function buildEnvelope(svc: StackService, o: DirectOptions, peers: Peers): BootstrapEnvelope {
  return BootstrapEnvelope.parse({
    type: 'bootstrap',
    v: 1,
    svc,
    boot_id: fixedUlid(ORDER.indexOf(svc) + 1),
    app_version: rootVersion(),
    contracts_hash: o.contractsHash,
    profile: 'test',
    home: o.home,
    web_root: null,
    listen: { host: '127.0.0.1', port: 0 },
    self_token: o.tokens[svc],
    callers: o.tokens,
    peers,
    flags: { safe_mode: false, batch_enabled: true, after_crash: false },
    log_level: 'info',
  });
}

function collectLines(stream: NodeJS.ReadableStream | null, lines: string[]): void {
  if (stream === null) {
    return;
  }
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const parts = `${rest}${chunk}`.split('\n');
    rest = parts.pop() ?? '';
    lines.push(...parts.filter((l) => l !== ''));
  });
  stream.on('end', () => {
    if (rest !== '') {
      lines.push(rest);
    }
  });
  stream.on('error', () => undefined);
}

function spawnChild(svc: StackService, o: DirectOptions): Child {
  const { entry, execArgv } = serviceEntry(APP_ROOT, svc, o.runtime);
  const child = fork(entry, ['--mode=serve'], {
    execArgv: [...execArgv],
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', FATHOM_HOME: o.home },
    cwd: APP_ROOT,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
  });
  const messages: unknown[] = [];
  const lines: string[] = [];
  collectLines(child.stdout, lines);
  collectLines(child.stderr, lines);
  child.on('message', (m: unknown) => messages.push(m));
  child.on('error', () => undefined);
  const exit = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', () => resolve(null));
  });
  if (child.pid === undefined) {
    throw new Error(`direct-stack: fork of ${svc} returned no pid`);
  }
  return { child, exit, messages, lines, pid: child.pid };
}

/** 음성 케이스용: 봉투 대신 임의의 첫 메시지를 보내고 종료 코드·메시지·출력 줄을 돌려준다. */
export function forkWithEnvelope(
  svc: StackService,
  o: DirectOptions,
  first: unknown,
): Promise<{ exit: Promise<number | null>; messages: unknown[]; lines: string[]; pid: number }> {
  const c = spawnChild(svc, o);
  const payload: Serializable = JSON.parse(JSON.stringify(first));
  c.child.send(payload);
  return Promise.resolve({ exit: c.exit, messages: c.messages, lines: c.lines, pid: c.pid });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor<T>(what: string, timeoutMs: number, probe: () => T | null): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== null) {
      return value;
    }
    if (performance.now() >= deadline) {
      throw new Error(`direct-stack: timeout waiting for ${what}`);
    }
    await delay(25);
  }
}

function findMessage(c: Child, type: 'listening' | 'ready' | 'fatal'): { port?: number } | null {
  for (const m of c.messages) {
    const parsed = IpcServiceToSupervisor.safeParse(m);
    if (!parsed.success) {
      throw new Error('direct-stack: service sent a message that is not IpcServiceToSupervisor');
    }
    if (parsed.data.type === 'fatal') {
      throw new Error(`direct-stack: service sent fatal ${parsed.data.code}`);
    }
    if (parsed.data.type === type) {
      return type === 'listening' && parsed.data.type === 'listening' ? { port: parsed.data.port } : {};
    }
  }
  return null;
}

async function pollReadyz(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(new URL('/readyz', baseUrl), { signal: AbortSignal.timeout(2_000) });
      await res.body?.cancel();
      if (res.status === 200) {
        return;
      }
    } catch {
      // 아직 준비 전 — 재시도
    }
    if (performance.now() >= deadline) {
      throw new Error(`direct-stack: ${baseUrl}/readyz did not become 200`);
    }
    await delay(50);
  }
}

async function stopChild(c: Child): Promise<void> {
  if (c.child.exitCode === null && c.child.signalCode === null) {
    if (c.child.connected) {
      c.child.send(IpcSupervisorToService.parse({ type: 'shutdown', v: 1, grace_ms: 2000 }));
    }
    const exited = await Promise.race([c.exit.then(() => true), delay(5_000).then(() => false)]);
    if (!exited) {
      c.child.kill('SIGKILL');
      await c.exit;
    }
  }
}

export async function launchDirect(o: DirectOptions): Promise<{
  readonly services: Readonly<Partial<Record<StackService, DirectService>>>;
  stop(): Promise<void>;
}> {
  const timeoutMs = o.readyTimeoutMs ?? 60_000;
  mkdirSync(path.join(o.home, 'run'), { recursive: true, mode: 0o700 });
  if (o.services.includes('gateway')) {
    writeFileSync(path.join(o.home, 'run', 'cli.token'), `${o.cliToken}\n`, { mode: 0o600 });
  }
  const children = new Map<StackService, Child>();
  const stop = async (): Promise<void> => {
    await Promise.all([...children.values()].map((c) => stopChild(c)));
  };
  try {
    for (const svc of o.services) {
      const c = spawnChild(svc, o);
      children.set(svc, c);
      c.child.send(buildEnvelope(svc, o, placeholderPeers()));
    }
    const ports = new Map<StackService, number>();
    for (const [svc, c] of children) {
      const listening = await waitFor(`${svc} listening`, timeoutMs, () => findMessage(c, 'listening'));
      ports.set(svc, listening.port ?? 0);
      await waitFor(`${svc} ready`, timeoutMs, () => findMessage(c, 'ready'));
    }
    const peers: Record<StackService, { url: string }> = { ...placeholderPeers() };
    for (const [svc, port] of ports) {
      peers[svc] = { url: `http://127.0.0.1:${String(port)}` };
    }
    for (const c of children.values()) {
      c.child.send(IpcSupervisorToService.parse({ type: 'registry.updated', v: 1, peers }));
    }
    for (const [svc] of children) {
      await pollReadyz(peers[svc].url, timeoutMs);
    }
    const services: Partial<Record<StackService, DirectService>> = {};
    for (const [svc, c] of children) {
      services[svc] = {
        svc,
        pid: c.pid,
        port: ports.get(svc) ?? 0,
        messages: c.messages,
        lines: c.lines,
        baseUrl: peers[svc].url,
      };
    }
    return { services, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}

/** `process.kill(pid, 0)`: 성공·EPERM = 살아 있음, ESRCH = 없음. 잔존 pid 0 단언용. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return typeof e === 'object' && e !== null && 'code' in e && e.code === 'EPERM';
  }
}
