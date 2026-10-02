import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readRows } from '@fathom/testkit/chaos';
import { createRequestCounter } from '@fathom/testkit/playwright/stack-fixture';
import type { Stack } from '@fathom/testkit/spawn-stack';
import { APP_ROOT, allReady, launchStack } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { expect, test } from '@playwright/test';
import { isAlive, openApp, writeEgressReport } from '../support/direct-stack.js';

// E2E-107 (E0-1·E0-2) — 신규 HOME 첫 기동: 6개 상주 프로세스·콜드 ≤ 10s·OFFLINE 시작·셸 렌더.
// A = 설치 번들(dist) 경로(`fathom up`), B = 개발 경로(src, `pnpm dev`·`pnpm fathom`과 같은 CLI 원천 진입).

type Launched = { stack: Stack; cleanup: () => Promise<void>; pids: number[] };

test.describe.configure({ mode: 'serial' });

const launched: Launched[] = [];

async function startStack(runtime: 'dist' | 'src'): Promise<Launched> {
  const home = await createTempHome('fathom-e2e107-');
  const stack = await launchStack({ runtime, home: home.path });
  const entry: Launched = { stack, cleanup: () => home.cleanup(), pids: [] };
  launched.push(entry);
  const registry = await stack.registry();
  entry.pids = [
    stack.supervisorPid,
    ...Object.values(registry.services).flatMap((s) => (s?.pid === null || s === undefined ? [] : [s.pid])),
  ];
  return entry;
}

function supervisorCmdline(pid: number): string {
  return readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8')
    .split('\0')
    .join(' ');
}

test.afterAll(async () => {
  for (const entry of launched) {
    await entry.stack.stop();
    for (const pid of entry.pids) {
      expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
    }
    await entry.cleanup();
  }
});

test('E2E-107 신규 HOME 첫 기동이 6개 프로세스·콜드 10초 이내·OFFLINE·셸 렌더로 끝난다 @offline [NFR-PERF-008][FR-SET-001][FR-AI-003][NFR-SEC-019]', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const counter = createRequestCounter();
  context.on('request', (r) => {
    counter.record(r.url());
  });
  let l1 = 0;

  await test.step('A: dist(fathom up 경로) 콜드 기동', async () => {
    const { stack, pids } = await startStack('dist');
    expect(stack.bootMs, `cold boot ${String(Math.round(stack.bootMs))}ms`).toBeLessThanOrEqual(10_000);
    test.info().annotations.push({ type: 'dist-boot-ms', description: String(Math.round(stack.bootMs)) });
    const registry = await stack.registry();
    expect(allReady(registry)).toBe(true);
    expect(pids).toHaveLength(6);
    expect(new Set(pids).size).toBe(6);
    for (const pid of pids) {
      expect(isAlive(pid), `pid ${String(pid)} alive`).toBe(true);
    }
    expect(Object.values(registry.services).filter((s) => s?.state === 'degraded')).toEqual([]);
    expect(registry.notices.filter((n) => n.includes('contracts_hash_mismatch'))).toEqual([]);
    const supervisorDir = path.join(stack.home, 'logs', 'supervisor');
    const supervisorLog = readdirSync(supervisorDir)
      .map((f) => readFileSync(path.join(supervisorDir, f), 'utf8'))
      .join('\n');
    expect(supervisorLog).not.toContain('supervisor.handshake.rejected');
    if (process.platform === 'linux') {
      expect(supervisorCmdline(stack.supervisorPid)).toContain('services/ops/dist/supervisor/main.js');
    }

    // E0-2: 첫 기동 AI 모드 = OFFLINE
    const rows = await readRows(
      path.join(stack.home, 'data', 'ai.db'),
      'SELECT mode, reasons_json FROM ai_mode_state WHERE id = 1',
    );
    expect(rows).toEqual([{ mode: 'OFFLINE', reasons_json: '["first_boot"]' }]);

    await openApp(page, stack);
    const cookie = (await context.cookies()).find((c) => c.name === 'fathom_sid');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(counter.count, counter.urls.join(', ')).toBe(0);

    const report = await stack.stop();
    l1 = report.egress.records.length;
    expect(l1).toBe(0);
  });

  await test.step('B: src(pnpm dev·pnpm fathom 경로) 기동', async () => {
    const root: unknown = JSON.parse(readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
    const scripts: Record<string, unknown> =
      typeof root === 'object' && root !== null && 'scripts' in root && typeof root.scripts === 'object'
        ? { ...root.scripts }
        : {};
    expect(String(scripts.dev)).toContain('apps/cli/src/main.ts');
    expect(String(scripts.dev)).toContain('up --profile=dev');
    expect(String(scripts.fathom)).toContain('apps/cli/src/main.ts');
    const { stack } = await startStack('src');
    test.info().annotations.push({ type: 'src-boot-ms', description: String(Math.round(stack.bootMs)) });
    expect(allReady(await stack.registry())).toBe(true);
    if (process.platform === 'linux') {
      expect(supervisorCmdline(stack.supervisorPid)).toContain('services/ops/src/supervisor/main.ts');
    }
    await stack.stop();
  });

  writeEgressReport('boot-shell', { l1, l3: counter.count });
});
