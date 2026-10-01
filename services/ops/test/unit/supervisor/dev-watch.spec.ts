import { createFakeClock } from '@fathom/testkit/clock';
import { describe, expect, it } from 'vitest';
import type { DevWatchFactory } from '../../../src/supervisor/dev-watch.js';
import { DEV_DEBOUNCE_MS, mapChanges } from '../../../src/supervisor/dev-watch.js';
import { startViteProbe } from '../../../src/supervisor/vite.js';
import type { Harness } from './fakes.js';
import { createFakeTimers, createHarness, flush } from './fakes.js';

type Watcher = { roots: readonly string[]; emit(p: string): void; closed: number };
function watcherFactory(): { factory: DevWatchFactory; watchers: Watcher[] } {
  const watchers: Watcher[] = [];
  return {
    watchers,
    factory: (roots, onEvent) => {
      const w: Watcher = { roots, emit: onEvent, closed: 0 };
      watchers.push(w);
      return {
        close: (): void => {
          w.closed += 1;
        },
      };
    },
  };
}

async function devHarness(): Promise<{ h: Harness; w: Watcher }> {
  const { factory, watchers } = watcherFactory();
  const h = createHarness({ profile: 'dev', watch: factory, probeTcp: () => Promise.resolve(true) });
  await h.up();
  await flush();
  const w = watchers[0];
  if (w === undefined) {
    throw new Error('watcher not created');
  }
  return { h, w };
}

describe('dev 감시 · Vite (AP-12·CR-07)', () => {
  it('UT-SUP-060 300ms debounce로 여러 이벤트를 1회로 처리 [AP-12][CR-07]', async () => {
    const { h, w } = await devHarness();
    expect(DEV_DEBOUNCE_MS).toBe(300);
    const before = h.spawn.of('content').length;
    w.emit('/app/services/content/src/a.ts');
    w.emit('/app/services/content/src/b.ts');
    w.emit('/app/services/content/src/a.ts');
    await h.timers.advance(299);
    expect(h.spawn.last('content').sentOfType('shutdown')).toHaveLength(0);
    await h.timers.advance(1);
    expect(h.spawn.last('content').sentOfType('shutdown')).toHaveLength(1);
    h.spawn.last('content').exit(0);
    await flush();
    expect(h.spawn.of('content')).toHaveLength(before + 1);
    await h.timers.advance(1000);
    expect(h.spawn.of('content')).toHaveLength(before + 1); // 1회만
  });

  it('UT-SUP-061 경로 → 서비스 매핑(ops → ops-api) [AP-12][CR-07]', () => {
    expect(mapChanges('/app', ['/app/services/ops/src/http/x.ts']).services).toEqual(['ops-api']);
    expect(mapChanges('/app', ['/app/services/learning/src/a.ts', '/app/services/gateway/src/b.ts']).services).toEqual([
      'gateway',
      'learning',
    ]);
    expect(mapChanges('/app', ['/app/apps/web/src/x.ts', '/app/README.md'])).toEqual({
      services: [],
      supervisorChanged: false,
    });
  });

  it('UT-SUP-062 packages/** 변경 → 서비스 5개 전부 재기동 [AP-12][CR-07]', async () => {
    const { h, w } = await devHarness();
    w.emit('/app/packages/contracts/src/admin/ipc.ts');
    await h.timers.advance(300);
    for (const svc of ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const) {
      expect(h.spawn.last(svc).sentOfType('shutdown')).toHaveLength(1);
    }
    expect(mapChanges('/app', ['/app/packages/shared-kernel/src/a.ts']).services).toHaveLength(5);
  });

  it('UT-SUP-063 services/<dir>/src/supervisor/** 변경 → warn만(재기동 0) [AP-12][CR-07]', async () => {
    const { h, w } = await devHarness();
    w.emit('/app/services/ops/src/supervisor/supervisor.ts');
    await h.timers.advance(300);
    expect(h.events('supervisor.code.changed')).toHaveLength(1);
    expect(h.events('supervisor.code.changed')[0]).toMatchObject({ level: 'warn' });
    for (const child of h.spawn.children) {
      expect(child.sentOfType('shutdown')).toHaveLength(0);
    }
  });

  it('UT-SUP-064 dev 재기동은 크래시 이력에 포함되지 않는다(restarts 불변) [AP-12][CR-07]', async () => {
    const { h, w } = await devHarness();
    for (let i = 0; i < 5; i++) {
      w.emit('/app/services/content/src/a.ts');
      await h.timers.advance(300);
      h.spawn.last('content').exit(0);
      await flush();
      h.spawn.last('content').ready();
    }
    expect(h.spawn.of('content')).toHaveLength(6);
    expect(h.files.last().services.content).toMatchObject({ state: 'ready', restarts: 0 });
    expect(h.sup.statusRows().find((s) => s.svc === 'content')?.restarts_60s).toBe(0);
  });

  it('UT-SUP-065 종료 시 watcher close·대기 중 debounce 취소 [AP-12][CR-07]', async () => {
    const { h, w } = await devHarness();
    expect(w.roots.some((r) => r.endsWith('/packages/shared-kernel/src'))).toBe(true);
    expect(w.roots).toHaveLength(7);
    w.emit('/app/services/content/src/a.ts');
    void h.sup.shutdownAll(0);
    await flush();
    expect(w.closed).toBe(1);
    await h.timers.advance(300);
    // 취소된 debounce가 content를 재기동했다면 지금 shutdown을 받았을 것이다(종료 순서상 content는 gateway 종료 뒤).
    expect(h.spawn.last('content').sentOfType('shutdown')).toHaveLength(0);
    expect(h.spawn.of('content')).toHaveLength(1);
  });

  it('UT-SUP-066 vite: spawn 사양(--strictPort·cwd)·TCP 탐침으로 ready·prod/test 미기동 [AP-12][CR-07]', async () => {
    let up = false;
    const probes: number[] = [];
    const h = createHarness({
      profile: 'dev',
      watch: () => ({ close: () => undefined }),
      probeTcp: (port) => {
        probes.push(port);
        return Promise.resolve(up);
      },
    });
    await h.start();
    const vite = h.spawn.last('vite');
    expect(vite.spec).toMatchObject({
      kind: 'spawn',
      entry: '/app/apps/web/node_modules/vite/bin/vite.js',
      args: ['--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      cwd: '/app/apps/web',
    });
    expect(vite.sent).toEqual([]); // 봉투·IPC 없음
    await flush();
    expect(h.files.last().services.vite?.state).toBe('starting');
    await h.timers.advance(200);
    up = true;
    await h.timers.advance(200);
    expect(h.files.last().services.vite?.state).toBe('ready');
    expect(probes.every((p) => p === 5173)).toBe(true);
    for (const profile of ['prod', 'test'] as const) {
      const other = createHarness({ profile });
      await other.start();
      expect(other.spawn.of('vite')).toHaveLength(0);
    }
  });

  it('UT-SUP-067 vite: 15s 안에 포트가 열리지 않으면 크래시 처리 [AP-12][NFR-AVL-003]', async () => {
    const clock = createFakeClock();
    const timers = createFakeTimers(clock);
    let ready = 0;
    let timedOut = 0;
    startViteProbe({
      port: 5173,
      clock,
      timers,
      probe: () => Promise.resolve(false),
      onReady: () => {
        ready += 1;
      },
      onTimeout: () => {
        timedOut += 1;
      },
    });
    await timers.advance(14_000);
    expect(timedOut).toBe(0);
    await timers.advance(1200);
    expect(timedOut).toBe(1);
    expect(ready).toBe(0);
  });
});
