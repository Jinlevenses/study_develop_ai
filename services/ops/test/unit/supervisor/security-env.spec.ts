import { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { describe, expect, it } from 'vitest';
import { childEnv, mergeNodeOptions } from '../../../src/supervisor/child-env.js';
import { gatewayFallbacks, PREFERRED_PORTS } from '../../../src/supervisor/ports.js';
import { createCallerTokens } from '../../../src/supervisor/tokens.js';
import { createHarness, flush, HASH } from './fakes.js';

const FLAG = '--disable-warning=ExperimentalWarning';
const SERVICES = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'] as const;

describe('토큰 · 핸드셰이크 · 환경 · 포트', () => {
  it('UT-SUP-003 토큰 5개 = 64 hex·서로 다름, 로그·registry·자식 env·statusRows 직렬화에 토큰 0 [NFR-SEC-003]', async () => {
    const h = createHarness();
    await h.up();
    const envelopes = SERVICES.map((svc) => BootstrapEnvelope.parse(h.spawn.last(svc).sent[0]));
    const tokens = envelopes.map((e) => e.self_token);
    expect(new Set(tokens).size).toBe(5);
    for (const e of envelopes) {
      expect(e.self_token).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(e.callers).sort()).toEqual([...SERVICES].sort());
      expect(e.callers[e.svc]).toBe(e.self_token);
    }
    const leaked = JSON.stringify([
      h.logs,
      h.files.registries,
      h.spawn.children.map((c) => c.spec),
      h.sink.lines,
      h.sup.statusRows(),
    ]);
    for (const t of tokens) {
      expect(leaked).not.toContain(t);
    }
    expect(Object.keys(createCallerTokens((n) => new Uint8Array(n).fill(1))).sort()).toEqual([...SERVICES].sort());
  });

  it('UT-SUP-004 ready.contracts_hash ≠ 번들 → shutdown{0}·degraded(contracts_hash_mismatch)·재시작 0, learning 거부 시 gateway fork 0 [NFR-MAINT-006][FR-SET-001]', async () => {
    const h = createHarness();
    await h.start();
    h.spawn.last('content').ready();
    const learning = h.spawn.last('learning');
    learning.ready('b'.repeat(64));
    await flush();
    expect(learning.sentOfType('shutdown')).toEqual([{ type: 'shutdown', v: 1, grace_ms: 0 }]);
    learning.exit(0);
    await flush();
    await h.timers.advance(60_000);
    expect(h.spawn.of('learning')).toHaveLength(1);
    expect(h.files.last().services.learning).toMatchObject({ state: 'degraded', reason: 'contracts_hash_mismatch' });
    expect(h.spawn.of('gateway')).toHaveLength(0);
    const rejected = h.events('supervisor.handshake.rejected')[0];
    expect(rejected).toMatchObject({ expected: HASH.slice(0, 12), actual: 'b'.repeat(12) });
  });

  it('UT-SUP-005 mergeNodeOptions: undefined → 플래그만, 기존 값 보존 + 플래그, 이미 포함 → 원문, 자식 env에 반영 [NFR-PORT-002]', () => {
    expect(mergeNodeOptions(undefined)).toBe(FLAG);
    expect(mergeNodeOptions('--max-old-space-size=512')).toBe(`--max-old-space-size=512 ${FLAG}`);
    expect(mergeNodeOptions(`  ${FLAG} --max-old-space-size=512 `)).toBe(`${FLAG} --max-old-space-size=512`);
    const env = childEnv('/h', {
      env: (n) => (n === 'NODE_OPTIONS' ? '--max-old-space-size=512' : undefined),
      platform: 'linux',
    });
    expect(env.NODE_OPTIONS).toBe(`--max-old-space-size=512 ${FLAG}`);
  });

  it('UT-SUP-006 gatewayFallbacks·포트 표, gateway listening{4750} → warn 1회 + notices 1개(재시작 후에도 추가 0)·재시작 봉투 listen.port=4750 [FR-SET-001][AQ-08]', async () => {
    expect(gatewayFallbacks('prod')).toEqual([4748, 4749, 4750, 4751, 4752, 4753, 4754, 4755, 4756]);
    expect(gatewayFallbacks('dev')).toEqual([4848, 4849, 4850, 4851, 4852, 4853, 4854, 4855, 4856]);
    expect(gatewayFallbacks('test')).toEqual([]);
    expect(PREFERRED_PORTS.prod).toEqual({
      gateway: 4747,
      'ops-api': 4761,
      content: 4762,
      learning: 4763,
      'ai-gateway': 4764,
    });
    expect(PREFERRED_PORTS.dev).toEqual({
      gateway: 4847,
      'ops-api': 4861,
      content: 4862,
      learning: 4863,
      'ai-gateway': 4864,
    });
    expect(Object.values(PREFERRED_PORTS.test).every((p) => p === 0)).toBe(true);

    const h = createHarness({ profile: 'prod' });
    await h.start();
    h.spawn.last('content').ready();
    h.spawn.last('learning').ready();
    await flush();
    h.spawn.last('gateway').listening(4750);
    await flush();
    expect(h.events('supervisor.port.fallback').filter((r) => r.level === 'warn')).toHaveLength(1);
    expect(h.files.last().notices).toEqual(['port_fallback:gateway:4750']);
    h.spawn.last('gateway').exit(1);
    await h.timers.advance(250);
    expect(BootstrapEnvelope.parse(h.spawn.last('gateway').sent[0]).listen.port).toBe(4750);
    h.spawn.last('gateway').listening(4750);
    await flush();
    expect(h.events('supervisor.port.fallback').filter((r) => r.level === 'warn')).toHaveLength(1);
    expect(h.files.last().notices).toHaveLength(1);
    // 내부 서비스의 OS 할당 포트는 info 로그만
    h.spawn.last('content').listening(51234);
    await flush();
    expect(h.events('supervisor.port.fallback').filter((r) => r.level === 'info')).toHaveLength(1);
    expect(h.files.last().notices).toHaveLength(1);
  });

  it('UT-SUP-015 자식 env = 허용 목록 중 값 있는 것 + FATHOM_HOME + NODE_OPTIONS만 [NFR-SEC-003][STD-CFG-21]', () => {
    const source: Record<string, string> = {
      PATH: '/bin',
      HOME: '/home/u',
      LANG: 'ko_KR.UTF-8',
      TZ: 'Asia/Seoul',
      LC_ALL: '',
    };
    const env = childEnv('/data/fathom', { env: (n) => source[n], platform: 'linux' });
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/u',
      LANG: 'ko_KR.UTF-8',
      TZ: 'Asia/Seoul',
      FATHOM_HOME: '/data/fathom',
      NODE_OPTIONS: FLAG,
    });
  });

  it('UT-SUP-016 win32는 SYSTEMROOT·APPDATA·LOCALAPPDATA·USERPROFILE 4개를 더 전달한다 [NFR-PORT-002]', () => {
    const source: Record<string, string> = {
      PATH: 'C:\\Windows',
      SYSTEMROOT: 'C:\\Windows',
      APPDATA: 'C:\\A',
      LOCALAPPDATA: 'C:\\L',
      USERPROFILE: 'C:\\U',
    };
    const win = childEnv('C:\\F', { env: (n) => source[n], platform: 'win32' });
    expect(Object.keys(win).sort()).toEqual(
      ['APPDATA', 'FATHOM_HOME', 'LOCALAPPDATA', 'NODE_OPTIONS', 'PATH', 'SYSTEMROOT', 'USERPROFILE'].sort(),
    );
    const posix = childEnv('/f', { env: (n) => source[n], platform: 'linux' });
    expect(Object.keys(posix).sort()).toEqual(['FATHOM_HOME', 'NODE_OPTIONS', 'PATH']);
  });

  it('UT-SUP-017 주입 env에 ANTHROPIC_API_KEY·CI·HTTPS_PROXY가 있어도 자식에게 전달하지 않는다 [NFR-SEC-003][STD-CFG-21]', async () => {
    const h = createHarness({
      env: {
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'sk-secret',
        CI: '1',
        HTTPS_PROXY: 'http://p',
        NODE_EXTRA_CA_CERTS: '/ca.pem',
      },
    });
    await h.up();
    for (const child of h.spawn.children) {
      expect(Object.keys(child.spec.env).sort()).toEqual(['FATHOM_HOME', 'NODE_OPTIONS', 'PATH']);
      expect(JSON.stringify(child.spec.env)).not.toContain('sk-secret');
    }
  });
});
