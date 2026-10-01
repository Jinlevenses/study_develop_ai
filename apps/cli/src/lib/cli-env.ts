// ported-from: spikes/sp4-node-sqlite/src/warnings.mjs (case 17·18; audit-fixed: spawn은 execArgv를 상속하지 않으므로 NODE_OPTIONS로 전달·기존 값 보존 — services/ops child-env.ts와 같은 규칙의 독립 사본)
import type { AllowedEnvName } from '@fathom/shared-kernel/config/config';

// ADR-012 §2 · STD-CFG-21 — CLI가 띄우는 자식(supervisor·브라우저 열기 도구)의 env는 허용 목록에서 값이 있는 것만 새 객체로 만든다.
const BASE_NAMES = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'] as const satisfies readonly AllowedEnvName[];
const WIN32_NAMES = [
  'SYSTEMROOT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
] as const satisfies readonly AllowedEnvName[];
export const WARNING_FLAG = '--disable-warning=ExperimentalWarning';

export function mergeNodeOptions(existing: string | undefined): string {
  const trimmed = (existing ?? '').trim();
  if (trimmed.split(/\s+/).includes(WARNING_FLAG)) {
    return trimmed;
  }
  return [trimmed, WARNING_FLAG].filter((s) => s !== '').join(' ');
}

export type EnvDeps = {
  readonly env: (name: AllowedEnvName) => string | undefined;
  readonly platform: NodeJS.Platform;
};

/** supervisor용: 허용 env + `FATHOM_HOME` + 병합한 `NODE_OPTIONS`. */
export function supervisorEnv(home: string, deps: EnvDeps): Record<string, string> {
  return { ...baseEnv(deps), FATHOM_HOME: home, NODE_OPTIONS: mergeNodeOptions(deps.env('NODE_OPTIONS')) };
}

/** 브라우저 열기 등 외부 도구용: 허용 env만(NODE_OPTIONS 제외). */
export function baseEnv(deps: EnvDeps): Record<string, string> {
  const names: readonly AllowedEnvName[] = deps.platform === 'win32' ? [...BASE_NAMES, ...WIN32_NAMES] : BASE_NAMES;
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = deps.env(name);
    if (value !== undefined && value !== '') {
      out[name] = value;
    }
  }
  return out;
}
