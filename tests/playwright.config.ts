// biome-ignore-all lint/style/noProcessEnv: 테스트 구성 — 브라우저 위치·INT 식별자·엔진 매트릭스 env(STD-CFG-20 "테스트에서만")
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: 테스트 구성 — turbo 캐시 대상이 아닌 러너 env
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync('/opt/pw-browsers')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const intEnv = process.env.FATHOM_INT ?? 'local';
const INT = /^(INT-[0-9a-z]+|PG-3|local)$/.test(intEnv) ? intEnv : 'local';
const VIEWPORT = { width: 1280, height: 800 };
const LAUNCH_OPTIONS = {
  args: [
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-pings',
  ],
};

export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'security/**/*.pw.ts'],
  fullyParallel: false,
  workers: Math.max(1, Math.min(4, os.availableParallelism() - 1)),
  retries: 0,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 100 },
  },
  snapshotPathTemplate: '{testDir}/e2e/__screenshots__/{testFileName}/{arg}-{projectName}{ext}',
  outputDir: '../test-results/e2e',
  reporter: [['list'], ['json', { outputFile: path.join(repoRoot, '.reports', INT, 'e2e.json') }]],
  use: {
    trace: 'retain-on-failure',
    video: 'off',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'dark',
    viewport: VIEWPORT,
    launchOptions: LAUNCH_OPTIONS,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, launchOptions: LAUNCH_OPTIONS },
    },
    ...(process.env.CI_MATRIX_ENGINES === '1'
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
          { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
        ]
      : []),
  ],
});
