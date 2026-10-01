import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { safeSpawn } from '../../../src/proc/proc.js';

const NODE = process.execPath;

/** 좀비는 죽은 것으로 본다(컨테이너 PID 1이 수확하지 않을 수 있다). */
async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ESRCH') {
      return false;
    }
    throw e;
  }
  if (process.platform === 'linux') {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      return !/^\d+ \(.*\) Z /.test(stat);
    } catch {
      return false;
    }
  }
  return true;
}

describe('safeSpawn (실제 자식 프로세스)', () => {
  it('UT-SK-125 shell 미사용·인자 그대로·env 정확히 전달(부모 env 누설 0) [NFR-SEC-005][NFR-PORT-004]', async () => {
    // Arrange: 부모 env에 비밀을 심고, 자식에게는 허용 env만 준다.
    vi.stubEnv('FATHOM_TEST_PARENT_SECRET', 'leak-me');
    try {
      const script = 'process.stdout.write(JSON.stringify({ env: process.env, argv: process.argv.slice(1) }))';
      // Act: 셸 메타문자가 든 인자는 해석되지 않고 그대로 argv에 들어간다.
      const r = await safeSpawn(NODE, ['-e', script, '--', '$(echo hi); `id` | cat > /dev/null', '*'], {
        env: { ONLY_THIS: 'yes' },
        cwd: process.cwd(),
        timeoutMs: 10_000,
      });
      // Assert
      expect(r.spawnError).toBeNull();
      expect(r.exitCode).toBe(0);
      expect(r.timedOut).toBe(false);
      expect(r.pid).toBeGreaterThan(0);
      const out = JSON.parse(r.stdout) as { env: Record<string, string>; argv: string[] };
      expect(out.env.ONLY_THIS).toBe('yes');
      expect(out.env.FATHOM_TEST_PARENT_SECRET).toBeUndefined();
      expect(Object.keys(out.env).filter((k) => k !== 'ONLY_THIS' && !k.startsWith('LC_') && k !== 'PWD')).toEqual([]);
      expect(out.argv).toEqual(['$(echo hi); `id` | cat > /dev/null', '*']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('UT-SK-126 stdin 전달·stderr 링·ENOENT는 spawnError다 [NFR-SEC-005]', async () => {
    // stdin 1회 write + end, stderr는 마지막 N바이트만 남는다.
    const script = `
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { data += c; });
      process.stdin.on('end', () => {
        process.stderr.write('A'.repeat(500) + 'TAIL-MARK');
        process.stdout.write('got:' + data);
        process.exitCode = 3;
      });`;
    const r = await safeSpawn(NODE, ['-e', script], {
      env: {},
      cwd: process.cwd(),
      timeoutMs: 10_000,
      stdin: 'secret-from-stdin ✓',
      maxStderrBytes: 64,
    });
    expect(r.stdout).toBe('got:secret-from-stdin ✓');
    expect(r.exitCode).toBe(3);
    expect(Buffer.byteLength(r.stderrTail)).toBeLessThanOrEqual(64);
    expect(r.stderrTail.endsWith('TAIL-MARK')).toBe(true);

    // stdin 없이도 즉시 end — 자식이 EOF를 본다.
    const eof = await safeSpawn(
      NODE,
      ['-e', "process.stdin.on('end', () => process.stdout.write('eof')); process.stdin.resume();"],
      {
        env: {},
        cwd: process.cwd(),
        timeoutMs: 10_000,
      },
    );
    expect(eof.stdout).toBe('eof');

    // 바이너리 stdin
    const bin = await safeSpawn(
      NODE,
      ['-e', "process.stdin.on('data', (c) => process.stdout.write(String(c.length)));"],
      {
        env: {},
        cwd: process.cwd(),
        timeoutMs: 10_000,
        stdin: new Uint8Array([1, 2, 3, 4]),
      },
    );
    expect(bin.stdout).toBe('4');

    // ENOENT → spawnError, exitCode null
    const missing = await safeSpawn('/nonexistent/fathom-bin', [], { env: {}, cwd: process.cwd(), timeoutMs: 5_000 });
    expect(missing).toMatchObject({
      pid: null,
      exitCode: null,
      spawnError: 'ENOENT',
      timedOut: false,
      outputOverflow: false,
      stdout: '',
    });
  });

  it('UT-SK-127 타임아웃 → timedOut + 자식과 손자 트리 종료 [NFR-SEC-005]', async () => {
    // Arrange: 자식이 손자를 띄우고 pid를 알린 뒤 영원히 잔다(같은 프로세스 그룹).
    const script = `
      const { spawn } = require('node:child_process');
      const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.stdout.write(String(g.pid) + '\\n');
      setInterval(() => {}, 1000);`;
    const started = performance.now();
    // Act
    const r = await safeSpawn(NODE, ['-e', script], { env: {}, cwd: process.cwd(), timeoutMs: 800 });
    // Assert
    expect(r.timedOut).toBe(true);
    expect(r.outputOverflow).toBe(false);
    expect(r.signal).toBe('SIGKILL');
    expect(performance.now() - started).toBeLessThan(8_000);
    const grandchild = Number(r.stdout.trim());
    expect(grandchild).toBeGreaterThan(0);
    expect(r.pid).not.toBeNull();
    await vi.waitFor(
      async () => {
        expect(await isAlive(grandchild)).toBe(false);
        expect(await isAlive(r.pid ?? -1)).toBe(false);
      },
      { timeout: 4_000, interval: 50 },
    );
  });

  it('UT-SK-128 stdout이 상한 이상이면 outputOverflow + 트리 종료 [NFR-SEC-005]', async () => {
    const script = `
      const chunk = 'x'.repeat(1024);
      const t = setInterval(() => { process.stdout.write(chunk); }, 1);
      setTimeout(() => clearInterval(t), 20000);`;
    const r = await safeSpawn(NODE, ['-e', script], {
      env: {},
      cwd: process.cwd(),
      timeoutMs: 15_000,
      maxStdoutBytes: 64 * 1024,
    });
    expect(r.outputOverflow).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(Buffer.byteLength(r.stdout)).toBeLessThan(64 * 1024);
    expect(r.signal).toBe('SIGKILL');

    // 정확히 상한과 같은 크기도 초과다(>=).
    const exact = await safeSpawn(NODE, ['-e', "process.stdout.write('y'.repeat(100))"], {
      env: {},
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxStdoutBytes: 100,
    });
    expect(exact.outputOverflow).toBe(true);
    const under = await safeSpawn(NODE, ['-e', "process.stdout.write('y'.repeat(99))"], {
      env: {},
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxStdoutBytes: 100,
    });
    expect(under.outputOverflow).toBe(false);
    expect(under.stdout).toHaveLength(99);
  });
});
