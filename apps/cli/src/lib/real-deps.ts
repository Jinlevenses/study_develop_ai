import { constants, readFileSync } from 'node:fs';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readAllowedEnv } from '@fathom/shared-kernel/config/config';
import { safeSpawn } from '@fathom/shared-kernel/proc/proc';
import { systemClock } from '@fathom/shared-kernel/time/time';
import { openBrowser } from './browser-open.js';
import type { CliDeps } from './deps.js';
import { createGatewayClient } from './gateway-client.js';
import { inside } from './inside.js';
import { terminatePid } from './kill-pid.js';
import { launchSupervisor } from './supervisor-launch.js';

// 진짜 의존성 묶음 — main.ts에서만 만든다(테스트는 전부 주입).
function errnoCode(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}

/** `kill(pid, 0)` — 성공·`EPERM` = 생존, `ESRCH` = 죽음. 리눅스에서 좀비(수확되지 않은 종료 프로세스)는 죽은 것으로 본다. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return errnoCode(e) === 'EPERM';
  }
  if (process.platform === 'linux') {
    const stat = inside('/proc', `${pid}/stat`, 'linux');
    if (stat === null) {
      return false;
    }
    try {
      return !/^\d+ \(.*\) Z /s.test(readFileSync(stat, 'utf8'));
    } catch {
      return false;
    }
  }
  return true;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** `metaUrl` = main.ts의 `import.meta.url`(appRoot·runtime 판정 기준, Brief §4.2.1). */
export function realCliDeps(metaUrl: string): CliDeps {
  const appRoot = fileURLToPath(new URL('../../../', metaUrl));
  const platform = process.platform;
  const env = readAllowedEnv;
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    env,
    platform,
    clock: systemClock,
    appRoot,
    runtime: metaUrl.endsWith('.ts') ? 'src' : 'dist',
    nodeVersion: process.version,
    launchSupervisor: (o) => launchSupervisor(o, { env, platform }),
    isAlive: isProcessAlive,
    async readText(file): Promise<string | null> {
      try {
        return await readFile(file, 'utf8');
      } catch {
        return null;
      }
    },
    async mkdirp(dir, mode): Promise<void> {
      await mkdir(dir, { recursive: true, mode });
    },
    gateway: (port, token, appVersion) => createGatewayClient({ port, token, appVersion }),
    openBrowser: (url, home) => openBrowser(url, { env, platform, safeSpawn, isExecutable, home }),
    killPid: (pid) =>
      terminatePid(pid, { env, platform, signal: (p, sig) => process.kill(p, sig), safeSpawn, cwd: appRoot }),
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}
