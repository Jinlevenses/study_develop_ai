import { describe, expect, it } from 'vitest';
import { homeWarnings, nodeVersionOk, resolveCliHome } from '../../src/lib/home.js';
import { isRunning, RegistryFile, readLock, readRegistry } from '../../src/lib/lockfile.js';
import { isProcessAlive } from '../../src/lib/real-deps.js';
import { run } from '../../src/run.js';
import {
  ALL_READY,
  BOOT,
  createFakeEnv,
  HOME,
  LOCK_PATH,
  lockText,
  REGISTRY_PATH,
  registryText,
  stderrText,
} from './fakes.js';

describe('home · 사전 검사 · lock/registry 읽기', () => {
  it('UT-CLI-018 home: dev → <appRoot>/.fathom-dev, prod → resolveFathomHome(주입), test + FATHOM_HOME 없음 → 2 [FR-SET-001][NFR-PORT-002]', async () => {
    const f = createFakeEnv();
    expect(resolveCliHome('dev', f.deps)).toEqual({ ok: true, value: '/app/.fathom-dev' });
    const prod = createFakeEnv({}, { FATHOM_HOME: '/custom/home' });
    expect(resolveCliHome('prod', prod.deps)).toEqual({ ok: true, value: '/custom/home' });
    const none = createFakeEnv({}, {});
    expect(resolveCliHome('test', none.deps)).toMatchObject({ ok: false });
    expect(await run(['up', '--profile=test', '--no-open'], none.deps)).toBe(2);
    expect(stderrText(none)).toContain('CLI-VAL-001');
    expect(none.launches).toHaveLength(0);
    const rel = createFakeEnv({}, { FATHOM_HOME: 'relative' });
    expect(resolveCliHome('prod', rel.deps)).toMatchObject({ ok: false });
    expect(resolveCliHome('test', f.deps)).toEqual({ ok: true, value: HOME });
  });

  it('UT-CLI-019 경고: OneDrive·iCloud·Dropbox·Google Drive·UNC·\\\\wsl$·/mnt/c/ (실패 아님) [FR-SET-001][NFR-PORT-002]', () => {
    expect(homeWarnings('C:\\Users\\a\\OneDrive\\Fathom', 'win32')).toHaveLength(1);
    expect(homeWarnings('/Users/a/Library/Mobile Documents/com~apple~CloudDocs/f', 'darwin')).toHaveLength(1);
    expect(homeWarnings('/Users/a/iCloud/f', 'darwin')).toHaveLength(1);
    expect(homeWarnings('/home/a/Dropbox/f', 'linux')).toHaveLength(1);
    expect(homeWarnings('/home/a/Google Drive/f', 'linux')).toHaveLength(1);
    expect(homeWarnings('/home/a/DROPBOX/f', 'linux')).toHaveLength(1);
    expect(homeWarnings('\\\\server\\share\\fathom', 'win32')).toHaveLength(1);
    expect(homeWarnings('\\\\wsl$\\Ubuntu\\home\\a', 'win32')[0]).toContain('WSL');
    expect(homeWarnings('/mnt/c/Users/a/fathom', 'linux')[0]).toContain('/mnt/');
    expect(homeWarnings('/home/a/.fathom', 'linux')).toEqual([]);
    expect(homeWarnings('/mnt/c/x', 'darwin')).toEqual([]);
  });

  it('UT-CLI-020 Node 22.14 → 2 (Node 22.15 이상 필요) [NFR-PORT-002]', async () => {
    expect(nodeVersionOk('v22.15.0')).toBe(true);
    expect(nodeVersionOk('v22.22.2')).toBe(true);
    expect(nodeVersionOk('v24.0.0')).toBe(true);
    expect(nodeVersionOk('v22.14.9')).toBe(false);
    expect(nodeVersionOk('v20.19.0')).toBe(false);
    expect(nodeVersionOk('garbage')).toBe(false);
    const f = createFakeEnv({ nodeVersion: 'v22.14.0' });
    expect(await run(['status', '--profile=test'], f.deps)).toBe(2);
    expect(stderrText(f)).toContain('Node 22.15 이상 필요');
  });

  it('UT-CLI-021 lock 없음·깨진 JSON → null (깨진 경우 warn 1회) [FR-SET-001]', async () => {
    const f = createFakeEnv();
    expect(await readLock(HOME, f.deps)).toBeNull();
    f.files.set(LOCK_PATH, '{not json');
    const invalid: string[] = [];
    expect(await readLock(HOME, f.deps, (w) => invalid.push(w))).toBeNull();
    expect(invalid).toHaveLength(1);
    f.files.set(LOCK_PATH, JSON.stringify({ pid: 1 }));
    expect(await readLock(HOME, f.deps)).toBeNull();
    f.files.set(LOCK_PATH, lockText(77));
    expect(await readLock(HOME, f.deps)).toMatchObject({ pid: 77, boot_id: BOOT });
  });

  it('UT-CLI-022 pid 생존 판정은 주입된 isAlive를 따른다(ESRCH → 꺼짐, EPERM → 켜짐) [FR-SET-001]', () => {
    const lock = { pid: 9, boot_id: BOOT, version: '1.2.3', started_at: 1, profile: 'test' as const };
    expect(isRunning(lock, { isAlive: () => false })).toBe(false);
    expect(isRunning(lock, { isAlive: () => true })).toBe(true);
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2 ** 22 + 12_345)).toBe(false);
  });

  it('UT-CLI-023 RegistryFile strict: 미지 키 거부, 유효 레지스트리 파싱 [FR-SET-001]', () => {
    const text = registryText(ALL_READY);
    expect(RegistryFile.safeParse(JSON.parse(text)).success).toBe(true);
    expect(RegistryFile.safeParse({ ...JSON.parse(text), extra: 1 }).success).toBe(false);
    const bad = JSON.parse(text) as { services: { gateway: object } };
    bad.services.gateway = { ...bad.services.gateway, token: 'x' };
    expect(RegistryFile.safeParse(bad).success).toBe(false);
  });

  it('UT-CLI-024 readRegistry: 없음·깨짐 → null, 유효 → 객체 [FR-SET-001]', async () => {
    const f = createFakeEnv();
    expect(await readRegistry(HOME, f.deps)).toBeNull();
    f.files.set(REGISTRY_PATH, '{"v":1');
    expect(await readRegistry(HOME, f.deps)).toBeNull();
    f.files.set(REGISTRY_PATH, registryText(ALL_READY));
    expect((await readRegistry(HOME, f.deps))?.services.gateway?.port).toBe(4747);
  });
});
