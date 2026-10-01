// ported-from: spikes/sp4-node-sqlite/src/warnings.mjs (case 10·16~18; audit-fixed: ExperimentalWarning만 필터·process.on('warning') 미사용·기존 NODE_OPTIONS 보존)
import type { AllowedEnvName } from '@fathom/shared-kernel/config/config';

// ADR-012 §2 · STD-CFG-21 — 자식 env는 부모 env를 상속하지 않고 허용 목록에서 값이 있는 것만 새 객체로 만든다.
export const WARNING_FLAG = '--disable-warning=ExperimentalWarning';

const BASE_NAMES = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TZ'] as const satisfies readonly AllowedEnvName[];
const WIN32_NAMES = [
  'SYSTEMROOT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
] as const satisfies readonly AllowedEnvName[];

/**
 * 서비스가 다시 spawn하는 Node 자식은 `execArgv`를 상속받지 못하므로 `NODE_OPTIONS`로 경고 억제를 전한다(SP-4 #17·#18).
 * 이미 플래그가 있으면 원문(트림) 그대로, 없으면 기존 값을 보존하고 뒤에 붙인다.
 */
export function mergeNodeOptions(existing: string | undefined): string {
  const trimmed = (existing ?? '').trim();
  if (trimmed.split(/\s+/).includes(WARNING_FLAG)) {
    return trimmed;
  }
  return [trimmed, WARNING_FLAG].filter((s) => s !== '').join(' ');
}

export type ChildEnvDeps = {
  readonly env: (name: AllowedEnvName) => string | undefined;
  readonly platform: NodeJS.Platform;
};

export function childEnv(home: string, deps: ChildEnvDeps): Record<string, string> {
  const out: Record<string, string> = {};
  const names: readonly AllowedEnvName[] = deps.platform === 'win32' ? [...BASE_NAMES, ...WIN32_NAMES] : BASE_NAMES;
  for (const name of names) {
    const value = deps.env(name);
    if (value !== undefined && value !== '') {
      out[name] = value;
    }
  }
  out.FATHOM_HOME = home;
  out.NODE_OPTIONS = mergeNodeOptions(deps.env('NODE_OPTIONS'));
  return out;
}
