import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SupervisedService } from '@fathom/contracts/admin/ipc';
import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import { SemVer } from '@fathom/contracts/common/ids';
import { canonicalJson, parseJsonStrict, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { resolveInsideLexical } from '@fathom/shared-kernel/config/config';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { z } from 'zod';
import { WARNING_FLAG } from './child-env.js';

export type Runtime = 'src' | 'dist';
export type BundleInfo = {
  readonly appRoot: string;
  readonly runtime: Runtime;
  readonly appVersion: string;
  readonly contractsHash: string;
};
export type ChildEntry = {
  readonly entry: string;
  readonly execArgv: readonly string[];
  readonly args: readonly string[];
};
export type ResolvedEntry = ChildEntry & { readonly cwd: string };
export type EntryOverrides = Readonly<Partial<Record<SupervisedService, ChildEntry>>>;

/** 서비스 → `services/<dir>` 디렉터리(ops-api = ops). */
export const SERVICE_DIRS = {
  gateway: 'gateway',
  content: 'content',
  learning: 'learning',
  'ai-gateway': 'ai-gateway',
  'ops-api': 'ops',
} as const;
export type ServiceKey = keyof typeof SERVICE_DIRS;

const SRC_EXEC_ARGV = [WARNING_FLAG, '--import', 'tsx', '--conditions=source'] as const;
const DIST_EXEC_ARGV = [WARNING_FLAG] as const;
export const DEFAULT_EXEC_ARGV_DIST: readonly string[] = DIST_EXEC_ARGV;
const VITE_ENTRY = 'apps/web/node_modules/vite/bin/vite.js';
const VITE_ARGS = ['--host', '127.0.0.1', '--port', '5173', '--strictPort'] as const;

function rootUrl(appRoot: string): URL {
  return pathToFileURL(appRoot.endsWith(path.sep) ? appRoot : `${appRoot}${path.sep}`);
}
function inRoot(appRoot: string, relative: string): string {
  return fileURLToPath(new URL(relative, rootUrl(appRoot)));
}
export function appPath(appRoot: string, relative: string): string {
  return inRoot(appRoot, relative);
}
/** STD-TS-42 — `base` 밖으로 나가지 않는 경로 결합. 거부(절대·`..`·장치 이름 등)면 `null`. */
export function joinInside(base: string, relative: string): string | null {
  const r = resolveInsideLexical(base, relative);
  return r.ok ? r.value : null;
}

/** 진입 파일 해석(ADR-012 §2·ARC §14.2). vite는 profile `dev`에서만. */
export function resolveEntries(
  appRoot: string,
  runtime: Runtime,
  profile: RuntimeProfile,
): Partial<Record<SupervisedService, ResolvedEntry>> {
  const out: Partial<Record<SupervisedService, ResolvedEntry>> = {};
  for (const svc of Object.keys(SERVICE_DIRS) as ServiceKey[]) {
    const dir = SERVICE_DIRS[svc];
    out[svc] = {
      entry: inRoot(appRoot, runtime === 'src' ? `services/${dir}/src/main.ts` : `services/${dir}/dist/main.js`),
      execArgv: runtime === 'src' ? [...SRC_EXEC_ARGV] : [...DIST_EXEC_ARGV],
      args: [],
      cwd: appRoot,
    };
  }
  if (profile === 'dev') {
    out.vite = {
      entry: inRoot(appRoot, VITE_ENTRY),
      execArgv: [...DIST_EXEC_ARGV],
      args: [...VITE_ARGS],
      cwd: inRoot(appRoot, 'apps/web'),
    };
  }
  return out;
}

const AbsPath = z
  .string()
  .refine((p) => path.posix.isAbsolute(p) || path.win32.isAbsolute(p), 'absolute path required');
const EntryOverride = z
  .object({ entry: AbsPath, execArgv: z.array(z.string()).default([]), args: z.array(z.string()).default([]) })
  .strict();
const EntriesFile = z.partialRecord(SupervisedService, EntryOverride);

/** `--entries` JSON(profile test 전용). 경로는 절대, strict. */
export function parseEntriesFile(text: string): Result<EntryOverrides, { reason: string }> {
  let raw: unknown;
  try {
    raw = parseJsonStrict(text);
  } catch {
    return err({ reason: 'entries_not_json' });
  }
  const parsed = EntriesFile.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err({ reason: 'entries_invalid' });
}

async function readVersion(appRoot: string): Promise<string> {
  try {
    const pkg = parseJsonStrict(await readFile(inRoot(appRoot, 'package.json'), 'utf8'));
    const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg ? pkg.version : undefined;
    const parsed = SemVer.safeParse(version);
    return parsed.success ? parsed.data : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function snapshotFiles(appRoot: string): Promise<{ name: string; sha256: string }[]> {
  const dir = inRoot(appRoot, 'packages/contracts/.snapshots/');
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const files: { name: string; sha256: string }[] = [];
  for (const name of names) {
    const full = joinInside(dir, name);
    if (full !== null) {
      files.push({ name, sha256: sha256Hex(await readFile(full)) });
    }
  }
  return files;
}

/**
 * `contracts_hash` = 스냅샷 파일 목록의 정준 JSON 해시(Brief 결정, CR 후보 ③). 스냅샷이 없으면 app_version으로 폴백한다.
 * 파일명 순서·읽기 순서와 무관하게 결정적이다.
 */
export async function readBundleInfo(appRoot: string, runtime: Runtime): Promise<BundleInfo> {
  const appVersion = await readVersion(appRoot);
  const files = await snapshotFiles(appRoot);
  const contractsHash =
    files.length > 0
      ? sha256Hex(canonicalJson({ v: 1, files }))
      : sha256Hex(canonicalJson({ v: 1, app_version: appVersion, files: [] }));
  return { appRoot, runtime, appVersion, contractsHash };
}
