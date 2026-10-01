import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import type { ViteUserConfig } from 'vitest/config';

const SETUP_EXT = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

/** 무네트워크 setup 파일의 절대 경로(vitest setupFiles는 패키지 이름을 해석하지 못한다). */
export const NO_NETWORK_SETUP: string = fileURLToPath(new URL(`./setup/no-network.${SETUP_EXT}`, import.meta.url));

/** STD-01 §13.4 preset. 패키지 vitest.config.ts가 mergeConfig로 확장한다. */
export const fathomVitestPreset = {
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    setupFiles: [NO_NETWORK_SETUP],
    restoreMocks: true,
    testTimeout: 10_000,
    passWithNoTests: true,
    coverage: { provider: 'v8', include: ['src/domain/**'], thresholds: { lines: 80 } },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/{unit,property,golden,component,contract}/**/*.spec.{ts,tsx}'] },
      },
      { extends: true, test: { name: 'integration', include: ['test/integration/**/*.spec.ts'], testTimeout: 60_000 } },
      { extends: true, test: { name: 'security', include: ['test/security/**/*.spec.ts'], testTimeout: 60_000 } },
    ],
  },
} satisfies ViteUserConfig;
