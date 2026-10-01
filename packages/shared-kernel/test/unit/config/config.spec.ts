import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AllowedEnvName, HomeKind } from '../../../src/config/config.js';
import {
  ALLOWED_ENV,
  homePath,
  readAllowedEnv,
  resolveFathomHome,
  resolveInside,
  resolveInsideLexical,
  writeFileAtomic,
} from '../../../src/config/config.js';

const posixOnly = process.platform === 'win32' ? it.skip : it;
let sandbox = '';

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'fathom-sk-config-'));
});
afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('resolveInside', () => {
  it('UT-SK-017 위험 경로 9종·심볼릭 링크 탈출을 거부하고 정상 경로는 허용한다 [NFR-SEC-014]', async () => {
    // 위험 경로 9종·심볼릭 링크 탈출을 거부하고 정상 경로는 허용한다 [NFR-SEC-014]
    {
      // Arrange
      const base = path.join(sandbox, 'base');
      await mkdir(base, { recursive: true });
      const cases: ReadonlyArray<readonly [string, string]> = [
        ['../x', 'escape'],
        ['a/../../x', 'escape'],
        ['/etc', 'absolute'],
        ['C:\\x', 'drive_letter'],
        ['\\\\srv\\s', 'unc'],
        ['CON', 'device_name'],
        ['nul.txt', 'device_name'],
        ['a:b', 'drive_letter'],
        ['x/a:b', 'ads'],
        ['a\0b', 'nul'],
        ['', 'empty'],
      ];
      // Act / Assert: 어휘 검사
      for (const [input, reason] of cases) {
        const lexical = resolveInsideLexical(base, input);
        expect(lexical).toEqual({ ok: false, error: { reason } });
        const full = await resolveInside(base, input);
        expect(full).toEqual({ ok: false, error: { reason } });
      }
      // 정상
      const good = await resolveInside(base, 'a/b');
      expect(good).toEqual({ ok: true, value: path.join(base, 'a', 'b') });
    }
    // base 밖을 가리키는 심볼릭 링크를 거부한다 [NFR-SEC-014]
    if (process.platform !== 'win32') {
      // Arrange
      const base = path.join(sandbox, 'base');
      const outside = path.join(sandbox, 'outside');
      await mkdir(base, { recursive: true });
      await mkdir(outside, { recursive: true });
      await symlink(outside, path.join(base, 'link'));
      await mkdir(path.join(base, 'real'), { recursive: true });
      await symlink(path.join(base, 'real'), path.join(base, 'inner'));
      // Act
      const escaped = await resolveInside(base, 'link/secret.txt');
      const inner = await resolveInside(base, 'inner/ok.txt');
      // Assert
      expect(escaped).toEqual({ ok: false, error: { reason: 'symlink_escape' } });
      expect(inner.ok).toBe(true);
    }
    // base 밖 없는 파일을 가리키는 dangling 심볼릭 링크를 거부한다 [NFR-SEC-014]
    if (process.platform !== 'win32') {
      // Arrange
      const base = path.join(sandbox, 'base');
      const outside = path.join(sandbox, 'outside');
      await mkdir(base, { recursive: true });
      await mkdir(outside, { recursive: true });
      await symlink(path.join(outside, 'new.txt'), path.join(base, 'dangling'));
      await symlink('../outside/new.txt', path.join(base, 'relative-dangling'));
      await symlink(path.join(outside, 'missing-dir'), path.join(base, 'dir-dangling'));
      await symlink(path.join(base, 'loop-b'), path.join(base, 'loop-a'));
      await symlink(path.join(base, 'loop-a'), path.join(base, 'loop-b'));
      // Act
      const direct = await resolveInside(base, 'dangling');
      const relative = await resolveInside(base, 'relative-dangling');
      const nested = await resolveInside(base, 'dir-dangling/sub/file.txt');
      const loop = await resolveInside(base, 'loop-a');
      // Assert
      expect(direct).toEqual({ ok: false, error: { reason: 'symlink_escape' } });
      expect(relative).toEqual({ ok: false, error: { reason: 'symlink_escape' } });
      expect(nested).toEqual({ ok: false, error: { reason: 'symlink_escape' } });
      expect(loop).toEqual({ ok: false, error: { reason: 'unresolvable' } });
      await expect(readdir(outside)).resolves.toEqual([]);
    }
  });
});

