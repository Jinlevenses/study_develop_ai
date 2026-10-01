import { readFileSync } from 'node:fs';
import { isUlid } from '@fathom/shared-kernel/ids/ids';
import { describe, expect, it } from 'vitest';
import { installExperimentalWarningFilter } from '../../bin/warning-filter.mjs';
import { terminatePid } from '../../src/lib/kill-pid.js';
import { run } from '../../src/run.js';
import type { FakeEnv } from './fakes.js';
import {
  ALL_READY,
  createFakeEnv,
  LOCK_PATH,
  lockText,
  okJson,
  REGISTRY_PATH,
  registryText,
  stderrText,
  stdoutText,
  TOKEN,
  TOKEN_PATH,
} from './fakes.js';

const DOWN = ['down', '--profile=test'];
const STATUS = ['status', '--profile=test'];

function running(f: FakeEnv): void {
  f.files.set(LOCK_PATH, lockText(4242));
  f.alive.add(4242);
  f.files.set(REGISTRY_PATH, registryText(ALL_READY));
  f.files.set(TOKEN_PATH, TOKEN);
}

describe('down · status', () => {
  it('UT-CLI-036 down: 202 → pid 사망 대기 → 0, 같은 ULID를 idempotency-key와 op_id로 · 꺼져 있으면(lock 없음·죽은 pid) 0·멱등 [FR-SET-015][FR-SET-001]', async () => {
    const f = createFakeEnv();
    running(f);
    f.routes.set('POST /api/v1/cli/shutdown', okJson(202, { accepted: true }));
    let polls = 0;
    f.hooks.onSleep = () => {
      polls += 1;
      if (polls === 4) {
        f.alive.delete(4242);
      }
    };
    expect(await run(DOWN, f.deps)).toBe(0);
    expect(f.killed).toEqual([]); // 폴백 신호 없음
    const call = f.gatewayCalls.find((c) => c.path === '/api/v1/cli/shutdown');
    expect(call?.body).toEqual({ op_id: call?.key, grace_ms: 3000 });
    expect(isUlid(call?.key)).toBe(true);
    expect(polls).toBeGreaterThanOrEqual(4);
    expect(stdoutText(f)).toContain('종료했습니다');

    // 꺼져 있으면(lock 없음·죽은 pid) 0·멱등
    const none = createFakeEnv();
    expect(await run(DOWN, none.deps)).toBe(0);
    expect(none.gatewayCalls).toEqual([]);
    expect(none.killed).toEqual([]);
    const dead = createFakeEnv();
    dead.files.set(LOCK_PATH, lockText(4242)); // alive 집합에 없음
    expect(await run(DOWN, dead.deps)).toBe(0);
    expect(stdoutText(dead)).toContain('실행 중이 아닙니다');
  });

  it('UT-CLI-037 down: 연결 실패/404/토큰 없음 → POSIX SIGTERM(killPid)·win32 taskkill.exe /PID → 0, 15s 생존 → 1 [FR-SET-015][FR-SET-001]', async () => {
    for (const mode of ['connect', '404', 'no-token'] as const) {
      const f = createFakeEnv();
      running(f);
      if (mode === 'connect') {
        f.routes.set('POST /api/v1/cli/shutdown', { ok: false, error: { kind: 'connect' } });
      } else if (mode === 'no-token') {
        f.files.delete(TOKEN_PATH);
      }
      f.hooks.onSleep = () => f.alive.delete(4242);
      expect(await run(DOWN, f.deps), mode).toBe(0);
      expect(f.killed).toEqual([4242]);
    }
    const stuck = createFakeEnv();
    running(stuck);
    expect(await run(DOWN, stuck.deps)).toBe(1);
    expect(stuck.clock.now() - 1_790_000_000_000).toBeGreaterThanOrEqual(15_000);

    // pid 재사용 방어 — lock과 registry의 boot_id·supervisor_pid가 어긋나면 신호를 보내지 않는다(STD-SEC-32).
    for (const mismatch of ['boot_id', 'pid'] as const) {
      const reused = createFakeEnv();
      running(reused);
      reused.files.set(LOCK_PATH, mismatch === 'pid' ? lockText(4243) : lockText(4242, '01HZZZZZZZZZZZZZZZZZZZZZZY'));
      reused.alive.add(4243);
      reused.routes.set('POST /api/v1/cli/shutdown', { ok: false, error: { kind: 'connect' } });
      expect(await run(DOWN, reused.deps), mismatch).toBe(1);
      expect(reused.killed, mismatch).toEqual([]);
      expect(stderrText(reused), mismatch).toContain('일치하지 않아');
    }
    expect(stderrText(stuck)).toContain('종료하지 못했습니다');

    const calls: { bin: string; args: readonly string[] }[] = [];
    const base = {
      env: (n: string): string | undefined => (n === 'SYSTEMROOT' ? 'C:\\Windows' : undefined),
      cwd: '/x',
    };
    const spawn = (bin: string, args: readonly string[]): Promise<never> => {
      calls.push({ bin, args });
      return Promise.resolve({
        pid: 1,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderrTail: '',
        timedOut: false,
        outputOverflow: false,
        spawnError: null,
      } as never);
    };
    expect(await terminatePid(4242, { ...base, platform: 'win32', signal: () => undefined, safeSpawn: spawn })).toBe(
      true,
    );
    expect(calls).toEqual([{ bin: 'C:\\Windows\\System32\\taskkill.exe', args: ['/PID', '4242'] }]); // /T /F 없음
    const signals: [number, string][] = [];
    expect(
      await terminatePid(7, {
        ...base,
        platform: 'linux',
        signal: (p, s) => void signals.push([p, s]),
        safeSpawn: spawn,
      }),
    ).toBe(true);
    expect(signals).toEqual([[7, 'SIGTERM']]);
    expect(
      await terminatePid(7, {
        ...base,
        platform: 'linux',
        signal: () => {
          throw new Error('ESRCH');
        },
        safeSpawn: spawn,
      }),
    ).toBe(false);
  });

  it('UT-CLI-038 status: 200 → 0(--json은 본문 그대로), gateway 불가 → registry 표 + 7, 꺼짐 → 3, Problem → 코드 매핑 [FR-SET-015]', async () => {
    const f = createFakeEnv();
    running(f);
    f.routes.set(
      'GET /api/v1/cli/status',
      okJson(200, { app_version: '1.2.3', profile: 'test', url: 'http://127.0.0.1:4747/', extra: { n: 1 } }),
    );
    expect(await run(STATUS, f.deps)).toBe(0);
    expect(stdoutText(f)).toContain('1.2.3');
    expect(f.gatewayCalls[0]).toMatchObject({ method: 'GET', port: 4747, token: TOKEN });
    const json = createFakeEnv();
    running(json);
    json.routes.set('GET /api/v1/cli/status', okJson(200, { app_version: '1.2.3', extra: { n: 1 } }));
    expect(await run([...STATUS, '--json'], json.deps)).toBe(0);
    expect(stdoutText(json)).toBe('{"app_version":"1.2.3","extra":{"n":1}}\n');

    for (const failure of [
      { ok: false, error: { kind: 'connect' } },
      { ok: false, error: { kind: 'timeout' } },
      okJson(503, null),
    ] as const) {
      const g = createFakeEnv();
      running(g);
      g.routes.set('GET /api/v1/cli/status', failure);
      expect(await run(STATUS, g.deps)).toBe(7);
      expect(stdoutText(g)).toContain('content');
      expect(stdoutText(g)).toContain('ready');
    }
    const partialJson = createFakeEnv();
    running(partialJson);
    expect(await run([...STATUS, '--json'], partialJson.deps)).toBe(7);
    expect(JSON.parse(stdoutText(partialJson).trim())).toMatchObject({ status: 'partial' });

    const off = createFakeEnv();
    expect(await run(STATUS, off.deps)).toBe(3);
    expect(stderrText(off)).toContain('CLI-DEP-001');

    const problem = createFakeEnv();
    running(problem);
    problem.routes.set('GET /api/v1/cli/status', {
      ok: true,
      value: {
        status: 401,
        body: null,
        problem: { code: 'GW-AUTH-007', title: 'CLI 인증에 실패했습니다', error_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ' },
      },
    });
    expect(await run(STATUS, problem.deps)).toBe(4);
    expect(stderrText(problem)).toContain('GW-AUTH-007');
  });

  it('UT-CLI-039 installExperimentalWarningFilter: 문자열·객체 형식 ExperimentalWarning 버림, DeprecationWarning 통과 · bin/fathom.mjs는 필터 설치가 동적 import보다 앞 [FR-SET-012]', () => {
    const seen: unknown[][] = [];
    const target = { emitWarning: (...a: unknown[]): void => void seen.push(a) };
    installExperimentalWarningFilter(target);
    target.emitWarning('SQLite is an experimental feature', 'ExperimentalWarning');
    target.emitWarning('SQLite is an experimental feature', { type: 'ExperimentalWarning', code: 'X' });
    const named = new Error('x');
    named.name = 'ExperimentalWarning';
    target.emitWarning(named);
    expect(seen).toEqual([]);
    target.emitWarning('old api', 'DeprecationWarning');
    target.emitWarning('old api', { type: 'DeprecationWarning' });
    target.emitWarning(new Error('plain'));
    expect(seen).toHaveLength(3);
    const text = readFileSync(new URL('../../bin/fathom.mjs', import.meta.url), 'utf8');
    expect(text.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(text.indexOf('installExperimentalWarningFilter(process)')).toBeGreaterThan(-1);
    expect(text.indexOf('installExperimentalWarningFilter(process)')).toBeLessThan(
      text.indexOf("await import('../dist/main.js')"),
    );
    expect(text).not.toMatch(/no-warnings|NODE_NO_WARNINGS|removeAllListeners|on\('warning'/);
  });
});
