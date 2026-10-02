import { fileURLToPath } from 'node:url';
import { fathomVitestPreset, NO_NETWORK_SETUP } from '@fathom/testkit/vitest-preset';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: fathomVitestPreset.resolve,
  ssr: fathomVitestPreset.ssr,
  test: {
    setupFiles: [NO_NETWORK_SETUP],
    restoreMocks: true,
    passWithNoTests: true,
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    projects: [
      { extends: true, test: { name: 'contract', include: ['contract/**/*.spec.ts'] } },
      { extends: true, test: { name: 'integration', include: ['integration/**/*.spec.ts'] } },
      { extends: true, test: { name: 'chaos', include: ['chaos/**/*.spec.ts'] } },
      { extends: true, test: { name: 'security', include: ['security/**/*.spec.ts'] } },
    ],
  },
});
