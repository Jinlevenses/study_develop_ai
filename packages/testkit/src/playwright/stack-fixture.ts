import { ulid } from '@fathom/shared-kernel/ids/ids';
import type {
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test';
import { test as base } from '@playwright/test';

// TST-01 §3.4·§8.3 L3 — 주입형 스택 fixture. spawn-stack(T-00-16)에 의존하지 않고, 호출자가 `StackLauncher`를 넘긴다.

export interface StackHandle {
  gatewayUrl: string;
  cliToken: string;
  home: string;
  stop(): Promise<void>;
}
export type StackLauncher = () => Promise<StackHandle>;

export interface RequestCounter {
  /** 외부(비 loopback http·ws) 요청이면 기록하고 true. */
  record(url: string): boolean;
  readonly count: number;
  readonly urls: readonly string[];
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);
const NETWORK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** 브라우저 L3 기준: 호스트가 `127.0.0.1`·`localhost`·`[::1]`이면 true, 그 밖(파싱 불가 포함)은 false. */
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 외부 요청 계수기. `data:`·`blob:` 같은 비 네트워크 스킴과 loopback은 세지 않는다. */
export function createRequestCounter(): RequestCounter {
  const seen: string[] = [];
  return {
    record(url: string): boolean {
      let protocol: string;
      try {
        protocol = new URL(url).protocol;
      } catch {
        return false;
      }
      if (!NETWORK_PROTOCOLS.has(protocol) || isLoopbackUrl(url)) {
        return false;
      }
      seen.push(url);
      return true;
    },
    get count(): number {
      return seen.length;
    },
    get urls(): readonly string[] {
      return [...seen];
    },
  };
}

/**
 * IF-GW-001 부트스트랩 토큰 요청(HTTP로만 사용 — gateway 스키마를 import하지 않는다).
 * IF-01 §2 헤더 표: 상태 변경(멱등 ✓) 라우트는 ULID `idempotency-key`가 필수이므로 요청마다 새 키를 싣는다(`newKey`는 테스트 주입용).
 */
export function bootstrapRequest(h: StackHandle, newKey: () => string = ulid): { url: string; init: RequestInit } {
  return {
    url: new URL('/api/v1/cli/bootstrap-token', h.gatewayUrl).href,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${h.cliToken}`,
        'content-type': 'application/json',
        'idempotency-key': newKey(),
      },
      body: JSON.stringify({ purpose: 'open' }),
    },
  };
}

type StackHost = { current(file: string): Promise<StackHandle> };
export type StackFixtures = {
  stack: StackHandle;
  openApp: (page: Page) => Promise<void>;
  externalRequests: RequestCounter;
};
type StackWorkerFixtures = { stackHost: StackHost };
export type StackTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & StackFixtures,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions & StackWorkerFixtures
>;

/**
 * Playwright `test` 확장: 파일당 스택 1개(워커 안에서 파일이 바뀌면 이전 스택을 멈추고 새로 띄운다), `openApp`, `externalRequests`.
 */
export function createStackTest(launch: StackLauncher): StackTest {
  return base.extend<StackFixtures, StackWorkerFixtures>({
    stackHost: [
      async ({}, use): Promise<void> => {
        const state: { file: string | null; handle: StackHandle | null } = { file: null, handle: null };
        await use({
          async current(requested: string): Promise<StackHandle> {
            if (state.handle !== null && state.file === requested) {
              return state.handle;
            }
            const previous = state.handle;
            state.handle = null;
            await previous?.stop();
            const started = await launch();
            state.handle = started;
            state.file = requested;
            return started;
          },
        });
        await state.handle?.stop();
      },
      { scope: 'worker' },
    ],
    stack: async ({ stackHost }, use, testInfo): Promise<void> => {
      await use(await stackHost.current(testInfo.file));
    },
    openApp: async ({ stack }, use): Promise<void> => {
      await use(async (page: Page): Promise<void> => {
        const { url, init } = bootstrapRequest(stack);
        const response = await fetch(url, init);
        if (!response.ok) {
          throw new Error(`bootstrap-token request failed: ${response.status}`);
        }
        const body: unknown = await response.json();
        const openUrl = typeof body === 'object' && body !== null && 'open_url' in body ? body.open_url : undefined;
        if (typeof openUrl !== 'string') {
          throw new Error('bootstrap-token response has no open_url');
        }
        await page.goto(openUrl);
      });
    },
    externalRequests: async ({ page }, use): Promise<void> => {
      const counter = createRequestCounter();
      page.on('request', (request) => {
        counter.record(request.url());
      });
      await use(counter);
    },
  });
}
