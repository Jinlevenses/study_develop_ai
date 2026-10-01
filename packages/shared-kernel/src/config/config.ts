import { constants } from 'node:fs';
import { lstat, open, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Result } from '../errors/errors.js';
import { err, ok } from '../errors/errors.js';
import { ulid } from '../ids/ids.js';

// STD-01 §8.3 허용 환경변수 표 — 이 표 밖은 읽기 금지(STD-CFG-20).
export const ALLOWED_ENV = [
  'FATHOM_HOME',
  'FATHOM_DEPLOY',
  'FATHOM_SUPERVISOR',
  'FATHOM_AI_CASSETTE_DIR',
  'FATHOM_MODE',
  'FATHOM_DEADLINE_MS',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'TYPESAFE_API_KEY',
  'TYPESAFE_BASE_URL',
  'NODE_OPTIONS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'PATH',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TZ',
  'SYSTEMROOT',
  'CI',
] as const;
export type AllowedEnvName = (typeof ALLOWED_ENV)[number];

const ALLOWED_ENV_SET: ReadonlySet<string> = new Set<string>(ALLOWED_ENV);

/** 저장소에서 `process.env`를 읽는 유일한 함수(STD-CFG-20). 목록 밖 이름은 타입 우회여도 결함으로 던진다. */
export function readAllowedEnv(name: AllowedEnvName): string | undefined {
  if (!ALLOWED_ENV_SET.has(name)) {
    throw new Error(`invariant: env ${name} not allowed`);
  }
  return process.env[name];
}

export type FathomHomeDeps = {
  readonly platform?: NodeJS.Platform;
  readonly env?: (name: AllowedEnvName) => string | undefined;
  readonly homedir?: () => string;
};

/** STD-CFG-10(CR-01): `FATHOM_HOME` → win32 `%LOCALAPPDATA%\Fathom` → 그 밖 `~/.fathom`. dev 분기는 호출자(CLI)가 `FATHOM_HOME`으로 넘긴다. */
export function resolveFathomHome(deps?: FathomHomeDeps): string {
  const platform = deps?.platform ?? process.platform;
  const env = deps?.env ?? readAllowedEnv;
  const home = deps?.homedir ?? homedir;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const override = env('FATHOM_HOME');
  if (override !== undefined && override !== '') {
    if (!p.isAbsolute(override)) {
      throw new Error('invariant: FATHOM_HOME must be an absolute path');
    }
    return override;
  }
  if (platform === 'win32') {
    const local = env('LOCALAPPDATA');
    if (local !== undefined && local !== '') {
      return path.win32.join(local, 'Fathom');
    }
    const profile = env('USERPROFILE');
    return path.win32.join(profile !== undefined && profile !== '' ? profile : home(), 'AppData', 'Local', 'Fathom');
  }
  return path.posix.join(home(), '.fathom');
}

export type HomeKind =
  | 'data'
  | 'run'
  | 'logs'
  | 'backups'
  | 'packs'
  | 'policy'
  | 'secrets'
  | 'cli-homes'
  | 'inbox-queue'
  | 'exports'
  | 'tmp';

export type ResolveInsideError = {
  readonly reason:
    | 'empty'
    | 'nul'
    | 'absolute'
    | 'drive_letter'
    | 'unc'
    | 'device_name'
    | 'ads'
    | 'escape'
    | 'symlink_escape'
    | 'unresolvable';
};

const DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function deviceNameOf(segment: string): boolean {
  // Windows는 끝의 공백·점을 무시하고 첫 점 앞 이름으로 장치를 판별한다.
  const trimmed = segment.replace(/[. ]+$/, '');
  const stem = trimmed.split('.')[0] ?? '';
  return DEVICE_NAME.test(stem.trimEnd());
}

function isInside(p: path.PlatformPath, base: string, target: string): boolean {
  const rel = p.relative(base, target);
  if (rel === '') {
    return true;
  }
  return rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
}

/** STD-SEC-03 규칙을 모든 플랫폼에서 적용하는 어휘적 경로 검증(Brief 결정: 이식성). 성공 = 정규화된 절대 경로. */
export function resolveInsideLexical(
  base: string,
  untrusted: string,
  platform: NodeJS.Platform = process.platform,
): Result<string, ResolveInsideError> {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (untrusted === '') {
    return err({ reason: 'empty' });
  }
  if (untrusted.includes('\0')) {
    return err({ reason: 'nul' });
  }
  if (untrusted.startsWith('\\\\') || untrusted.startsWith('//')) {
    return err({ reason: 'unc' });
  }
  if (untrusted.startsWith('/') || untrusted.startsWith('\\')) {
    return err({ reason: 'absolute' });
  }
  if (/^[A-Za-z]:/.test(untrusted)) {
    return err({ reason: 'drive_letter' });
  }
  const segments = untrusted.split(/[\\/]/);
  for (const segment of segments) {
    if (deviceNameOf(segment)) {
      return err({ reason: 'device_name' });
    }
    if (segment.includes(':')) {
      return err({ reason: 'ads' });
    }
  }
  const resolvedBase = p.resolve(base);
  const target = p.resolve(resolvedBase, ...segments);
  if (!isInside(p, resolvedBase, target)) {
    return err({ reason: 'escape' });
  }
  return ok(target);
}

