import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { describe, expect, it } from 'vitest';
import { fathomVitestPreset, NO_NETWORK_SETUP } from '../../../src/vitest-preset.js';

describe('fathomVitestPreset', () => {
  it('UT-TK-001 preset projects는 unit·integration·security이고 include·timeout이 STD §13.4와 같다 [NFR-MAINT-009][NFR-MAINT-011]', () => {
    // Arrange
    const projects = fathomVitestPreset.test.projects;
    // Assert
    expect(projects.map((p) => p.test.name)).toEqual(['unit', 'integration', 'security']);
    expect(projects.map((p) => p.test.include)).toEqual([
      ['test/{unit,property,golden,component,contract}/**/*.spec.{ts,tsx}'],
      ['test/integration/**/*.spec.ts'],
      ['test/security/**/*.spec.ts'],
    ]);
    expect(projects.map((p) => p.extends)).toEqual([true, true, true]);
    expect(projects[1]?.test).toMatchObject({ testTimeout: 60000 });
    expect(projects[2]?.test).toMatchObject({ testTimeout: 60000 });
  });

  it('UT-TK-002 source 조건이 첫 자리이고 나머지는 vite 기본값이며 공통 test 옵션이 고정이다 [NFR-MAINT-009]', () => {
    // Assert: resolve 조건
    expect(fathomVitestPreset.resolve.conditions[0]).toBe('source');
    expect(fathomVitestPreset.resolve.conditions.slice(1)).toEqual(defaultClientConditions);
    expect(fathomVitestPreset.ssr.resolve.conditions[0]).toBe('source');
    expect(fathomVitestPreset.ssr.resolve.conditions.slice(1)).toEqual(defaultServerConditions);
    // Arrange·Assert: 공통 test 옵션
    const t = fathomVitestPreset.test;
    expect(t.passWithNoTests).toBe(true);
    expect(t.restoreMocks).toBe(true);
    expect(t.testTimeout).toBe(10000);
    expect(t.coverage).toEqual({ provider: 'v8', include: ['src/domain/**'], thresholds: { lines: 80 } });
  });

  it('UT-TK-003 NO_NETWORK_SETUP은 존재하는 절대 경로이고 setupFiles의 유일한 원소다 [NFR-MAINT-009]', () => {
    // Assert
    expect(isAbsolute(NO_NETWORK_SETUP)).toBe(true);
    expect(NO_NETWORK_SETUP.replaceAll('\\', '/')).toMatch(/setup\/no-network\.ts$/);
    expect(existsSync(NO_NETWORK_SETUP)).toBe(true);
    expect(fathomVitestPreset.test.setupFiles).toEqual([NO_NETWORK_SETUP]);
  });

  it('UT-TK-004 외부 호스트 fetch는 mock 미일치로 거부된다 [NFR-MAINT-009]', async () => {
    // Act
    const failure = await fetch('http://example.invalid/').then(
      () => undefined,
      (error: unknown) => error,
    );
    // Assert
    expect(failure).toBeInstanceOf(Error);
    const cause = failure instanceof Error ? failure.cause : undefined;
    expect(cause).toMatchObject({ code: 'UND_MOCK_ERR_MOCK_NOT_MATCHED' });
  });

  it('UT-TK-005 127.0.0.1 로컬 서버 fetch는 허용된다 [NFR-MAINT-009]', async () => {
    // Arrange
    const { createServer } = await import('node:http');
    const server = createServer((_req, res) => {
      res.end('ok');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      // Act
      const address = server.address();
      expect(address).not.toBeNull();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${String(port)}/`);
      // Assert
      expect(await response.text()).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});
