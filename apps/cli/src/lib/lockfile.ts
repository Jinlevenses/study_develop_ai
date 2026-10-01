import { SupervisedService } from '@fathom/contracts/admin/ipc';
import { RuntimeProfile, ServiceState } from '@fathom/contracts/common/domain';
import { SemVer, Ulid } from '@fathom/contracts/common/ids';
import { EpochMs } from '@fathom/contracts/common/time';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import { homePath } from '@fathom/shared-kernel/config/config';
import { z } from 'zod';
import type { CliDeps } from './deps.js';

// Brief §4.2.4 — supervisor의 런타임 파일(`run/supervisor.lock`·`run/registry.json`)과 같은 모양의 독립 파서(단위 간 import 금지, CR 후보 ①).
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

type ReadDeps = Pick<CliDeps, 'readText'>;

async function readParsed<T>(
  schema: z.ZodType<T>,
  file: string,
  deps: ReadDeps,
  onInvalid?: (what: string) => void,
): Promise<T | null> {
  const text = await deps.readText(file);
  if (text === null) {
    return null;
  }
  try {
    const parsed = schema.safeParse(parseJsonStrict(text));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // 깨진 JSON — 아래에서 null.
  }
  onInvalid?.(file);
  return null;
}

/** 없음·파싱 실패 → null(파싱 실패는 `onInvalid` 1회). */
export function readLock(
  home: string,
  deps: ReadDeps,
  onInvalid?: (what: string) => void,
): Promise<SupervisorLockFile | null> {
  return readParsed(SupervisorLockFile, homePath(home, 'run', 'supervisor.lock'), deps, onInvalid);
}

/** 원자 쓰기라 부분 파일은 없다고 가정한다. 파싱 실패 = null(다음 폴링에서 재시도). */
export function readRegistry(home: string, deps: ReadDeps): Promise<RegistryFile | null> {
  return readParsed(RegistryFile, homePath(home, 'run', 'registry.json'), deps);
}

export function isRunning(lock: SupervisorLockFile, deps: Pick<CliDeps, 'isAlive'>): boolean {
  return deps.isAlive(lock.pid);
}
