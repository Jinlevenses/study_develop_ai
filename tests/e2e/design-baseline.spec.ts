import { createRequestCounter } from '@fathom/testkit/playwright/stack-fixture';
import type { Stack } from '@fathom/testkit/spawn-stack';
import { launchStack } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { expect, test } from '@playwright/test';
import { isAlive, openApp, writeEgressReport } from '../support/direct-stack.js';

// E2E-506 (E0-8) — `/_design` 시각 기준선 3장(dark·light·more) + 외부 요청 0 + CSP 실행 차단(CR-61, SEC-GW-009 인계).
// 기준선 = V-build Linux. 갱신: `pnpm test:e2e --grep @design --update-snapshots`(최초 1회).

type Variant = {
  readonly name: 'dark' | 'light' | 'more';
  readonly colorScheme: 'dark' | 'light';
  readonly contrast: 'no-preference' | 'more';
  readonly theme: 'dark' | 'light';
};
const VARIANTS: readonly Variant[] = [
  { name: 'dark', colorScheme: 'dark', contrast: 'no-preference', theme: 'dark' },
  { name: 'light', colorScheme: 'light', contrast: 'no-preference', theme: 'light' },
  { name: 'more', colorScheme: 'dark', contrast: 'more', theme: 'dark' },
];
const VIOLATIONS_KEY = '__fathomCsp';
const PROBE_KEY = '__cspProbe';

test.describe.configure({ mode: 'serial' });
test.skip(process.platform !== 'linux', '기준선 = V-build Linux');

const state: { stack: Stack | null; cleanup: (() => Promise<void>) | null; pids: number[] } = {
  stack: null,
  cleanup: null,
  pids: [],
};

test.beforeAll(async () => {
  const home = await createTempHome('fathom-e2e506-');
  state.cleanup = () => home.cleanup();
  state.stack = await launchStack({ runtime: 'dist', home: home.path });
  const registry = await state.stack.registry();
  state.pids = [
    state.stack.supervisorPid,
    ...Object.values(registry.services).flatMap((s) => (s?.pid === null || s === undefined ? [] : [s.pid])),
  ];
});

test.afterAll(async () => {
  await state.stack?.stop();
  for (const pid of state.pids) {
    expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
  }
  await state.cleanup?.();
});

test('E2E-506 /_design 기준선 3장이 일치하고 외부 요청 0·CSP가 인라인 스크립트 실행을 막는다 @design [FR-UX-001][FR-UX-002][NFR-UX-012]', async ({
  browser,
}) => {
  const stack = state.stack;
  if (stack === null) {
    throw new Error('stack not started');
  }
  let externalRequests = 0;

  for (const variant of VARIANTS) {
    await test.step(`변형 ${variant.name}`, async () => {
      const context = await browser.newContext({
        colorScheme: variant.colorScheme,
        contrast: variant.contrast,
        viewport: { width: 1280, height: 800 },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
      });
      try {
        const counter = createRequestCounter();
        context.on('request', (r) => {
          counter.record(r.url());
        });
        await context.addInitScript(
          ({ theme, key }) => {
            try {
              localStorage.setItem('fathom.theme', theme);
            } catch {
              // 저장소 차단 — 기본 테마로 진행
            }
            Reflect.set(window, key, []);
            document.addEventListener('securitypolicyviolation', (e) => {
              const list: unknown = Reflect.get(window, key);
              if (Array.isArray(list)) {
                list.push(`${e.violatedDirective} ${e.blockedURI}`);
              }
            });
          },
          { theme: variant.theme, key: VIOLATIONS_KEY },
        );
        const page = await context.newPage();
        await openApp(page, stack);
        await page.goto(new URL('/_design', stack.gatewayUrl).href);
        await page.evaluate(() => document.fonts.ready.then(() => true));

        const html = page.locator('html');
        await expect(html).toHaveAttribute('data-theme', variant.theme);
        await expect(html).toHaveAttribute('data-contrast', variant.contrast === 'more' ? 'more' : 'standard');
        await expect(page).toHaveScreenshot(`design-${variant.name}.png`, { fullPage: true });

        expect(counter.count, counter.urls.join(', ')).toBe(0);
        externalRequests += counter.count;
        const appViolations = await page.evaluate((key) => Reflect.get(window, key), VIOLATIONS_KEY);
        // soft: 앱 자체 위반이 있어도 나머지 단언(기준선·CSP 차단 탐침)은 계속 실행해 신호를 모은다. 위반이 있으면 테스트는 실패한다.
        expect.soft(appViolations, '앱 자체의 securitypolicyviolation').toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  await test.step('CSP 실행 차단: 삽입한 인라인 스크립트는 실행되지 않고 위반 1건이 보고된다', async () => {
    const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    try {
      await context.addInitScript((key) => {
        Reflect.set(window, key, []);
        document.addEventListener('securitypolicyviolation', (e) => {
          const list: unknown = Reflect.get(window, key);
          if (Array.isArray(list)) {
            list.push(`${e.violatedDirective} ${e.blockedURI}`);
          }
        });
      }, VIOLATIONS_KEY);
      const page = await context.newPage();
      await openApp(page, stack);
      await page.goto(new URL('/_design', stack.gatewayUrl).href);
      const result = await page.evaluate(
        async ({ key, probe }) => {
          Reflect.set(window, key, []); // 앱 부팅 중 위반은 위 변형 단계에서 따로 판정한다 — 여기서는 탐침이 만든 위반만 센다
          const el = document.createElement('script');
          el.textContent = `window.${probe} = 1`;
          document.head.appendChild(el);
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { ran: Reflect.get(window, probe), violations: Reflect.get(window, key) };
        },
        { key: VIOLATIONS_KEY, probe: PROBE_KEY },
      );
      expect(result.ran).toBeUndefined();
      expect(result.violations).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  writeEgressReport('design-baseline', { l3: externalRequests });
});
