import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTRACTS_HASH } from '@fathom/contracts/events/registry.gen';
import { createPrng } from '@fathom/testkit/prng';
import type { StackService } from '@fathom/testkit/spawn-stack';
import { APP_ROOT, launchStack, migrateHome, parseLock, parseRegistry } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { describe, expect, it } from 'vitest';
import { isAlive, launchDirect } from '../support/direct-stack.js';

// SEC-GW-007 — 호출자 토큰은 env·registry·lock·로그·파일 어디에도 평문으로 남지 않는다 (NFR-SEC-003, ADR-012 §3).

const ENV_ALLOWED: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TZ',
  'FATHOM_HOME',
  'NODE_OPTIONS',
  // Node `child_process.fork`가 IPC 채널용으로 직접 넣는 내부 변수(값은 fd 번호·직렬화 모드 — 토큰 아님)
  'NODE_CHANNEL_FD',
  'NODE_CHANNEL_SERIALIZATION_MODE',
]);
const HEX64 = /[0-9a-f]{64}/;

function environOf(pid: number): { keys: string[]; values: string[] } {
  const raw = readFileSync(`/proc/${String(pid)}/environ`, 'utf8')
    .split('\0')
    .filter((s) => s !== '');
  const pairs = raw.map((entry) => {
    const eq = entry.indexOf('=');
    return { key: entry.slice(0, eq), value: entry.slice(eq + 1) };
  });
  return { keys: pairs.map((p) => p.key), values: pairs.map((p) => p.value) };
}

/** 디렉터리 아래 모든 파일의 바이트에서 센티널을 찾는다(상대 경로 목록). */
function scanFiles(dir: string, sentinels: readonly string[]): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...scanFiles(full, sentinels));
    } else if (entry.isFile()) {
      const bytes = readFileSync(full);
      for (const s of sentinels) {
        if (bytes.includes(s)) {
          hits.push(`${full}:${s.slice(0, 8)}`);
        }
      }
    }
  }
  return hits;
}

function scanLines(lines: readonly string[], sentinels: readonly string[]): number {
  return lines.filter((line) => sentinels.some((s) => line.includes(s))).length;
}

async function authedStatus(base: string, route: string, token: string | null): Promise<number> {
  const headers: Record<string, string> = {};
  if (token !== null) {
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(new URL(route, base), { headers, signal: AbortSignal.timeout(10_000) });
  await res.text();
  return res.status;
}

describe('보안: 토큰 노출', () => {
  it('SEC-GW-007 호출자 토큰이 env·registry·lock·출력·HOME 파일에 평문으로 없다 [NFR-SEC-003]', async () => {
    const pids: number[] = [];
    // ① 실제 스택(Linux): 6개 프로세스 environ·run 파일
    const stackHome = await createTempHome('fathom-sec007a-');
    try {
      const stack = await launchStack({ runtime: 'dist', home: stackHome.path });
      try {
        const registry = await stack.registry();
        const all = [
          stack.supervisorPid,
          ...Object.values(registry.services).flatMap((s) => (s?.pid === null || s === undefined ? [] : [s.pid])),
        ];
        pids.push(...all);
        expect(all).toHaveLength(6);
        if (process.platform === 'linux') {
          for (const pid of all) {
            const env = environOf(pid);
            expect(
              env.keys.filter((k) => !ENV_ALLOWED.has(k)),
              `pid ${String(pid)} env keys`,
            ).toEqual([]);
            expect(
              env.values.filter((v) => HEX64.test(v)),
              `pid ${String(pid)} env values`,
            ).toEqual([]);
          }
        }
        const registryText = readFileSync(path.join(stackHome.path, 'run', 'registry.json'), 'utf8');
        const lockText = readFileSync(path.join(stackHome.path, 'run', 'supervisor.lock'), 'utf8');
        expect(registryText).not.toMatch(HEX64);
        expect(lockText).not.toMatch(HEX64);
        expect(parseRegistry(registryText).ok).toBe(true);
        expect(parseLock(lockText).ok).toBe(true);
      } finally {
        await stack.stop();
      }
    } finally {
      await stackHome.cleanup();
    }

    // ② 직접 기동(dist): 센티널 토큰 5개
    const prng = createPrng(16);
    const sentinel = (): string =>
      Array.from({ length: 64 }, () => '0123456789abcdef'.charAt(prng.int(0, 15))).join('');
    const tokens: Record<StackService, string> = {
      gateway: sentinel(),
      content: sentinel(),
      learning: sentinel(),
      'ai-gateway': sentinel(),
      'ops-api': sentinel(),
    };
    const sentinels = Object.values(tokens);
    const home = await createTempHome('fathom-sec007b-');
    try {
      await migrateHome({ appRoot: APP_ROOT, home: home.path, runtime: 'dist', egress: 'off' });
      const direct = await launchDirect({
        home: home.path,
        runtime: 'dist',
        services: ['content', 'learning'],
        tokens,
        cliToken: 'C'.repeat(43),
        contractsHash: CONTRACTS_HASH,
      });
      const content = direct.services.content;
      const learning = direct.services.learning;
      if (content === undefined || learning === undefined) {
        throw new Error('services not launched');
      }
      pids.push(content.pid, learning.pid);
      try {
        expect(await authedStatus(content.baseUrl, '/internal/v1/metrics', null)).toBe(401);
        expect(await authedStatus(content.baseUrl, '/internal/v1/metrics', tokens.learning)).toBe(403);
        expect(await authedStatus(content.baseUrl, '/internal/v1/metrics', tokens['ops-api'])).toBe(200);
        if (process.platform === 'linux') {
          for (const pid of [content.pid, learning.pid]) {
            const env = environOf(pid);
            expect(
              env.values.some((v) => sentinels.some((s) => v.includes(s))),
              `pid ${String(pid)} environ`,
            ).toBe(false);
          }
        }
      } finally {
        await direct.stop();
      }
      expect(scanLines([...content.lines, ...learning.lines], sentinels), 'process output lines').toBe(0);
      expect(scanFiles(home.path, sentinels), 'HOME files').toEqual([]);
      // 대조군: 같은 스캐너가 일부러 넣은 센티널을 찾아낸다
      writeFileSync(path.join(home.path, 'planted.txt'), `x${sentinels[0] ?? ''}y`);
      expect(scanFiles(home.path, sentinels)).toHaveLength(1);
      expect(scanLines(['noise', `token=${sentinels[1] ?? ''}`], sentinels)).toBe(1);
    } finally {
      await home.cleanup();
    }
    for (const pid of pids) {
      expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
    }
  });
});
