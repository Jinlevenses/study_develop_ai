import { BootstrapEnvelope, IpcServiceToSupervisor } from '@fathom/contracts/admin/ipc';
import { CONTRACTS_HASH } from '@fathom/contracts/events/registry.gen';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import type { StackService } from '@fathom/testkit/spawn-stack';
import { APP_ROOT, migrateHome } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DirectOptions } from '../support/direct-stack.js';
import {
  buildEnvelope,
  forkWithEnvelope,
  isAlive,
  launchDirect,
  placeholderPeers,
  rootVersion,
} from '../support/direct-stack.js';

// CT-SYS-009 — 서비스 5종이 같은 BootstrapEnvelope로 기동하고 위반 봉투는 exit 78로 거부한다(IF-IPC-001·005·006·007).

const SERVICES: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];
const EXPECTED_DBS: Readonly<Record<StackService, readonly string[]>> = {
  gateway: [],
  content: ['content.db'],
  learning: ['insight.db', 'learning.db'],
  'ai-gateway': ['ai-cache.db', 'ai.db'],
  'ops-api': ['ops.db'],
};
const EXPECTED_KEYS = [
  'app_version',
  'boot_id',
  'callers',
  'contracts_hash',
  'flags',
  'home',
  'id',
  'listen',
  'log_level',
  'peers',
  'profile',
  're',
  'self_token',
  'svc',
  'type',
  'v',
  'web_root',
];

function tokensOf(): string[] {
  return Object.values(TEST_CALLER_TOKENS);
}

describe('교차 계약: 부트스트랩 봉투', () => {
  const state: { home: Awaited<ReturnType<typeof createTempHome>> | null; pids: number[] } = { home: null, pids: [] };

  beforeAll(async () => {
    state.home = await createTempHome('fathom-ct009-');
  });
  afterAll(async () => {
    for (const pid of state.pids) {
      expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
    }
    await state.home?.cleanup();
  });

  it('CT-SYS-009 서비스 5종이 같은 BootstrapEnvelope로 기동하고 위반 봉투는 exit 78로 거부한다 [NFR-SEC-003][IF-IPC-001][IF-IPC-006][IF-IPC-007]', async () => {
    const home = state.home?.path;
    if (home === undefined) {
      throw new Error('temp home missing');
    }
    const options: DirectOptions = {
      home,
      runtime: 'src',
      services: SERVICES,
      tokens: TEST_CALLER_TOKENS,
      cliToken: 'C'.repeat(43),
      contractsHash: CONTRACTS_HASH,
    };

    // (a) 정적: 봉투 키 집합
    expect(Object.keys(BootstrapEnvelope.shape).sort()).toEqual(EXPECTED_KEYS);

    // (b) 양성: 5개 서비스가 같은 계약 해시로 기동한다
    await migrateHome({ appRoot: APP_ROOT, home, runtime: 'src', egress: 'off' });
    const stack = await launchDirect(options);
    try {
      for (const svc of SERVICES) {
        const service = stack.services[svc];
        if (service === undefined) {
          throw new Error(`${svc} not launched`);
        }
        state.pids.push(service.pid);
        const parsed = service.messages.map((m) => IpcServiceToSupervisor.parse(m));
        const listening = parsed.find((m) => m.type === 'listening');
        const ready = parsed.find((m) => m.type === 'ready');
        expect(listening?.type === 'listening' ? listening.port : 0, `${svc} port`).toBeGreaterThanOrEqual(1);
        if (ready?.type !== 'ready') {
          throw new Error(`${svc} sent no ready`);
        }
        expect(ready.contracts_hash, `${svc} contracts_hash`).toBe(CONTRACTS_HASH);
        expect(ready.app_version).toBe(rootVersion());
        expect(Object.keys(ready.schema_versions).sort(), `${svc} schema_versions`).toEqual([...EXPECTED_DBS[svc]]);
      }
    } finally {
      await stack.stop();
    }

    // (c) 음성: 위반 봉투는 fatal 78 + exit 78, 출력에 토큰 0
    const valid = buildEnvelope('gateway', options, placeholderPeers());
    const cases: { name: string; code: string; first: unknown }[] = [
      {
        name: 'listen.host 0.0.0.0',
        code: 'listen_host_forbidden',
        first: { ...valid, listen: { host: '0.0.0.0', port: 0 } },
      },
      { name: '미지 키', code: 'bootstrap_invalid', first: { ...valid, extra: 1 } },
      {
        name: 'svc 불일치',
        code: 'bootstrap_svc_mismatch',
        first: buildEnvelope('content', options, placeholderPeers()),
      },
      {
        name: '첫 메시지가 봉투 아님',
        code: 'bootstrap_unexpected',
        first: { type: 'log.level', v: 1, level: 'info' },
      },
    ];
    for (const c of cases) {
      const child = await forkWithEnvelope('gateway', options, c.first);
      state.pids.push(child.pid);
      const exit = await child.exit;
      expect(exit, c.name).toBe(78);
      const fatal = child.messages.map((m) => IpcServiceToSupervisor.parse(m)).find((m) => m.type === 'fatal');
      expect(fatal, c.name).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: c.code });
      const output = child.lines.join('\n');
      for (const token of tokensOf()) {
        expect(output.includes(token), `${c.name}: token leaked`).toBe(false);
      }
    }
  });
});
