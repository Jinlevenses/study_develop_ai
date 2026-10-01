import { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { describe, expect, it } from 'vitest';
import { RegistryFile } from '../../../src/supervisor/runtime-files.js';
import { createHarness, flush, HASH } from './fakes.js';

const SERVICES = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const;

describe('기동 순서 · 봉투 · 상태 전이 (가짜 SpawnChild)', () => {
  it('UT-SUP-020 4개 병렬 fork, Safe Mode면 ai-gateway 제외·safe_mode=true·batch_enabled=false [FR-SET-001][NFR-AVL-009]', async () => {
    const h = createHarness();
    await h.start();
    expect(h.spawn.children.map((c) => c.spec.svc).sort()).toEqual(['ai-gateway', 'content', 'learning', 'ops-api']);
    expect(h.spawn.children.every((c) => c.spec.args[0] === '--mode=serve' && c.spec.kind === 'fork')).toBe(true);
    const safe = createHarness({ safeMode: true });
    await safe.start();
    expect(safe.spawn.of('ai-gateway')).toHaveLength(0);
    const env = BootstrapEnvelope.parse(safe.spawn.last('content').sent[0]);
    expect(env.flags).toMatchObject({ safe_mode: true, batch_enabled: false });
    expect(safe.files.last().services['ai-gateway']).toMatchObject({
      state: 'stopped',
      reason: 'safe_mode',
      pid: null,
    });
  });

  it('UT-SUP-021 gateway는 content·learning이 둘 다 ready인 뒤에만 fork [FR-SET-001][NFR-PERF-008]', async () => {
    const h = createHarness();
    await h.start();
    h.spawn.last('ops-api').ready();
    h.spawn.last('ai-gateway').ready();
    h.spawn.last('content').ready();
    await flush();
    expect(h.spawn.of('gateway')).toHaveLength(0);
    h.spawn.last('learning').ready();
    await flush();
    expect(h.spawn.of('gateway')).toHaveLength(1);
  });

  it('UT-SUP-022 봉투: BootstrapEnvelope 통과·web_root는 gateway만·boot_id는 fork마다 다름·peers 5키·listen 127.0.0.1 [FR-SET-001]', async () => {
    const h = createHarness({ profile: 'prod' });
    await h.up();
    const ids = new Set<string>();
    for (const svc of SERVICES) {
      const env = BootstrapEnvelope.parse(h.spawn.last(svc).sent[0]);
      expect(env.svc).toBe(svc);
      expect(env.web_root).toBe(svc === 'gateway' ? '/app/apps/web/dist' : null);
      expect(Object.keys(env.peers).sort()).toEqual([...SERVICES].sort());
      expect(env.listen).toEqual({
        host: '127.0.0.1',
        port: { gateway: 4747, 'ops-api': 4761, content: 4762, learning: 4763, 'ai-gateway': 4764 }[svc],
      });
      expect(env).toMatchObject({
        app_version: '1.2.3',
        contracts_hash: HASH,
        profile: 'prod',
        home: '/home/fathom',
        log_level: 'info',
      });
      ids.add(env.boot_id);
    }
    expect(ids.size).toBe(5);
    const dev = createHarness({
      profile: 'dev',
      watch: () => ({ close: () => undefined }),
      probeTcp: () => Promise.resolve(false),
    });
    await dev.up();
    expect(BootstrapEnvelope.parse(dev.spawn.last('gateway').sent[0]).web_root).toBeNull();
  });

  it('UT-SUP-023 listening → registry 기록 + registry.updated 방송(실제 URL) [FR-SET-001]', async () => {
    const h = createHarness();
    await h.start();
    h.spawn.last('content').listening(45123);
    await flush();
    expect(h.files.last().services.content?.port).toBe(45123);
    for (const svc of ['ops-api', 'content', 'learning', 'ai-gateway'] as const) {
      const updates = h.spawn.last(svc).sentOfType('registry.updated');
      expect(updates).toHaveLength(1);
      expect(JSON.stringify(updates[0])).toContain('http://127.0.0.1:45123');
    }
  });

  it('UT-SUP-024 ready 30s 초과 → treeKill + 크래시 처리(재시작) [FR-SET-001][NFR-PERF-008]', async () => {
    const h = createHarness();
    await h.start();
    const stuck = h.spawn.last('learning');
    await h.timers.advance(29_999);
    expect(stuck.killed).toBe(0);
    await h.timers.advance(1);
    expect(stuck.killed).toBe(1);
    expect(h.files.last().services.learning).toMatchObject({ state: 'restarting', restarts: 1 });
    await h.timers.advance(250);
    expect(h.spawn.of('learning')).toHaveLength(2);
  });

  it('UT-SUP-025 전체 상태 전이 starting → ready → degraded [FR-SET-001]', async () => {
    const h = createHarness();
    await h.start();
    expect(h.files.last().state).toBe('starting');
    h.spawn.last('ops-api').ready();
    h.spawn.last('ai-gateway').ready();
    h.spawn.last('content').ready();
    h.spawn.last('learning').ready();
    await flush();
    expect(h.files.last().state).toBe('starting'); // gateway 아직
    h.spawn.last('gateway').ready();
    await flush();
    expect(h.files.last().state).toBe('ready');
    h.spawn.last('ai-gateway').exit(78);
    await flush();
    expect(h.files.last().state).toBe('degraded');
  });

  it('UT-SUP-026 ops-api가 degraded여도 gateway는 기동한다 [FR-SET-001]', async () => {
    const h = createHarness();
    await h.start();
    h.spawn.last('ops-api').exit(78);
    h.spawn.last('content').ready();
    h.spawn.last('learning').ready();
    await flush();
    expect(h.files.last().services['ops-api']?.state).toBe('degraded');
    expect(h.spawn.of('gateway')).toHaveLength(1);
  });

  it('UT-SUP-027 content가 나중에 ready가 되면(svc.start) 그때 gateway를 fork [FR-SET-001]', async () => {
    const h = createHarness();
    await h.start();
    h.spawn.last('content').exit(78);
    h.spawn.last('learning').ready();
    h.spawn.last('ops-api').ready();
    await flush();
    expect(h.spawn.of('gateway')).toHaveLength(0);
    h.spawn.last('ops-api').message({ type: 'svc.start', v: 1, svc: 'content' });
    await flush();
    h.spawn.last('content').ready();
    await flush();
    expect(h.spawn.of('gateway')).toHaveLength(1);
  });

  it('UT-SUP-028 registry = RegistryFile 통과·토큰 필드/값 0 [FR-SET-001][DR-021]', async () => {
    const h = createHarness();
    await h.up();
    const last = h.files.last();
    expect(RegistryFile.safeParse(last).success).toBe(true);
    expect(last).toMatchObject({ v: 1, boot_id: h.opts.bootId, profile: 'test', app_version: '1.2.3', state: 'ready' });
    const text = JSON.stringify(h.files.registries);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
    expect(text).not.toMatch(/token/i);
  });

  it('UT-SUP-038 상태 변경마다 registry를 기록한다(연속 변경 합치기는 runtime-files 단위에서 검증) [FR-SET-001][DR-021]', async () => {
    const h = createHarness();
    await h.start();
    const n = h.files.registries.length;
    h.spawn.last('content').listening(45000);
    h.spawn.last('content').ready();
    await flush();
    expect(h.files.registries.length).toBeGreaterThan(n);
    expect(h.files.registries.every((r) => RegistryFile.safeParse(r).success)).toBe(true);
  });
});
