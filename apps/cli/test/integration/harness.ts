import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// CLI 통합 하네스 — 진짜 CLI 프로세스(`node --import tsx … apps/cli/src/main.ts`)와 supervisor·fixture. env는 최소(PATH·HOME·FATHOM_HOME).
export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI_MAIN = path.join(ROOT, 'apps/cli/src/main.ts');
export const FIXTURE = fileURLToPath(new URL('./fixtures/fake-service.ts', import.meta.url));
export const EXEC_ARGV = ['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source'];
const SERVICES = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const;

export type Sandbox = { readonly base: string; readonly home: string; readonly entries: string };
export type CliRun = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const sandboxes: Sandbox[] = [];

export async function makeSandbox(fx: Partial<Record<(typeof SERVICES)[number], string[]>> = {}): Promise<Sandbox> {
  const base = await mkdtemp(path.join(tmpdir(), 'fathom-cli-'));
  const home = path.join(base, 'home');
  const entries: Record<string, { entry: string; execArgv: string[]; args: string[] }> = {};
  for (const svc of SERVICES) {
    entries[svc] = { entry: FIXTURE, execArgv: EXEC_ARGV, args: fx[svc] ?? [] };
  }
  const file = path.join(base, 'entries.json');
  await writeFile(file, JSON.stringify(entries));
  const box = { base, home, entries: file };
  sandboxes.push(box);
  return box;
}

export function cliEnv(box: Sandbox, extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', FATHOM_HOME: box.home, ...extra };
}

export function spawnCli(args: readonly string[], env: Record<string, string>): ReturnType<typeof spawn> {
  return spawn(process.execPath, [...EXEC_ARGV, CLI_MAIN, ...args], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function runCli(args: readonly string[], env: Record<string, string>, timeoutMs = 60_000): Promise<CliRun> {
  return new Promise<CliRun>((resolve, reject) => {
    const child = spawnCli(args, env);
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      stdout += c;
    });
    child.stderr?.on('data', (c: string) => {
      stderr += c;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`cli timeout: ${args.join(' ')}\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export function entriesArg(box: Sandbox): string {
  return `--entries=${box.entries}`;
}

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
  probe: () => T | null | undefined | false,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v !== null && v !== undefined && v !== false) {
      return v;
    }
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${what}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

export function lockPid(box: Sandbox): number | null {
  try {
    const lock = JSON.parse(readFileSync(path.join(box.home, 'run', 'supervisor.lock'), 'utf8')) as { pid: number };
    return lock.pid;
  } catch {
    return null;
  }
}

function registryPids(box: Sandbox): number[] {
  try {
    const reg = JSON.parse(readFileSync(path.join(box.home, 'run', 'registry.json'), 'utf8')) as {
      services: Record<string, { pid: number | null }>;
    };
    return Object.values(reg.services).flatMap((s) => (s.pid === null ? [] : [s.pid]));
  } catch {
    return [];
  }
}

/** afterEach: 남은 supervisor·서비스를 정리하고 잔존 pid 0을 단언한다. */
export async function cleanupSandboxes(): Promise<void> {
  const pids = new Set<number>();
  for (const box of sandboxes) {
    const sup = lockPid(box);
    if (sup !== null) {
      pids.add(sup);
    }
    for (const p of registryPids(box)) {
      pids.add(p);
    }
  }
  for (const pid of pids) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGKILL');
      } catch {
        // 이미 종료
      }
    }
  }
  const survivors: number[] = [];
  for (const pid of pids) {
    try {
      await waitFor(`pid ${pid} gone`, () => !isAlive(pid), 5000);
    } catch {
      survivors.push(pid);
    }
  }
  for (const box of sandboxes.splice(0)) {
    await rm(box.base, { recursive: true, force: true });
  }
  if (survivors.length > 0) {
    throw new Error(`surviving pids: ${survivors.join(',')}`);
  }
}
