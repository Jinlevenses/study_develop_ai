import { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import { describe, expect, it } from 'vitest';
import { decideOnExit } from '../../../src/supervisor/restart-policy.js';
import type { Harness } from './fakes.js';
import { createHarness, flush } from './fakes.js';

function contentRow(h: Harness): { state: string; reason: string | null; restarts: number } {
  const row = h.files.last().services.content;
  if (row === undefined) {
    throw new Error('no content row');
  }
  return row;
}

async function crashAndRestart(h: Harness, code: number | null, delay: number): Promise<void> {
  const before = h.spawn.of('content').length;
  h.spawn.last('content').exit(code);
  await flush();
  expect(contentRow(h).state).toBe('restarting');
  if (delay > 0) {
    await h.timers.advance(delay - 1);
    expect(h.spawn.of('content')).toHaveLength(before);
  }
  await h.timers.advance(delay === 0 ? 0 : 1);
  expect(h.spawn.of('content')).toHaveLength(before + 1);
  h.spawn.last('content').ready();
}

describe('재시작 정책 (가짜 SpawnChild·Timers·FakeClock)', () => {
  it('UT-SUP-001 크래시 지연 250 → 1000 → 2000ms, 60s 안 4번째 크래시 → degraded(crash_loop)·추가 fork 0 [NFR-AVL-003][FR-SET-002]', async () => {
    const h = createHarness();
    await h.up();
    await crashAndRestart(h, 1, 250);
    await crashAndRestart(h, 1, 1000);
    await crashAndRestart(h, 1, 2000);
    const forks = h.spawn.of('content').length;
    h.spawn.last('content').exit(1);
    await flush();
    expect(contentRow(h)).toMatchObject({ state: 'degraded', reason: 'crash_loop' });
    await h.timers.advance(60_000);
    expect(h.spawn.of('content')).toHaveLength(forks);
    expect(h.files.last().state).toBe('degraded');
  });

  it('UT-SUP-037 (창 밖; UT-SUP-001 변형) 61s 뒤 크래시는 다시 250ms [NFR-AVL-003]', async () => {
    const h = createHarness();
    await h.up();
    await crashAndRestart(h, 1, 250);
    await crashAndRestart(h, 1, 1000);
    await crashAndRestart(h, 1, 2000);
    await h.timers.advance(61_000);
    await crashAndRestart(h, 1, 250);
    expect(contentRow(h).restarts).toBe(4);
  });

  it("UT-SUP-002 fatal{78,'schema_needs_migrate'} 후 exit 78 → 재시작 0·degraded·reason = exit_78:schema_needs_migrate [FR-SET-002]", async () => {
    const h = createHarness();
    await h.up();
    const content = h.spawn.last('content');
    content.message({ type: 'fatal', v: 1, exit_code: 78, code: 'schema_needs_migrate' });
    content.exit(78);
    await flush();
    await h.timers.advance(30_000);
    expect(h.spawn.of('content')).toHaveLength(1);
    expect(contentRow(h)).toMatchObject({ state: 'degraded', reason: 'exit_78:schema_needs_migrate' });
  });

  it('UT-SUP-030 exit 75 → 즉시(지연 0) 재시작 [NFR-AVL-003]', async () => {
    const h = createHarness();
    await h.up();
    h.spawn.last('content').exit(75);
    await flush();
    expect(h.spawn.of('content')).toHaveLength(1);
    await h.timers.advance(0);
    expect(h.spawn.of('content')).toHaveLength(2);
  });

  it('UT-SUP-031 창 밖 크래시는 제외된다(순수 정책) [NFR-AVL-003]', () => {
    const base = { code: 1, signal: null, requested: false, fatalCode: null };
    const old = decideOnExit({ ...base, crashTimes: [0, 500, 1000], now: 61_001 });
    expect(old.decision).toEqual({ kind: 'restart', delayMs: 250 });
    expect(old.crashTimes).toEqual([61_001]);
    const inside = decideOnExit({ ...base, crashTimes: [10_000, 20_000, 30_000], now: 40_000 });
    expect(inside.decision).toEqual({ kind: 'degraded', reason: 'crash_loop' });
  });

  it('UT-SUP-032 신호 사망(code null) = 크래시로 재시작 [NFR-AVL-003]', async () => {
    const h = createHarness();
    await h.up();
    await crashAndRestart(h, null, 250);
    expect(contentRow(h).restarts).toBe(1);
  });

  it('UT-SUP-033 요청 정지(shutdown 송신 후 exit 0) → stopped(requested)·재시작 0·크래시 이력 불변 [NFR-AVL-003]', async () => {
    const h = createHarness();
    await h.up();
    const ops = h.spawn.last('ops-api');
    const id = ulid();
    ops.message({ type: 'svc.stop', v: 1, id, svc: 'content' });
    await flush();
    const content = h.spawn.last('content');
    expect(content.sentOfType('shutdown')).toHaveLength(1);
    content.exit(0);
    await flush();
    expect(contentRow(h)).toMatchObject({ state: 'stopped', reason: 'requested', restarts: 0 });
    await h.timers.advance(10_000);
    expect(h.spawn.of('content')).toHaveLength(1);
    expect(ops.sentOfType('svc.ack')[0]).toMatchObject({ re: id, ok: true });
  });

  it('UT-SUP-034 svc.start는 크래시 이력을 비운다(degraded → 시작 → 다시 250ms) [NFR-AVL-003]', async () => {
    const h = createHarness();
    await h.up();
    await crashAndRestart(h, 1, 250);
    await crashAndRestart(h, 1, 1000);
    await crashAndRestart(h, 1, 2000);
    h.spawn.last('content').exit(1);
    await flush();
    expect(contentRow(h).state).toBe('degraded');
    h.spawn.last('ops-api').message({ type: 'svc.start', v: 1, id: ulid(), svc: 'content' });
    await flush();
    expect(h.spawn.of('content')).toHaveLength(5);
    await crashAndRestart(h, 1, 250);
  });

  it('UT-SUP-035 재시작 봉투는 after_crash=true·직전 포트를 다시 쓴다 [NFR-AVL-003]', async () => {
    const h = createHarness();
    await h.up();
    const first = BootstrapEnvelope.parse(h.spawn.last('content').sent[0]);
    expect(first.flags.after_crash).toBe(false);
    const port = h.spawn.last('content').pid + 41000;
    await crashAndRestart(h, 1, 250);
    const second = BootstrapEnvelope.parse(h.spawn.last('content').sent[0]);
    expect(second.flags.after_crash).toBe(true);
    expect(second.listen.port).toBe(port);
    expect(second.boot_id).not.toBe(first.boot_id);
  });

  it('UT-SUP-036 직전 supervisor가 비정상 종료였다면 첫 fork 봉투는 전원 after_crash=true [FR-SET-001]', async () => {
    const h = createHarness({ previousCrashed: true });
    await h.up();
    for (const svc of ['ops-api', 'content', 'learning', 'ai-gateway', 'gateway'] as const) {
      expect(BootstrapEnvelope.parse(h.spawn.last(svc).sent[0]).flags.after_crash).toBe(true);
    }
    const clean = createHarness();
    await clean.up();
    expect(BootstrapEnvelope.parse(clean.spawn.last('gateway').sent[0]).flags.after_crash).toBe(false);
  });
});
