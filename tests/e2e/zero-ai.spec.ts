import path from 'node:path';
import { readRows } from '@fathom/testkit/chaos';
import { startEgressSampler } from '@fathom/testkit/egress-sampler';
import { createRequestCounter } from '@fathom/testkit/playwright/stack-fixture';
import type { Stack } from '@fathom/testkit/spawn-stack';
import { launchStack } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { expect, test } from '@playwright/test';
import { isAlive, openApp, writeEgressReport } from '../support/direct-stack.js';

// E2E-100 (C-13, NFR-AVL-001) — 새 HOME 첫 기동(AI OFFLINE)에서 외부 접속이 L1~L4 모두 0이고, L3 양성 탐침이 1건으로 잡힌다.
// E2E-101(WP-01-19)은 이 파일에 추가한다.

test.describe.configure({ mode: 'serial' });

const state: { stack: Stack | null; cleanup: (() => Promise<void>) | null; pids: number[] } = {
  stack: null,
  cleanup: null,
  pids: [],
};

test.beforeAll(async () => {
  const home = await createTempHome('fathom-e2e100-');
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

test('E2E-100 신규 HOME 첫 기동에서 외부 접속이 L1~L4 모두 0이고 L3 양성 탐침은 1건으로 잡힌다 @offline [NFR-AVL-001][QAS-12]', async ({
  page,
  context,
}) => {
  const stack = state.stack;
  if (stack === null) {
    throw new Error('stack not started');
  }
  const counter = createRequestCounter();
  context.on('request', (r) => {
    counter.record(r.url());
  });
  const sampler = process.platform === 'linux' ? startEgressSampler({ rootPid: stack.supervisorPid }) : null;

  await test.step('앱 열기 후 L3 = 0', async () => {
    await openApp(page, stack);
    expect(counter.count, counter.urls.join(', ')).toBe(0);
  });

  await test.step('L3: 앱 페이지의 외부 fetch는 CSP(connect-src self)가 요청 전에 막는다', async () => {
    const outcome = await page.evaluate(() =>
      fetch('https://example.com/').then(
        () => 'ok',
        () => 'blocked',
      ),
    );
    expect(outcome).toBe('blocked');
    expect(counter.count, 'CSP가 막았으므로 요청 이벤트 0').toBe(0);
  });

  await test.step('L3 양성 탐침: 테스트 페이지(about:blank)의 외부 fetch는 정확히 1건 계수된다(host-resolver-rules로 실제 패킷 0)', async () => {
    const probe = await context.newPage();
    try {
      const outcome = await probe.evaluate(() =>
        fetch('https://example.com/').then(
          () => 'ok',
          () => 'blocked',
        ),
      );
      expect(outcome).toBe('blocked');
    } finally {
      await probe.close();
    }
    expect(counter.count).toBe(1);
    expect(counter.urls).toEqual(['https://example.com/']);
  });

  let l2Remotes = 0;
  await test.step('L2 소켓 표본: 비 loopback 원격 0', async () => {
    if (sampler !== null) {
      const l2 = await sampler.stop();
      l2Remotes = l2.remotes.length;
      expect(l2.samples).toBeGreaterThanOrEqual(1);
      expect(l2.remotes).toEqual([]);
    }
  });

  await test.step('L4 AI 호출·방화벽 로그 0건', async () => {
    const aiDb = path.join(stack.home, 'data', 'ai.db');
    expect(await readRows(aiDb, 'SELECT count(*) AS n FROM ai_call_log')).toEqual([{ n: 0 }]);
    expect(await readRows(aiDb, 'SELECT count(*) AS n FROM ai_firewall_log')).toEqual([{ n: 0 }]);
  });

  const report = await stack.stop();
  expect(report.egress.records, 'L1 egress records').toEqual([]);
  writeEgressReport('zero-ai', { l1: report.egress.records.length, l2_remotes: l2Remotes, l3: 0, l4: 0 });
});
