import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { Profile } from './args.js';
import type { CliDeps } from './deps.js';
import { CLI_CODES, EXIT } from './exit-codes.js';
import { nodeVersionOk, resolveCliHome } from './home.js';
import { inside } from './inside.js';
import type { Output } from './output.js';

// Brief §4.2.3 — 모든 명령의 사전 검사: Node 버전 → home → `run/`·`logs/`(0700).
export type Preflight = { readonly ok: true; readonly home: string } | { readonly ok: false; readonly exit: number };

export function usageError(out: Output, message: string): number {
  out.error({ code: 'CLI-VAL-001', title: `${CLI_CODES['CLI-VAL-001'].title}: ${message}` });
  return EXIT.USAGE;
}

export async function preflight(profile: Profile, deps: CliDeps, out: Output): Promise<Preflight> {
  if (!nodeVersionOk(deps.nodeVersion)) {
    return { ok: false, exit: usageError(out, 'Node 22.15 이상 필요') };
  }
  const home = resolveCliHome(profile, deps);
  if (!home.ok) {
    return { ok: false, exit: usageError(out, home.error.message) };
  }
  await deps.mkdirp(homePath(home.value, 'run'), 0o700);
  await deps.mkdirp(homePath(home.value, 'logs'), 0o700);
  return { ok: true, home: home.value };
}

/** `<appRoot>/package.json`의 `version`(없거나 SemVer가 아니면 `0.0.0`). */
export async function readAppVersion(deps: Pick<CliDeps, 'readText' | 'appRoot'>): Promise<string> {
  const file = inside(deps.appRoot, 'package.json');
  const text = file === null ? null : await deps.readText(file);
  if (text === null) {
    return '0.0.0';
  }
  try {
    const pkg = parseJsonStrict(text);
    const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg ? pkg.version : undefined;
    return typeof version === 'string' && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
