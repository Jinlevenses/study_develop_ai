import type { Dirent } from 'node:fs';
import { chmod, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type TempHome = {
  readonly path: string;
  cleanup(): Promise<void>;
  /** `tmp/`·`run/` 아래에 남은 파일이 있으면 목록과 함께 실패한다(잔존물 검사). */
  assertClean(): Promise<void>;
};

async function listFiles(dir: string, rel: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return [];
    }
    throw cause;
  }
  const found: string[] = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    const childRel = path.join(rel, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listFiles(child, childRel)));
    } else {
      found.push(childRel);
    }
  }
  return found;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return false;
    }
    throw cause;
  }
}

/** 테스트 전용 임시 `FATHOM_HOME`(0700). 반드시 `cleanup()`(또는 `withTempHome`)으로 정리한다. */
export async function createTempHome(prefix = 'fathom-test-'): Promise<TempHome> {
  const home = await mkdtemp(path.join(tmpdir(), prefix));
  if (process.platform !== 'win32') {
    await chmod(home, 0o700);
  }
  return {
    path: home,
    async cleanup(): Promise<void> {
      await rm(home, { recursive: true, force: true });
      if (await exists(home)) {
        throw new Error(`temp home still exists after cleanup: ${home}`);
      }
    },
    async assertClean(): Promise<void> {
      const leftovers = [
        ...(await listFiles(path.join(home, 'tmp'), 'tmp')),
        ...(await listFiles(path.join(home, 'run'), 'run')),
      ];
      if (leftovers.length > 0) {
        throw new Error(`temp home has leftover files:\n${leftovers.sort().join('\n')}`);
      }
    },
  };
}

/** 임시 HOME에서 `fn`을 실행하고, 성공·실패와 무관하게 정리한다. */
export async function withTempHome<T>(fn: (home: TempHome) => Promise<T>, prefix?: string): Promise<T> {
  const home = await createTempHome(prefix);
  try {
    return await fn(home);
  } finally {
    await home.cleanup();
  }
}