describe('config', () => {
  it('UT-SK-046 readAllowedEnv는 목록 밖 이름을 던지고 목록 안 이름은 읽는다 [NFR-SEC-014]', () => {
    // Arrange
    const outside = 'SECRET_THING' as AllowedEnvName;
    // Act / Assert
    expect(() => readAllowedEnv(outside)).toThrow('invariant: env SECRET_THING not allowed');
    expect(ALLOWED_ENV).toHaveLength(27);
    expect(typeof readAllowedEnv('PATH')).toBe('string');
  });

  it('UT-SK-047 resolveFathomHome은 FATHOM_HOME 재정의를 최우선한다 [NFR-PORT-005]', () => {
    const env = (n: AllowedEnvName): string | undefined => (n === 'FATHOM_HOME' ? '/data/fathom' : undefined);
    expect(resolveFathomHome({ platform: 'linux', env, homedir: () => '/home/u' })).toBe('/data/fathom');
    const winEnv = (n: AllowedEnvName): string | undefined => (n === 'FATHOM_HOME' ? 'D:\\Fathom' : undefined);
    expect(resolveFathomHome({ platform: 'win32', env: winEnv, homedir: () => 'C:\\Users\\u' })).toBe('D:\\Fathom');
  });

  it('UT-SK-048 resolveFathomHome은 플랫폼별 기본 위치를 쓴다(주입) [NFR-PORT-005]', () => {
    const none = (): undefined => undefined;
    expect(resolveFathomHome({ platform: 'linux', env: none, homedir: () => '/home/u' })).toBe('/home/u/.fathom');
    expect(resolveFathomHome({ platform: 'darwin', env: none, homedir: () => '/Users/u' })).toBe('/Users/u/.fathom');
    const local = (n: AllowedEnvName): string | undefined =>
      n === 'LOCALAPPDATA' ? 'C:\\Users\\u\\AppData\\Local' : undefined;
    expect(resolveFathomHome({ platform: 'win32', env: local, homedir: () => 'C:\\Users\\u' })).toBe(
      'C:\\Users\\u\\AppData\\Local\\Fathom',
    );
    const profile = (n: AllowedEnvName): string | undefined => (n === 'USERPROFILE' ? 'C:\\Users\\v' : undefined);
    expect(resolveFathomHome({ platform: 'win32', env: profile, homedir: () => 'C:\\x' })).toBe(
      'C:\\Users\\v\\AppData\\Local\\Fathom',
    );
  });

  it('UT-SK-049 상대 경로 FATHOM_HOME은 던진다 [NFR-PORT-005]', () => {
    const rel = (n: AllowedEnvName): string | undefined => (n === 'FATHOM_HOME' ? 'relative/dir' : undefined);
    expect(() => resolveFathomHome({ platform: 'linux', env: rel })).toThrow(/^invariant:/);
    expect(() => resolveFathomHome({ platform: 'win32', env: rel })).toThrow(/^invariant:/);
  });

  it('UT-SK-050 homePath는 11종 종류를 home 하위로 만든다 [NFR-PORT-005]', () => {
    // Arrange
    const kinds: readonly HomeKind[] = [
      'data',
      'run',
      'logs',
      'backups',
      'packs',
      'policy',
      'secrets',
      'cli-homes',
      'inbox-queue',
      'exports',
      'tmp',
    ];
    const home = path.join(sandbox, 'home');
    // Act / Assert
    for (const kind of kinds) {
      expect(homePath(home, kind)).toBe(path.join(home, kind));
    }
    expect(homePath(home, 'data', 'content.db')).toBe(path.join(home, 'data', 'content.db'));
    expect(homePath(home, 'logs', 'learning', '2026-10-01.jsonl')).toBe(
      path.join(home, 'logs', 'learning', '2026-10-01.jsonl'),
    );
  });

  it('UT-SK-051 homePath는 탈출·절대·장치 이름 세그먼트를 결함으로 던진다 [NFR-SEC-014]', () => {
    const home = path.join(sandbox, 'home');
    expect(() => homePath(home, 'data', '..', '..', 'x')).toThrow(/^invariant:/);
    expect(() => homePath(home, 'data', '/etc/passwd')).toThrow(/^invariant:/);
    expect(() => homePath(home, 'data', 'NUL')).toThrow(/^invariant:/);
  });

  it('UT-SK-052 resolveInsideLexical은 결과를 정규화한다 [NFR-SEC-014]', () => {
    expect(resolveInsideLexical('/base', 'a/./b//c/../d', 'linux')).toEqual({ ok: true, value: '/base/a/b/d' });
    expect(resolveInsideLexical('/base', 'a\\b', 'linux')).toEqual({ ok: true, value: '/base/a/b' }); // 구분자 둘 다 인정
    expect(resolveInsideLexical('/base', 'a/..', 'linux')).toEqual({ ok: true, value: '/base' });
    expect(resolveInsideLexical('/base', '..\\..\\x', 'linux')).toEqual({ ok: false, error: { reason: 'escape' } });
    expect(resolveInsideLexical('/base', '/base/a', 'linux')).toEqual({ ok: false, error: { reason: 'absolute' } });
    expect(resolveInsideLexical('/base', '//srv/s', 'linux')).toEqual({ ok: false, error: { reason: 'unc' } });
    expect(resolveInsideLexical('/base', 'LPT1.log', 'linux')).toEqual({ ok: false, error: { reason: 'device_name' } });
    expect(resolveInsideLexical('/base', 'com10', 'linux').ok).toBe(true); // COM1~9만 장치
  });

  it('UT-SK-053 win32에서는 비교가 대소문자를 무시하고 win32 구분자로 정규화한다 [NFR-PORT-005]', () => {
    expect(resolveInsideLexical('C:\\Fathom', 'data/x.db', 'win32')).toEqual({
      ok: true,
      value: 'C:\\Fathom\\data\\x.db',
    });
    expect(resolveInsideLexical('C:\\Fathom', '..\\fathom\\x', 'win32')).toEqual({ ok: true, value: 'C:\\fathom\\x' });
    expect(resolveInsideLexical('C:\\Fathom', '..\\Other', 'win32')).toEqual({
      ok: false,
      error: { reason: 'escape' },
    });
    expect(resolveInsideLexical('/Fathom', '../fathom/x', 'linux')).toEqual({ ok: false, error: { reason: 'escape' } });
  });
});

