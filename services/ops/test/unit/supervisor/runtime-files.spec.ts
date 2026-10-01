import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RegistryFile } from '../../../src/supervisor/runtime-files.js';
import {
  acquireLock,
  createRuntimeFiles,
  ensureRunDirs,
  SupervisorLockFile,
} from '../../../src/supervisor/runtime-files.js';
import { createCliToken } from '../../../src/supervisor/tokens.js';
import { createHarness } from './fakes.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmpHome(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'fathom-run-'));
  dirs.push(d);
  await ensureRunDirs(d);
  return d;
}
const INFO: SupervisorLockFile = {
  pid: 4242,
  boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
  version: '1.2.3',
  started_at: 1_790_000_000_000,
  profile: 'test',
};

describe('lock · cli.token · registry 쓰기', () => {
  it('UT-SUP-018 lock: wx·0600·필드 5개, 살아 있는 보유자 → 미획득, 죽은 pid → 덮어씀 + previousCrashed [FR-SET-001][NFR-SEC-019]', async () => {
    const home = await tmpHome();
    const lockPath = path.join(home, 'run', 'supervisor.lock');
    expect(await acquireLock(home, INFO)).toEqual({ acquired: true, previousCrashed: false });
    expect((await stat(lockPath)).mode & 0o777).toBe(0o600);
    const body = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['boot_id', 'pid', 'profile', 'started_at', 'version']);
    expect(SupervisorLockFile.safeParse(body).success).toBe(true);

    const other = { ...INFO, pid: 9999 };
    expect(await acquireLock(home, other, { isAlive: () => true })).toEqual({ acquired: false });
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ pid: 4242 });
    expect(await acquireLock(home, other, { isAlive: () => false })).toEqual({ acquired: true, previousCrashed: true });
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ pid: 9999 });
    // 깨진 lock = stale
    await writeFile(lockPath, '{not json');
    expect(await acquireLock(home, INFO, { isAlive: () => true })).toEqual({ acquired: true, previousCrashed: true });
  });

  it('UT-SUP-068 stale lock 인수는 원자적: 같은 죽은 lock을 보는 두 supervisor 중 정확히 하나만 획득, 잔여 파일 0 [FR-SET-001][NFR-SEC-019]', async () => {
    for (let round = 0; round < 20; round++) {
      const home = await tmpHome();
      const lockPath = path.join(home, 'run', 'supervisor.lock');
      await writeFile(lockPath, `${JSON.stringify({ ...INFO, pid: 7777 })}\n`);
      const isAlive = (pid: number): boolean => pid !== 7777;
      const [a, b] = await Promise.all([
        acquireLock(home, { ...INFO, pid: 4242 }, { isAlive }),
        acquireLock(home, { ...INFO, pid: 4243 }, { isAlive }),
      ]);
      const winners = [a, b].filter((r) => r.acquired);
      expect(winners, `round ${round}`).toHaveLength(1);
      // previousCrashed는 판정 못 한 쪽이 이길 수 있어(상대가 stale을 먼저 치움) 여기서는 단정하지 않는다.
      const owner = (JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number }).pid;
      expect(owner).toBe(a.acquired ? 4242 : 4243);
      expect((await readdir(path.join(home, 'run'))).filter((n) => n.includes('stale'))).toEqual([]);
    }
  });

  it('UT-SUP-019 cli.token: 43자 base64url·0600·boot마다 다름, 정상 종료 시 lock·token 삭제 [FR-SET-001][NFR-SEC-019]', async () => {
    const home = await tmpHome();
    const files = createRuntimeFiles(home);
    const a = createCliToken((n) => randomBytes(n));
    const b = createCliToken((n) => randomBytes(n));
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    await files.writeCliToken(a);
    const tokenPath = path.join(home, 'run', 'cli.token');
    expect(await readFile(tokenPath, 'utf8')).toBe(a);
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
    await acquireLock(home, INFO);
    await files.removeRunFiles();
    await expect(stat(tokenPath)).rejects.toThrow();
    await expect(stat(path.join(home, 'run', 'supervisor.lock'))).rejects.toThrow();
    // supervisor는 start() 때 이 형식의 토큰을 쓴다
    const h = createHarness();
    await h.start();
    expect(h.files.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('UT-SUP-029 registry 쓰기: 쓰는 중 3회 변경 → 추가 쓰기 1회(최신 값), 0600 [FR-SET-001][DR-021]', async () => {
    const h = createHarness();
    await h.up();
    const base = h.files.last();
    const make = (n: number): RegistryFile => ({ ...base, updated_at: base.updated_at + n });
    const writes: { text: string; mode: number }[] = [];
    const release: (() => void)[] = [];
    const home = await tmpHome();
    const files = createRuntimeFiles(home, {
      writeFile: (_target, data, o) =>
        new Promise<void>((resolve) => {
          writes.push({ text: data, mode: o.mode });
          release.push(resolve);
        }),
    });
    files.writeRegistry(make(1));
    files.writeRegistry(make(2));
    files.writeRegistry(make(3));
    files.writeRegistry(make(4));
    expect(writes).toHaveLength(1);
    release[0]?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1]?.text ?? '{}')).toMatchObject({ updated_at: base.updated_at + 4 });
    release[1]?.();
    await files.flush();
    expect(writes).toHaveLength(2);
    expect(writes.every((w) => w.mode === 0o600 && w.text.endsWith('\n'))).toBe(true);
  });
});
