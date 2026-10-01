import type { SafeSpawnFn } from './browser-open.js';
import type { EnvDeps } from './cli-env.js';
import { baseEnv } from './cli-env.js';
import { inside } from './inside.js';

// ADR-012 §8 · Brief §4.2.7 — gateway가 응답하지 않을 때의 종료 폴백. 자식은 IPC 끊김으로 정상 종료하므로 `/T /F` 없이 supervisor에게만 보낸다.
export type KillDeps = EnvDeps & {
  readonly signal: (pid: number, sig: 'SIGTERM') => void;
  readonly safeSpawn: SafeSpawnFn;
  readonly cwd: string;
};
const TASKKILL_TIMEOUT_MS = 10_000;

export async function terminatePid(pid: number, deps: KillDeps): Promise<boolean> {
  if (deps.platform !== 'win32') {
    try {
      deps.signal(pid, 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
  const root = deps.env('SYSTEMROOT') ?? 'C:\\Windows';
  const bin = inside(root, 'System32/taskkill.exe', 'win32');
  if (bin === null) {
    return false;
  }
  try {
    const r = await deps.safeSpawn(bin, ['/PID', String(pid)], {
      env: baseEnv(deps),
      cwd: deps.cwd,
      timeoutMs: TASKKILL_TIMEOUT_MS,
      platform: 'win32',
    });
    return r.exitCode === 0 && r.spawnError === null;
  } catch {
    return false;
  }
}
