import { describe, expect, it } from 'vitest';
import type { Harness } from './fakes.js';
import { createHarness, flush } from './fakes.js';

const ORDER = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const;

/** shutdown을 받은 자식은 `exit(0)`로 응답한다. 도착 순서를 기록한다. */
function autoExit(h: Harness, order: string[], hang: string[] = []): void {
  for (const svc of ORDER) {
    const child = h.spawn.last(svc);
    const original = child.send.bind(child);
    child.send = (msg: unknown): boolean => {
      const ok = original(msg);
      if (typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'shutdown') {
        order.push(svc);
        if (!hang.includes(svc)) {
          queueMicrotask(() => child.exit(0));
        }
      }
      return ok;
    };
  }
}

describe('종료 순서 (ADR-012 §8)', () => {
  it('UT-SUP-048 종료 순서 gateway(+vite) → content·learning·ai-gateway → ops-api, 응답 없는 자식은 grace+2000ms 뒤 treeKill [NFR-AVL-003]', async () => {
    const h = createHarness({
      profile: 'dev',
      watch: () => ({ close: () => undefined }),
      probeTcp: () => Promise.resolve(true),
    });
    await h.up();
    await flush();
    const order: string[] = [];
    autoExit(h, order, ['learning']);
    const vite = h.spawn.last('vite');
    const done = h.sup.shutdownAll(3000);
    await flush();
    expect(order).toEqual(['gateway']); // 두 번째 단계는 gateway 종료 뒤
    expect(vite.killed).toBe(1); // vite는 treeKill만
    vite.exit(null, 'SIGKILL');
    await flush();
    expect(order.slice(1).sort()).toEqual(['ai-gateway', 'content', 'learning']);
    expect(h.spawn.last('ops-api').sentOfType('shutdown')).toHaveLength(0);
    const hung = h.spawn.last('learning');
    await h.timers.advance(4999);
    expect(hung.killed).toBe(0);
    expect(order).not.toContain('ops-api');
    await h.timers.advance(1);
    expect(hung.killed).toBe(1);
    expect(order.at(-1)).toBe('ops-api');
    await done;
    for (const sent of h.spawn.children.flatMap((c) => c.sentOfType('shutdown'))) {
      expect(sent).toEqual({ type: 'shutdown', v: 1, grace_ms: 3000 });
    }
  });

  it('UT-SUP-049 shutdownAll 2회 = 같은 Promise, 끝에 registry stopped·lock·cli.token 삭제·싱크 close·done = 0 [NFR-AVL-003]', async () => {
    const h = createHarness();
    await h.up();
    autoExit(h, []);
    const a = h.sup.shutdownAll(3000);
    const b = h.sup.shutdownAll(500);
    expect(b).toBe(a);
    await a;
    expect(await h.sup.done).toBe(0);
    const last = h.files.last();
    expect(last.state).toBe('stopped');
    expect(Object.values(last.services).every((s) => s?.state === 'stopped' && s.pid === null)).toBe(true);
    expect(h.files.removed).toBe(true);
    expect(h.sink.closed).toBe(true);
    expect(h.sup.statusRows()[0]).toMatchObject({ svc: 'supervisor', state: 'stopped' });
    expect(h.files.registries.some((r) => r.state === 'stopping')).toBe(true);
    // 종료 중에는 fork하지 않는다
    expect(h.spawn.children.filter((c) => c.spec.svc === 'content')).toHaveLength(1);
  });
});
