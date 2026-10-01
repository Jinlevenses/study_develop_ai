import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { startEgressSampler } from '../../../src/egress-sampler.js';
import { onlyOn } from '../../../src/platform.js';
import { createTempHome } from '../../../src/temp-home.js';

const RECORDER = fileURLToPath(new URL('../../../src/preload/egress-recorder.mjs', import.meta.url));
const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

type Row = { pid: number; kind: string; target: string; blocked: boolean; stack: string[]; ts: number };

async function runProbe(
  script: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ pid: number; stdout: string }> {
  const merged: Record<string, string | undefined> = { ...process.env, ...env };
  const child = spawn(process.execPath, ['--import', RECORDER, fixture(script), ...args], {
    env: merged,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  const [code] = await once(child, 'exit');
  expect(code).toBe(0);
  return { pid: child.pid ?? -1, stdout };
}

async function readRows(file: string): Promise<Row[]> {
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Row);
}

describe('egress recorder (L1)', () => {
  it('UT-TK-010 block 모드는 외부 connect를 ECONNREFUSED, DNS를 ENOTFOUND로 막고 blocked:true 2행을 남긴다 [NFR-AVL-001]', async () => {
    // Arrange
    const home = await createTempHome();
    try {
      // Act
      const { pid, stdout } = await runProbe('block-probe.mjs', [], {
        FATHOM_HOME: home.path,
        FATHOM_EGRESS_MODE: 'block',
      });
      const rows = await readRows(path.join(home.path, 'tmp', 'egress', `${pid}.jsonl`));
      // Assert
      expect(stdout).toContain('connect:ECONNREFUSED');
      expect(stdout).toContain('dns:ENOTFOUND');
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => [r.kind, r.target, r.blocked])).toEqual(
        expect.arrayContaining([
          ['connect', '203.0.113.1:9', true],
          ['dns', 'example.com', true],
        ]),
      );
      for (const row of rows) {
        expect(row.pid).toBe(pid);
        expect(Number.isInteger(row.ts)).toBe(true);
        expect(row.stack.length).toBeGreaterThan(0);
        expect(row.stack.length).toBeLessThanOrEqual(5);
      }
    } finally {
      await home.cleanup();
    }
  });

  onlyOn('linux')('egress recorder record mode', () => {
    it('UT-TK-045 record 모드는 loopback connect·node spawn을 기록하지 않고 비 node spawn(/bin/true)을 기록한다 [NFR-AVL-001]', async () => {
      // Arrange
      const home = await createTempHome();
      try {
        // Act
        const { pid, stdout } = await runProbe('record-probe.mjs', ['record'], {
          FATHOM_HOME: home.path,
          FATHOM_EGRESS_MODE: undefined,
        });
        const rows = await readRows(path.join(home.path, 'tmp', 'egress', `${pid}.jsonl`));
        // Assert
        expect(stdout).toContain('done');
        expect(rows.filter((r) => r.kind === 'connect' || r.kind === 'tls' || r.kind === 'dns')).toEqual([]);
        expect(rows.map((r) => [r.kind, r.target, r.blocked])).toEqual([
          ['spawn', '/bin/true', false],
          ['spawn', '/bin/sh', false],
        ]);
        // exec 명령 문자열(비밀 포함)은 기록하지 않는다.
        expect(JSON.stringify(rows)).not.toContain('sk-ant-');
      } finally {
        await home.cleanup();
      }
    });
  });

  it('UT-TK-046 FATHOM_HOME이 없으면 <tmpdir>/fathom-egress/에 기록한다 [NFR-AVL-001]', async () => {
    // Arrange: 자식의 os.tmpdir()을 임시 디렉터리로 돌린다
    const scratch = await createTempHome('fathom-egress-fallback-');
    try {
      // Act
      const { pid } = await runProbe('record-probe.mjs', ['fallback'], {
        FATHOM_HOME: undefined,
        FATHOM_EGRESS_MODE: 'block',
        TMPDIR: scratch.path,
        TMP: scratch.path,
        TEMP: scratch.path,
      });
      // Assert
      const dir = path.join(scratch.path, 'fathom-egress');
      expect(await readdir(dir)).toEqual([`${pid}.jsonl`]);
      const rows = await readRows(path.join(dir, `${pid}.jsonl`));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'dns', target: 'example.com', blocked: true });
    } finally {
      await scratch.cleanup();
    }
  });
});

function firstExternalIpv4(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}

onlyOn('linux')('egress sampler (L2)', () => {
  it('UT-TK-011 표본기가 비 loopback 원격 주소로 연결한 자식을 잡는다 [NFR-AVL-001]', async () => {
    // 표본기가 비 loopback 원격 주소로 연결한 자식을 잡는다 [NFR-AVL-001]
    {
      // Arrange: 비내부 IPv4에 서버를 열고 같은 주소로 연결(호스트 밖으로 나가지 않음). 없으면 203.0.113.1:9 SYN_SENT 시도.
      const external = firstExternalIpv4();
      const mode = external === undefined ? 'syn' : 'self';
      const address = external ?? '203.0.113.1';
      const sampler = startEgressSampler({ rootPid: process.pid, intervalMs: 25 });
      const child = spawn(process.execPath, [fixture('sampler-probe.mjs'), mode, address], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      try {
        // Act / Assert
        await vi.waitFor(
          () => {
            const hit = sampler
              .snapshot()
              .remotes.find((r) => r.pid === child.pid && r.remote.startsWith(`${address}:`));
            expect(hit).toBeDefined();
            expect(hit?.state).toBe(mode === 'self' ? 'ESTABLISHED' : 'SYN_SENT');
          },
          { timeout: 15_000, interval: 25 },
        );
      } finally {
        child.stdin.end();
        await once(child, 'exit');
      }
      const report = await sampler.stop();
      expect(report.samples).toBeGreaterThan(0);
      expect(report.remotes.some((r) => r.remote.startsWith(`${address}:`))).toBe(true);
    }
    // loopback 연결만 있는 프로세스는 원격 0건이다 [NFR-AVL-001]
    {
      // Arrange
      const sampler = startEgressSampler({ rootPid: process.pid, intervalMs: 25 });
      const child = spawn(process.execPath, [fixture('sampler-probe.mjs'), 'self', '127.0.0.1'], {
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      try {
        await new Promise<void>((resolve) => {
          child.stdout.once('data', () => resolve());
        });
        // Act: 연결이 유지되는 동안 표본이 몇 번 돌 때까지 기다린다
        const before = sampler.snapshot().samples;
        await vi.waitFor(() => expect(sampler.snapshot().samples).toBeGreaterThan(before + 2), {
          timeout: 5000,
          interval: 25,
        });
      } finally {
        child.stdin.end();
        await once(child, 'exit');
      }
      // Assert
      const report = await sampler.stop();
      expect(report.remotes.filter((r) => r.pid === child.pid)).toEqual([]);
    }
  });
});
