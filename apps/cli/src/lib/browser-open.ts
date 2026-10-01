import path from 'node:path';
import type { SafeSpawnOptions, SafeSpawnResult } from '@fathom/shared-kernel/proc/proc';
import type { EnvDeps } from './cli-env.js';
import { baseEnv } from './cli-env.js';
import { inside } from './inside.js';

// IF-EXT-15 · Brief §4.2.8 — 브라우저 열기. `cmd /c start`·셸 0, 절대 경로 + `safeSpawn(shell:false)`.
// 알려진 제약(CR 후보 ②): Linux 데스크톱의 `xdg-open`은 DISPLAY 등이 필요하지만 허용 env 표 밖이라 넘기지 않는다 — 실패하면 호출자가 안내한다.
export type SafeSpawnFn = (bin: string, args: readonly string[], opts: SafeSpawnOptions) => Promise<SafeSpawnResult>;
export type BrowserDeps = EnvDeps & {
  readonly safeSpawn: SafeSpawnFn;
  readonly isExecutable: (file: string) => Promise<boolean>;
  readonly home: string;
};
const OPEN_TIMEOUT_MS = 10_000;

async function findOnPath(name: string, deps: BrowserDeps): Promise<string | null> {
  const pathVar = deps.env('PATH') ?? '';
  for (const dir of pathVar.split(':')) {
    if (dir === '' || !path.posix.isAbsolute(dir)) {
      continue;
    }
    const candidate = inside(dir, name, 'linux');
    if (candidate !== null && (await deps.isExecutable(candidate))) {
      return candidate;
    }
  }
  return null;
}

async function resolveCommand(url: string, deps: BrowserDeps): Promise<{ bin: string; args: string[] } | null> {
  if (deps.platform === 'darwin') {
    return { bin: '/usr/bin/open', args: [url] };
  }
  if (deps.platform === 'win32') {
    const root = deps.env('SYSTEMROOT') ?? 'C:\\Windows';
    const bin = inside(root, 'System32/rundll32.exe', 'win32');
    return bin === null ? null : { bin, args: ['url.dll,FileProtocolHandler', url] };
  }
  const bin = await findOnPath('xdg-open', deps);
  return bin === null ? null : { bin, args: [url] };
}

/** 열기를 시도하고 성공 여부만 돌려준다(URL·토큰은 어디에도 출력하지 않는다). */
export async function openBrowser(url: string, deps: BrowserDeps): Promise<boolean> {
  const command = await resolveCommand(url, deps);
  if (command === null) {
    return false;
  }
  try {
    const result = await deps.safeSpawn(command.bin, command.args, {
      env: baseEnv(deps),
      cwd: deps.home,
      timeoutMs: OPEN_TIMEOUT_MS,
      platform: deps.platform,
    });
    return result.exitCode === 0 && result.spawnError === null && !result.timedOut;
  } catch {
    return false;
  }
}
