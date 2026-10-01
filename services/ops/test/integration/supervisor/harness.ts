import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServiceName } from '@fathom/contracts/common/ids';

// 통합 테스트 하네스 — 진짜 supervisor 프로세스(`--profile=test --runtime=src --entries=<tmp json>`) + fixture 서비스.
// 대기는 이벤트·파일 폴링(≤ 50ms 간격, 상한 있음)만 쓴다(STD-TST-03).
export const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const SUPERVISOR_MAIN = path.join(ROOT, 'services/ops/src/supervisor/main.ts');
export const FIXTURE = fileURLToPath(new URL('./fixtures/fake-service.ts', import.meta.url));
export const EXEC_ARGV = ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source'];
export const SERVICES: readonly ServiceName[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];

export type FxArgs = Partial<Record<ServiceName, string[]>>;
export type RegistrySnapshot = {
  boot_id: string;
  state: string;
  notices: string[];
  services: Record<
    string,
    { pid: number | null; port: number | null; state: string; restarts: number; reason: string | null }
  >;
};
export type Running = {
  readonly home: string;
  readonly proc: ChildProcess;
  readonly exit: Promise<number | null>;
  readonly stderr: () => string;
  readonly entriesFile: string;
};

const live: { running: Running; extraPids: Set<number> }[] = [];

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z /s.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return process.platform !== 'linux';
  }
}

export async function waitFor<T>(
  what: string,
  probe: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v !== null && v !== undefined && v !== false) {
      return v;
    }
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${what}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

export async function writeEntries(dir: string, fx: FxArgs = {}): Promise<string> {
  const entries: Record<string, { entry: string; execArgv: string[]; args: string[] }> = {};
  for (const svc of SERVICES) {
    entries[svc] = { entry: FIXTURE, execArgv: EXEC_ARGV, args: fx[svc] ?? [] };
  }
  const file = path.join(dir, 'entries.json');
  await writeFile(file, JSON.stringify(entries));
  return file;
}

export function supervisorEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extra };
}

export function spawnSupervisor(
  home: string,
  entriesFile: string,
  extra: string[] = [],
  env = supervisorEnv(),
): Running {
  const proc = spawn(
    process.execPath,
    [
      ...EXEC_ARGV,
      SUPERVISOR_MAIN,
      '--profile=test',
      `--home=${home}`,
      '--runtime=src',
      `--entries=${entriesFile}`,
      ...extra,
    ],
    { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );
  let err = '';
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (c: string) => {
    err += c;
  });
  const exit = new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
  });
  return { home, proc, exit, stderr: () => err, entriesFile };
}

export async function startSupervisor(
  o: { fx?: FxArgs; extra?: string[]; home?: string; env?: Record<string, string> } = {},
): Promise<Running> {
  const base = await mkdtemp(path.join(tmpdir(), 'fathom-sup-'));
  const home = o.home ?? path.join(base, 'home');
  await mkdir(home, { recursive: true });
  const entries = await writeEntries(base, o.fx);
  const running = spawnSupervisor(home, entries, o.extra ?? [], o.env ?? supervisorEnv());
  live.push({ running, extraPids: new Set() });
  return running;
}

export function trackPid(running: Running, pid: number): void {
  live.find((l) => l.running === running)?.extraPids.add(pid);
}

/** 테스트가 직접 띄운 supervisor를 afterEach 정리 대상에 넣는다. */
export function adopt(running: Running): Running {
  live.push({ running, extraPids: new Set() });
  return running;
}

export function readRegistry(home: string): RegistrySnapshot | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(home, 'run', 'registry.json'), 'utf8'));
    return parsed as RegistrySnapshot;
  } catch {
    return null;
  }
}

export function waitReady(running: Running, timeoutMs = 15_000): Promise<RegistrySnapshot> {
  return waitFor(
    'registry state ready',
    () => {
      const r = readRegistry(running.home);
      return r !== null && r.state === 'ready' ? r : null;
    },
    timeoutMs,
  );
}

export async function logLines(home: string, svc: string): Promise<string[]> {
  const dir = path.join(home, 'logs', svc);
  let names: string[];
  try {
    names = (await readdir(dir)).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    out.push(...(await readFile(path.join(dir, n), 'utf8')).split('\n').filter((l) => l !== ''));
  }
  return out;
}

export async function logRecords(home: string, svc: string): Promise<Record<string, unknown>[]> {
  return (await logLines(home, svc)).map((l) => JSON.parse(l) as Record<string, unknown>);
}

function killGroup(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // 이미 종료
    }
  }
}

/** afterEach: 남은 프로세스를 전부 정리하고 잔존 pid 0을 단언한다. */
export async function cleanupAll(): Promise<void> {
  const pids = new Set<number>();
  for (const { running, extraPids } of live) {
    const reg = readRegistry(running.home);
    for (const svc of Object.values(reg?.services ?? {})) {
      if (svc.pid !== null) {
        pids.add(svc.pid);
      }
    }
    for (const p of extraPids) {
      pids.add(p);
    }
    if (running.proc.pid !== undefined) {
      pids.add(running.proc.pid);
    }
  }
  for (const pid of pids) {
    killGroup(pid);
  }
  const survivors: number[] = [];
  for (const pid of pids) {
    try {
      await waitFor(`pid ${pid} gone`, () => !isAlive(pid), 5000);
    } catch {
      survivors.push(pid);
    }
  }
  for (const { running } of live) {
    await rm(path.dirname(running.entriesFile), { recursive: true, force: true });
  }
  live.length = 0;
  if (survivors.length > 0) {
    throw new Error(`surviving pids: ${survivors.join(',')}`);
  }
}
