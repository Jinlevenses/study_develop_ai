import { readFileSync } from 'node:fs';
import { link, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { SupervisedService } from '@fathom/contracts/admin/ipc';
import { RuntimeProfile, ServiceState } from '@fathom/contracts/common/domain';
import { SemVer, Ulid } from '@fathom/contracts/common/ids';
import { EpochMs } from '@fathom/contracts/common/time';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import { homePath, resolveInsideLexical, writeFileAtomic } from '@fathom/shared-kernel/config/config';
import { z } from 'zod';

// Brief T-00-11 §4.1.2·§4.1.3 — 계약에 없는 런타임 파일 형식(CR 후보 ①). CLI(§4.2.4)가 같은 모양을 독립 파싱한다.
export const SupervisorLockFile = z
  .object({
    pid: z.number().int().min(1),
    boot_id: Ulid,
    version: SemVer,
    started_at: EpochMs,
    profile: RuntimeProfile,
  })
  .strict();
export type SupervisorLockFile = z.infer<typeof SupervisorLockFile>;

export const RegistryServiceEntry = z
  .object({
    pid: z.number().int().min(1).nullable(),
    port: z.number().int().min(0).max(65535).nullable(),
    state: ServiceState,
    started_at: EpochMs.nullable(),
    restarts: z.number().int().min(0),
    last_exit_code: z.number().int().nullable(),
    reason: z.string().max(120).nullable(),
  })
  .strict();
export type RegistryServiceEntry = z.infer<typeof RegistryServiceEntry>;

export const RegistryFile = z
  .object({
    v: z.literal(1),
    boot_id: Ulid,
    profile: RuntimeProfile,
    app_version: SemVer,
    supervisor_pid: z.number().int().min(1),
    state: z.enum(['starting', 'ready', 'degraded', 'stopping', 'stopped']),
    updated_at: EpochMs,
    services: z.partialRecord(SupervisedService, RegistryServiceEntry),
    notices: z.array(z.string().max(120)).max(20),
  })
  .strict();
export type RegistryFile = z.infer<typeof RegistryFile>;

export interface RuntimeFilesPort {
  /** 직렬화된 큐 1개 — 쓰는 중이면 최신 값 1개만 대기(합쳐 쓰기). */
  writeRegistry(registry: RegistryFile): void;
  /** 대기 중인 registry 쓰기가 모두 끝날 때까지. */
  flush(): Promise<void>;
  writeCliToken(token: string): Promise<void>;
  /** 정상 종료: `supervisor.lock`·`cli.token` 삭제(registry는 `stopped`로 남긴다). */
  removeRunFiles(): Promise<void>;
}

function errnoCode(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}

export async function ensureRunDirs(home: string): Promise<void> {
  await mkdir(homePath(home, 'run'), { recursive: true, mode: 0o700 });
  await mkdir(homePath(home, 'logs'), { recursive: true, mode: 0o700 });
}

/** `kill(pid, 0)` — 성공·`EPERM` = 생존, `ESRCH` = 죽음. 리눅스에서 좀비는 죽은 것으로 본다. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return errnoCode(e) === 'EPERM';
  }
  if (process.platform === 'linux') {
    const stat = resolveInsideLexical('/proc', `${pid}/stat`, 'linux');
    if (!stat.ok) {
      return false;
    }
    try {
      return !/^\d+ \(.*\) Z /s.test(readFileSync(stat.value, 'utf8'));
    } catch {
      return false;
    }
  }
  return true;
}

export type LockResult = { readonly acquired: true; readonly previousCrashed: boolean } | { readonly acquired: false };

/**
 * 잠금 경로는 **내용이 다 쓰인 뒤에만** 존재한다 — `run/`의 임시 파일에 한 줄을 쓰고 fsync한 다음 `link(tmp, lockPath)`로 원자적으로 건다.
 * `link`는 대상이 있으면 `EEXIST`로 실패하므로 `wx`와 같은 배타성을 가지면서, 빈 잠금 파일이 잠깐 보이는 창이 없다(ADR-012 단일 supervisor).
 */
async function createExclusive(
  lockPath: string,
  tmpPath: string,
  line: string,
  beforeLink?: () => Promise<void>,
): Promise<boolean> {
  try {
    const handle = await open(tmpPath, 'w', 0o600);
    try {
      await handle.writeFile(line);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await beforeLink?.();
    await link(tmpPath, lockPath);
    return true;
  } catch (e) {
    if (errnoCode(e) === 'EEXIST') {
      return false;
    }
    throw e;
  } finally {
    await rm(tmpPath, { force: true });
  }
}

async function readRawOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function parseHolder(raw: string): SupervisorLockFile | null {
  try {
    const parsed = SupervisorLockFile.safeParse(parseJsonStrict(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const TAKEOVER_ATTEMPTS = 3;

/**
 * 임시 파일에 필드 5개 1줄 기록 → fsync → `link`로 배타 생성(잠금 경로는 빈 채로 존재한 적이 없다). `EEXIST`면 읽어 판정:
 * 파싱 실패·죽은 pid = stale, 생존 + 다른 pid = 미획득(main이 exit 75).
 * stale 인수는 원자적이다 — 덮어쓰지 않고 stale 파일을 **rename으로 치운 뒤** 다시 `link`로 만든다. 두 supervisor가 같은 stale 잠금을 보아도
 * `link`를 이기는 쪽은 하나다. 치운 파일이 우리가 판정한 stale 내용과 다르면(그 사이 다른 쪽이 새 잠금을 만듦) 되돌리고 미획득으로 끝낸다.
 * 경합에서 상대가 stale을 먼저 치웠다면 이긴 쪽은 `previousCrashed:false`를 볼 수 있다(크래시 사실은 한쪽만 안다).
 */
export async function acquireLock(
  home: string,
  info: SupervisorLockFile,
  deps?: { isAlive?: (pid: number) => boolean; beforeLink?: () => Promise<void> },
): Promise<LockResult> {
  const isAlive = deps?.isAlive ?? isProcessAlive;
  const lockPath = homePath(home, 'run', 'supervisor.lock');
  const gravePath = homePath(home, 'run', `supervisor.lock.stale-${info.pid}`);
  const tmpPath = homePath(home, 'run', `supervisor.lock.tmp-${info.pid}-${info.boot_id}`);
  const line = `${JSON.stringify(SupervisorLockFile.parse(info))}\n`;
  let tookOver = false;
  for (let attempt = 0; attempt < TAKEOVER_ATTEMPTS; attempt++) {
    if (await createExclusive(lockPath, tmpPath, line, deps?.beforeLink)) {
      return { acquired: true, previousCrashed: tookOver };
    }
    const raw = await readRawOrNull(lockPath);
    if (raw === null) {
      continue; // 읽는 사이 사라졌다 — 다시 만든다.
    }
    const holder = parseHolder(raw);
    if (holder !== null && holder.pid !== info.pid && isAlive(holder.pid)) {
      return { acquired: false };
    }
    try {
      await rename(lockPath, gravePath);
    } catch (e) {
      if (errnoCode(e) === 'ENOENT') {
        continue; // 다른 supervisor가 먼저 치웠다.
      }
      throw e;
    }
    const moved = await readRawOrNull(gravePath);
    if (moved !== raw) {
      // 방금 만들어진 다른 쪽 새 잠금을 치웠다 — 제자리로 돌려놓고(이미 또 있으면 그대로) 포기한다.
      try {
        await link(gravePath, lockPath);
      } catch {
        // 이미 새 잠금이 있다 — 그쪽이 소유자다.
      }
      await rm(gravePath, { force: true });
      return { acquired: false };
    }
    await rm(gravePath, { force: true });
    tookOver = true;
  }
  return { acquired: false };
}

export type RuntimeFilesOptions = {
  readonly onError?: (what: string, e: unknown) => void;
  /** 테스트용 쓰기 주입(기본 `writeFileAtomic`). */
  readonly writeFile?: (target: string, data: string, opts: { mode: number }) => Promise<void>;
};

export function createRuntimeFiles(home: string, o?: RuntimeFilesOptions): RuntimeFilesPort {
  const registryPath = homePath(home, 'run', 'registry.json');
  const tokenPath = homePath(home, 'run', 'cli.token');
  const lockPath = homePath(home, 'run', 'supervisor.lock');
  const write = o?.writeFile ?? writeFileAtomic;
  let inflight: Promise<void> | null = null;
  let pending: string | null = null;

  async function drain(first: string): Promise<void> {
    let next: string | null = first;
    while (next !== null) {
      pending = null;
      try {
        await write(registryPath, next, { mode: 0o600 });
      } catch (e) {
        o?.onError?.('registry', e);
      }
      next = pending;
    }
    inflight = null;
  }

  return {
    writeRegistry(registry: RegistryFile): void {
      const text = `${JSON.stringify(RegistryFile.parse(registry))}\n`;
      if (inflight !== null) {
        pending = text;
        return;
      }
      inflight = drain(text);
    },
    async flush(): Promise<void> {
      while (inflight !== null) {
        await inflight;
      }
    },
    async writeCliToken(token: string): Promise<void> {
      await writeFileAtomic(tokenPath, token, { mode: 0o600 });
    },
    async removeRunFiles(): Promise<void> {
      await rm(lockPath, { force: true });
      await rm(tokenPath, { force: true });
    },
  };
}
