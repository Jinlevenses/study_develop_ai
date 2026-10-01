import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseWindowsShim, resolveWindowsShim, safeSpawn, treeKill } from '../../../src/proc/proc.js';

const fixturePath = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SPAWN_OPTS = { env: {}, cwd: '/', timeoutMs: 1000 } as const;

describe('treeKill', () => {
  it('UT-SK-016 linux·darwin은 kill(-pid, SIGKILL), win32는 taskkill /T /F /PID이며 ESRCH는 무시한다 [NFR-SEC-005]', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const kills: [number, string][] = [];
      const execs: unknown[] = [];
      treeKill(4242, {
        platform,
        kill: (pid, sig) => void kills.push([pid, sig]),
        execFile: (file, args) => void execs.push([file, args]),
      });
      expect(kills, platform).toEqual([[-4242, 'SIGKILL']]);
      expect(execs, platform).toEqual([]);
    }
    const kills: unknown[] = [];
    const execs: [string, readonly string[]][] = [];
    treeKill(77, {
      platform: 'win32',
      kill: (pid, sig) => void kills.push([pid, sig]),
      execFile: (file, args) => void execs.push([file, args]),
    });
    expect(kills).toEqual([]);
    expect(execs).toEqual([['taskkill', ['/T', '/F', '/PID', '77']]]);

    // ESRCH 무시, 그 밖 오류는 다시 던진다.
    const esrch = Object.assign(new Error('no such process'), { code: 'ESRCH' });
    expect(() =>
      treeKill(9, {
        platform: 'linux',
        kill: () => {
          throw esrch;
        },
      }),
    ).not.toThrow();
    const eperm = Object.assign(new Error('denied'), { code: 'EPERM' });
    expect(() =>
      treeKill(9, {
        platform: 'linux',
        kill: () => {
          throw eperm;
        },
      }),
    ).toThrow(eperm);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => treeKill(bad, { platform: 'linux', kill: () => undefined }), String(bad)).toThrow(/pid/);
    }
  });
});

describe('safeSpawn 사전 검사', () => {
  it('UT-SK-124 상대 경로·win32 .cmd/.bat·잘못된 timeout은 던진다 [NFR-SEC-005][NFR-PORT-004]', async () => {
    await expect(safeSpawn('node', [], SPAWN_OPTS)).rejects.toThrow(/absolute path/);
    await expect(safeSpawn('./bin/tool', [], SPAWN_OPTS)).rejects.toThrow(/absolute path/);
    await expect(safeSpawn('C:\\tools\\claude.cmd', [], { ...SPAWN_OPTS, platform: 'win32' })).rejects.toThrow(
      /\.cmd\/\.bat/,
    );
    await expect(safeSpawn('C:\\tools\\x.BAT', [], { ...SPAWN_OPTS, platform: 'win32' })).rejects.toThrow(
      /\.cmd\/\.bat/,
    );
    await expect(safeSpawn('/bin/true', [], { ...SPAWN_OPTS, timeoutMs: 0 })).rejects.toThrow(/timeoutMs/);
    // 상대 경로는 win32 규칙으로도 거부된다.
    await expect(safeSpawn('tools\\x.exe', [], { ...SPAWN_OPTS, platform: 'win32' })).rejects.toThrow(/absolute path/);
  });
});

describe('Windows shim', () => {
  const CMD = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\claude.cmd';

  it('UT-SK-129 npm 9·10·11 cmd-shim fixture → node_script 경로, exe·인식 불가를 구분한다 [NFR-SEC-005][NFR-PORT-004]', async () => {
    const expected: Record<string, string> = {
      'shim-npm9.cmd': 'C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
      'shim-npm10.cmd': 'C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
      'shim-npm11.cmd': 'C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
    };
    for (const [name, script] of Object.entries(expected)) {
      const text = await readFile(fixturePath(name), 'utf8');
      expect(parseWindowsShim(CMD, text), name).toEqual({ ok: true, value: { kind: 'node_script', script } });
      // CRLF 줄끝(실제 .cmd)도 같다.
      expect(parseWindowsShim(CMD, text.replace(/\n/g, '\r\n')), `${name} CRLF`).toEqual({
        ok: true,
        value: { kind: 'node_script', script },
      });
    }
    const exe = await readFile(fixturePath('shim-exe.cmd'), 'utf8');
    expect(parseWindowsShim(CMD, exe)).toEqual({
      ok: true,
      value: {
        kind: 'exe',
        exe: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
      },
    });
    const unknown = await readFile(fixturePath('shim-unrecognized.cmd'), 'utf8');
    expect(parseWindowsShim(CMD, unknown)).toEqual({ ok: false, error: { reason: 'unrecognized' } });
    expect(parseWindowsShim(CMD, '')).toEqual({ ok: false, error: { reason: 'unrecognized' } });
    // 마지막 JS 경로가 이긴다.
    expect(parseWindowsShim(CMD, '"%dp0%\\a.js" x "%dp0%\\b\\c.mjs" %*')).toEqual({
      ok: true,
      value: { kind: 'node_script', script: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\b\\c.mjs' },
    });

    // 파일 읽기 변형
    expect(await resolveWindowsShim(fixturePath('shim-npm10.cmd'))).toMatchObject({
      ok: true,
      value: { kind: 'node_script' },
    });
    expect(await resolveWindowsShim(fixturePath('shim-unrecognized.cmd'))).toEqual({
      ok: false,
      error: { reason: 'unrecognized' },
    });
    expect(await resolveWindowsShim(fixturePath('missing.cmd'))).toEqual({
      ok: false,
      error: { reason: 'unreadable' },
    });
  });
});
