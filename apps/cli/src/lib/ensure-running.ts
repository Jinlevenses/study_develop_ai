import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Profile } from './args.js';
import type { CliDeps } from './deps.js';
import { EXIT } from './exit-codes.js';
import { homeWarnings } from './home.js';
import type { RegistryFile, SupervisorLockFile } from './lockfile.js';
import { isRunning, readLock, readRegistry } from './lockfile.js';
import type { Output } from './output.js';

// ADR-012 §6 · Brief §4.2.5 — `up`·`open` 공용: 이미 켜져 있으면 spawn 없이 대기, 아니면 supervisor를 띄우고 gateway ready까지 기다린다.
export const UP_READY_TIMEOUT_MS = 20_000;
const POLL_MS = 100;
const EXIT_BUSY = 75;

export type EnsureOptions = {
  readonly profile: Profile;
  readonly home: string;
  readonly safe: boolean;
  readonly foreground: boolean;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly entries: string | null;
};
export type Running = {
  readonly port: number;
  readonly already: boolean;
  readonly notices: readonly string[];
  readonly degraded: readonly string[];
  /** 이 호출이 띄운 supervisor가 끝나는 시점(이미 켜져 있었다면 null). */
  readonly exited: Promise<number | null> | null;
};
export type EnsureFailure = { readonly code: 'CLI-DEP-001'; readonly exit: number; readonly detail: string };

function reasons(registry: RegistryFile | null): string {
  const parts: string[] = [];
  for (const [svc, entry] of Object.entries(registry?.services ?? {})) {
    if (entry !== undefined && entry.state === 'degraded') {
      parts.push(`${svc}: ${entry.reason ?? 'unknown'}`);
    }
  }
  return parts.join(', ');
}

function failure(detail: string): Result<never, EnsureFailure> {
  return err({ code: 'CLI-DEP-001', exit: EXIT.NOT_RUNNING, detail });
}

type Wait = {
  readonly lock: SupervisorLockFile;
  readonly launched: { pid: number; exited: Promise<number | null> } | null;
};

function successFrom(registry: RegistryFile, launched: Wait['launched']): Result<Running, EnsureFailure> {
  const port = registry.services.gateway?.port ?? 0;
  const degraded = Object.entries(registry.services)
    .filter(([, e]) => e?.state === 'degraded')
    .map(([svc]) => svc);
  const notices = registry.notices.filter((n) => n.startsWith('port_fallback:'));
  return ok({ port, already: launched === null, notices, degraded, exited: launched?.exited ?? null });
}

/** 레지스트리가 이 boot의 것이고 gateway가 ready일 때까지(남은 시간 안에 `starting`이 없어질 때까지) 100ms 폴링한다. */
async function waitReady(
  deps: CliDeps,
  home: string,
  launched: Wait['launched'],
  initialLock: SupervisorLockFile | null,
): Promise<Result<Running, EnsureFailure> | 'busy'> {
  const deadline = deps.clock.now() + UP_READY_TIMEOUT_MS;
  let exitCode: number | null | undefined;
  launched?.exited.then(
    (code) => {
      exitCode = code;
    },
    () => {
      exitCode = null;
    },
  );
  let lastRegistry: RegistryFile | null = null;
  for (;;) {
    const lock = await readLock(home, deps);
    const ours = lock !== null && (launched === null || lock.pid === launched.pid);
    const registry = ours ? await readRegistry(home, deps) : null;
    lastRegistry = registry ?? lastRegistry;
    if (exitCode === EXIT_BUSY) {
      return 'busy';
    }
    if (registry !== null && lock !== null && registry.boot_id === lock.boot_id) {
      const gateway = registry.services.gateway;
      const starting = Object.values(registry.services).some(
        (e) => e?.state === 'starting' || e?.state === 'restarting',
      );
      if (gateway?.state === 'ready' && (!starting || deps.clock.now() >= deadline)) {
        return successFrom(registry, launched);
      }
      if (registry.state === 'degraded' && (gateway?.state === 'stopped' || gateway?.state === 'degraded')) {
        return failure(reasons(registry));
      }
    }
    const supervisorGone =
      exitCode !== undefined ||
      (launched === null && (lock === null || !isRunning(lock, deps)) && initialLock !== null);
    if (supervisorGone) {
      return failure(reasons(lastRegistry) || '앱이 시작 도중 종료되었습니다');
    }
    if (deps.clock.now() >= deadline) {
      return failure(reasons(lastRegistry) || '시간 안에 시작되지 않았습니다');
    }
    await deps.sleep(POLL_MS);
  }
}

export async function ensureRunning(
  deps: CliDeps,
  out: Output,
  o: EnsureOptions,
): Promise<Result<Running, EnsureFailure>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await readLock(o.home, deps, (file) => out.warn(`손상된 잠금 파일을 무시합니다: ${file}`));
    if (existing !== null && isRunning(existing, deps)) {
      const waited = await waitReady(deps, o.home, null, existing);
      if (waited !== 'busy') {
        return waited;
      }
      continue;
    }
    for (const warning of homeWarnings(o.home, deps.platform)) {
      out.warn(`경고: ${warning}`);
    }
    let launched: { pid: number; exited: Promise<number | null> };
    try {
      launched = deps.launchSupervisor({
        appRoot: deps.appRoot,
        runtime: deps.runtime,
        profile: o.profile,
        home: o.home,
        safe: o.safe,
        foreground: o.foreground,
        logLevel: o.logLevel,
        entries: o.entries,
      });
    } catch {
      return failure('supervisor를 시작하지 못했습니다');
    }
    const waited = await waitReady(deps, o.home, launched, existing);
    if (waited !== 'busy') {
      return waited;
    }
  }
  return failure('다른 supervisor와 시작이 겹쳤습니다');
}