function errnoCode(cause: unknown): string | undefined {
  if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
    return cause.code;
  }
  return undefined;
}

const MISSING_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/**
 * `lstat`로 위로 올라가며 실제로 존재하는 가장 깊은 항목을 찾아 `realpath`하고, 존재하지 않는 꼬리를 그대로 붙인다.
 * 심볼릭 링크는 `lstat`가 존재로 본다. 대상이 없는 링크(dangling)는 탈출 경로가 될 수 있어 거부한다(STD-SEC-03).
 * ENOENT·ENOTDIR 밖의 오류(ELOOP·EACCES 등)는 던지지 않고 `unresolvable`로 돌려준다.
 */
async function realpathOfDeepestExisting(
  p: path.PlatformPath,
  target: string,
): Promise<Result<string, ResolveInsideError>> {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    let isLink = false;
    let exists = true;
    try {
      isLink = (await lstat(current)).isSymbolicLink();
    } catch (cause) {
      const code = errnoCode(cause);
      if (code === undefined || !MISSING_CODES.has(code)) {
        return err({ reason: 'unresolvable' });
      }
      exists = false;
    }
    if (exists) {
      try {
        return ok(p.join(await realpath(current), ...tail));
      } catch (cause) {
        const code = errnoCode(cause);
        if (isLink && code !== undefined && MISSING_CODES.has(code)) {
          return err({ reason: 'symlink_escape' }); // 대상 없는 링크
        }
        return err({ reason: 'unresolvable' });
      }
    }
    const parent = p.dirname(current);
    if (parent === current) {
      return ok(p.join(current, ...tail));
    }
    tail.unshift(p.basename(current));
    current = parent;
  }
}

/** lexical 통과 후, 존재하는 가장 깊은 항목을 `realpath`해 base 안인지 다시 확인한다(심볼릭 링크·dangling 링크 탈출 거부). */
export async function resolveInside(
  base: string,
  untrusted: string,
  platform: NodeJS.Platform = process.platform,
): Promise<Result<string, ResolveInsideError>> {
  const lexical = resolveInsideLexical(base, untrusted, platform);
  if (!lexical.ok) {
    return lexical;
  }
  const p = platform === 'win32' ? path.win32 : path.posix;
  const realBase = await realpathOfDeepestExisting(p, p.resolve(base));
  if (!realBase.ok) {
    return realBase;
  }
  const realTarget = await realpathOfDeepestExisting(p, lexical.value);
  if (!realTarget.ok) {
    return realTarget;
  }
  if (!isInside(p, realBase.value, realTarget.value)) {
    return err({ reason: 'symlink_escape' });
  }
  return lexical;
}

/** STD-CFG-11: FATHOM_HOME 하위 경로는 이 함수로만 만든다. 세그먼트는 코드가 만든 값이므로 위반은 결함이다. */
export function homePath(home: string, kind: HomeKind, ...segments: string[]): string {
  for (const segment of segments) {
    // 세그먼트 하나가 홈 밖·절대·장치 이름이면 합쳐지기 전에 결함으로 잡는다(`'/x'`가 `data//x`로 묻히지 않게).
    const single = resolveInsideLexical(home, segment);
    if (!single.ok) {
      throw new Error(`invariant: homePath segment rejected (${single.error.reason})`);
    }
  }
  const result = resolveInsideLexical(home, [kind, ...segments].join('/'));
  if (!result.ok) {
    throw new Error(`invariant: homePath segment rejected (${result.error.reason})`);
  }
  return result.value;
}

const DIR_FSYNC_IGNORABLE: ReadonlySet<string> = new Set(['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR']);

async function fsyncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (cause) {
    if (
      cause instanceof Error &&
      'code' in cause &&
      typeof cause.code === 'string' &&
      DIR_FSYNC_IGNORABLE.has(cause.code)
    ) {
      return; // 디렉터리 fsync를 지원하지 않는 파일시스템
    }
    throw cause;
  }
}

/** STD-TS-43: 같은 디렉터리 tmp(`wx`, 기본 0600) → write → fsync → rename → (POSIX) 디렉터리 fsync. 실패 시 tmp 삭제. */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  opts?: { readonly mode?: number },
): Promise<void> {
  const mode = opts?.mode ?? 0o600;
  const tmp = path.join(path.dirname(target), `${path.basename(target)}.${ulid()}.tmp`);
  try {
    const handle = await open(tmp, 'wx', mode);
    try {
      if (process.platform !== 'win32') {
        await handle.chmod(mode);
      }
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, target);
    if (process.platform !== 'win32') {
      await fsyncDirectory(path.dirname(target));
    }
  } catch (cause) {
    await rm(tmp, { force: true });
    throw new Error(`writeFileAtomic failed: ${path.basename(target)}`, { cause });
  }
}