describe('writeFileAtomic', () => {
  posixOnly('UT-SK-054 기본 모드는 0600이고 지정 모드를 따른다 [NFR-SEC-014]', async () => {
    // Arrange
    const file = path.join(sandbox, 'secret.json');
    const other = path.join(sandbox, 'public.txt');
    // Act
    await writeFileAtomic(file, '{"a":1}');
    await writeFileAtomic(other, new Uint8Array([1, 2, 3]), { mode: 0o644 });
    // Assert
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(other)).mode & 0o777).toBe(0o644);
    expect(await readFile(file, 'utf8')).toBe('{"a":1}');
    expect([...(await readFile(other))]).toEqual([1, 2, 3]);
  });

  it('UT-SK-055 성공 뒤에도 실패 뒤에도 tmp 잔존물이 없다 [NFR-PORT-005]', async () => {
    // Arrange
    const file = path.join(sandbox, 'a.txt');
    // Act
    await writeFileAtomic(file, 'x');
    // Assert
    expect(await readdir(sandbox)).toEqual(['a.txt']);
    // 대상 디렉터리가 없으면 실패하고 원 오류가 cause로 남는다
    const missing = path.join(sandbox, 'no-such-dir', 'b.txt');
    const failure = await writeFileAtomic(missing, 'y').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).cause).toBeInstanceOf(Error);
    expect(await readdir(sandbox)).toEqual(['a.txt']);
    // 대상이 디렉터리면 rename이 실패하고 tmp가 지워진다
    const dirTarget = path.join(sandbox, 'dir');
    await mkdir(path.join(dirTarget, 'child'), { recursive: true });
    await expect(writeFileAtomic(dirTarget, 'z')).rejects.toThrow(/writeFileAtomic failed/);
    expect((await readdir(sandbox)).sort()).toEqual(['a.txt', 'dir']);
  });

  it('UT-SK-056 기존 파일을 원자적으로 교체한다 [NFR-PORT-005]', async () => {
    // Arrange
    const file = path.join(sandbox, 'state.json');
    await writeFile(file, 'old');
    // Act
    await writeFileAtomic(file, 'new');
    // Assert
    expect(await readFile(file, 'utf8')).toBe('new');
    expect(await readdir(sandbox)).toEqual(['state.json']);
  });
});
