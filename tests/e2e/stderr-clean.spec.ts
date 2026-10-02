import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequestCounter } from '@fathom/testkit/playwright/stack-fixture';
import type { Stack, StopReport } from '@fathom/testkit/spawn-stack';
import { launchStack, realStackDeps, scanLogs, WARNING_RE } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { expect, test } from '@playwright/test';
import { isAlive, openApp, writeEgressReport } from '../support/direct-stack.js';

// E2E-104 (C-09) — 첫 기동부터 종료까지 stderr·로그에 경고·비 JSON 줄이 없다.

test.describe.configure({ mode: 'serial' });

const state: { stack: Stack | null; cleanup: (() => Promise<void>) | null; pids: number[] } = {
  stack: null,
  cleanup: null,
  pids: [],
};

test.beforeAll(async () => {
  const home = await createTempHome('fathom-e2e104-');
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

test('E2E-104 마이그레이션·기동·종료의 stderr와 서비스 로그에 경고·비 JSON 줄이 없다 @offline [NFR-PORT-002]', async ({
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
  await test.step('앱 열기와 서비스 healthz', async () => {
    await openApp(page, stack);
    const registry = await stack.registry();
    for (const svc of ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const) {
      const port = await stack.portOf(svc);
      const res = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
      expect(res.status, `${svc} healthz`).toBe(200);
    }
    expect(registry.state).toBe('ready');
  });

  let report: StopReport | null = null;
  await test.step('정지', async () => {
    report = await stack.stop();
  });
  if (report === null) {
    throw new Error('stop report missing');
  }
  const stopped: StopReport = report;

  await test.step('① 마이그레이션 stderr 비어 있음', () => {
    expect(stack.migrations.map((m) => m.svc)).toHaveLength(4);
    for (const m of stack.migrations) {
      expect(m.result.stderrTail.trim(), `${m.svc} migrate stderr`).toBe('');
    }
  });
  await test.step('② up·down stderr에 경고 없음', () => {
    expect(stack.upResult.stderrTail).not.toMatch(WARNING_RE);
    expect(stopped.down.stderrTail).not.toMatch(WARNING_RE);
    expect(stopped.downExitCode).toBe(0);
  });
  await test.step('③ 로그 전부 JSON·원문 줄 0·경고 0', () => {
    expect(stopped.logs.files).toBeGreaterThanOrEqual(6);
    expect(stopped.logs.invalidJson).toBe(0);
    expect(stopped.logs.rawRecords).toEqual([]);
    expect(stopped.logs.warningLines).toEqual([]);
  });
  await test.step('④ 대조군: 같은 스캐너가 경고 줄을 찾아낸다', async () => {
    const control = await createTempHome('fathom-e2e104-control-');
    try {
      mkdirSync(path.join(control.path, 'logs', 'content'), { recursive: true });
      writeFileSync(
        path.join(control.path, 'logs', 'content', 'planted.jsonl'),
        `${JSON.stringify({ level: 'info', msg: 'ok' })}\n(node:1) ExperimentalWarning: SQLite is an experimental feature\n`,
      );
      const scan = await scanLogs(control.path, realStackDeps());
      expect(scan.warningLines).toHaveLength(1);
      expect(scan.invalidJson).toBe(1);
    } finally {
      await control.cleanup();
    }
  });
  writeEgressReport('stderr-clean', { l1: stopped.egress.records.length, l3: counter.count });
});
