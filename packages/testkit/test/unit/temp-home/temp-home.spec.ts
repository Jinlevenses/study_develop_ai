import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTempHome, withTempHome } from '../../../src/temp-home.js';

const posixOnly = process.platform === 'win32' ? it.skip : it;

function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

describe('temp-home', () => {
  posixOnly('UT-TK-023 임시 HOME은 0700이고 prefix를 따른다 [NFR-MAINT-009]', async () => {
    // Arrange / Act
    const home = await createTempHome('fathom-tk-test-');
    try {
      // Assert
      expect(path.basename(home.path).startsWith('fathom-tk-test-')).toBe(true);
      expect((await stat(home.path)).mode & 0o777).toBe(0o700);
    } finally {
      await home.cleanup();
    }
  });

  it('UT-TK-024 cleanup은 디렉터리를 제거하고 반복 호출해도 안전하다 [NFR-MAINT-009]', async () => {
    // Arrange
    const home = await createTempHome();
    await mkdir(path.join(home.path, 'data'), { recursive: true });
    await writeFile(path.join(home.path, 'data', 'x.db'), 'x');
    // Act
    await home.cleanup();
    // Assert
    expect(await exists(home.path)).toBe(false);
    await expect(home.cleanup()).resolves.toBeUndefined();
  });

  it('UT-TK-025 assertClean은 tmp·run 아래 잔존 파일을 목록과 함께 실패시킨다 [NFR-MAINT-009]', async () => {
    // Arrange
    const home = await createTempHome();
    try {
      await home.assertClean();
      await mkdir(path.join(home.path, 'data'), { recursive: true });
      await writeFile(path.join(home.path, 'data', 'ignored.db'), 'x'); // data는 검사 대상이 아니다
      await home.assertClean();
      await mkdir(path.join(home.path, 'tmp', 'egress'), { recursive: true });
      await writeFile(path.join(home.path, 'tmp', 'egress', '1.jsonl'), '{}');
      await mkdir(path.join(home.path, 'run'), { recursive: true });
      await writeFile(path.join(home.path, 'run', 'x.pid'), '1');
      // Act / Assert
      const failure = await home.assertClean().catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain(path.join('tmp', 'egress', '1.jsonl'));
      expect(message).toContain(path.join('run', 'x.pid'));
      expect(message).not.toContain('ignored.db');
    } finally {
      await home.cleanup();
    }
  });

  it('UT-TK-026 withTempHome은 실패해도 정리하고 결과를 돌려준다 [NFR-MAINT-009]', async () => {
    // Arrange
    let captured = '';
    // Act
    const value = await withTempHome((home) => {
      captured = home.path;
      return Promise.resolve(7);
    });
    const failure = await withTempHome((home) => {
      captured = home.path;
      return Promise.reject(new Error('boom'));
    }).catch((e: unknown) => e);
    // Assert
    expect(value).toBe(7);
    expect((failure as Error).message).toBe('boom');
    expect(await exists(captured)).toBe(false);
  });
});
