import { describe, expect, it } from 'vitest';
import { UP_READY_TIMEOUT_MS } from '../../src/lib/ensure-running.js';
import { buildLaunchSpec } from '../../src/lib/supervisor-launch.js';
import { run } from '../../src/run.js';
import type { FakeEnv } from './fakes.js';
import {
  ALL_READY,
  createFakeEnv,
  HOME,
  LOCK_PATH,
  OPEN_URL,
  okJson,
  REGISTRY_PATH,
  registryText,
  stderrText,
  stdoutText,
  TOKEN,
  TOKEN_PATH,
} from './fakes.js';

const UP = ['up', '--profile=test'];

function withToken(f: FakeEnv): void {
  f.files.set(TOKEN_PATH, `${TOKEN}\n`);
  f.routes.set('POST /api/v1/cli/bootstrap-token', okJson(201, { open_url: OPEN_URL }));
}

describe('up · open · ensureRunning', () => {
  it('UT-CLI-002 lock 생존 → launchSupervisor 호출 0, 레지스트리 대기 후 bootstrap-token·openBrowser 1회 [FR-SET-001][FR-SET-023]', async () => {
    const f = createFakeEnv();
    withToken(f);
    f.files.set(
      LOCK_PATH,
      JSON.stringify({
        pid: 4242,
        boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        version: '1.2.3',
        started_at: 1,
        profile: 'test',
      }),
    );
    f.alive.add(4242);
    f.files.set(
      REGISTRY_PATH,
      registryText({ ...ALL_READY, gateway: { state: 'starting', port: null } }, { state: 'starting' }),
    );
    let polls = 0;
    f.hooks.onSleep = () => {
      polls += 1;
      if (polls === 3) {
        f.files.set(REGISTRY_PATH, registryText(ALL_READY));
      }
    };
    expect(await run(UP, f.deps)).toBe(0);
    expect(f.launches).toHaveLength(0);
    expect(polls).toBeGreaterThanOrEqual(3);
    expect(f.gatewayCalls.filter((c) => c.path === '/api/v1/cli/bootstrap-token')).toHaveLength(1);
    expect(f.gatewayCalls[0]).toMatchObject({ port: 4747, token: TOKEN, appVersion: '1.2.3', body: { purpose: 'up' } });
    expect(f.browser).toEqual([OPEN_URL]);
    expect(stdoutText(f)).toContain('Fathom 실행 중: http://127.0.0.1:4747/');
    expect(`${stdoutText(f)}${stderrText(f)}`).not.toContain('#bt=');
  });

  it('UT-CLI-025 launch 사양: src/dist 진입·execArgv, detached+ignore / foreground+inherit, env allowlist + 병합 NODE_OPTIONS, shell:false [FR-SET-001][NFR-PERF-008]', () => {
    const env = (n: string): string | undefined =>
      ({ PATH: '/bin', HOME: '/h', NODE_OPTIONS: '--max-old-space-size=512', ANTHROPIC_API_KEY: 'sk', CI: '1' })[n];
    const base = {
      appRoot: '/app',
      runtime: 'src' as const,
      profile: 'prod' as const,
      home: HOME,
      safe: false,
      foreground: false,
      logLevel: 'info' as const,
      entries: null,
    };
    const src = buildLaunchSpec(base, { env, platform: 'linux' }, '/usr/bin/node');
    expect(src.command).toBe('/usr/bin/node');
    expect(src.args).toEqual([
      '--disable-warning=ExperimentalWarning',
      '--import',
      'tsx',
      '--conditions=source',
      '/app/services/ops/src/supervisor/main.ts',
      '--profile=prod',
      `--home=${HOME}`,
      '--runtime=src',
      '--log-level=info',
    ]);
    expect(src.options).toMatchObject({
      cwd: '/app',
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    expect(src.options.env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      FATHOM_HOME: HOME,
      NODE_OPTIONS: '--max-old-space-size=512 --disable-warning=ExperimentalWarning',
    });
    const dist = buildLaunchSpec(
      { ...base, runtime: 'dist', safe: true, foreground: true, entries: '/e.json', profile: 'test' },
      { env, platform: 'linux' },
      '/n',
    );
    expect(dist.args).toEqual([
      '--disable-warning=ExperimentalWarning',
      '/app/services/ops/dist/supervisor/main.js',
      '--profile=test',
      `--home=${HOME}`,
      '--runtime=dist',
      '--safe',
      '--foreground',
      '--log-level=info',
      '--entries=/e.json',
    ]);
    expect(dist.options).toMatchObject({ detached: false, stdio: 'inherit', shell: false });
  });

  it('UT-CLI-026 대기: gateway ready → 0, 일부 degraded → 7, 레지스트리 boot_id 불일치(이전 boot)는 무시 [FR-SET-001][NFR-PERF-008]', async () => {
    const ready = createFakeEnv();
    withToken(ready);
    ready.hooks.onLaunch = () => {
      ready.files.set(
        LOCK_PATH,
        JSON.stringify({
          pid: 5000,
          boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
          version: '1.2.3',
          started_at: 1,
          profile: 'test',
        }),
      );
      ready.files.set(REGISTRY_PATH, registryText(ALL_READY));
    };
    ready.files.set(
      REGISTRY_PATH,
      registryText({ ...ALL_READY, gateway: { state: 'ready', port: 1111 } }, { bootId: '01HYYYYYYYYYYYYYYYYYYYYYYY' }),
    ); // 이전 boot
    expect(await run(UP, ready.deps)).toBe(0);
    expect(ready.launches).toHaveLength(1);
    expect(ready.gatewayCalls[0]?.port).toBe(4747); // 이전 boot의 1111이 아니다

    const partial = createFakeEnv();
    withToken(partial);
    partial.hooks.onLaunch = () => {
      partial.files.set(
        LOCK_PATH,
        JSON.stringify({
          pid: 5000,
          boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
          version: '1.2.3',
          started_at: 1,
          profile: 'test',
        }),
      );
      partial.files.set(
        REGISTRY_PATH,
        registryText(
          { ...ALL_READY, learning: { state: 'degraded', port: null, reason: 'contracts_hash_mismatch' } },
          { state: 'degraded' },
        ),
      );
    };
    expect(await run([...UP, '--no-open'], partial.deps)).toBe(7);
    expect(stderrText(partial)).toContain('learning');
  });

  it('UT-CLI-027 대기 실패: supervisor 종료·degraded+gateway 없음·20s 초과 → 3 (원인 reason·doctor 안내) [FR-SET-002][FR-SET-001]', async () => {
    const died = createFakeEnv();
    died.hooks.onLaunch = () => {
      died.hooks.onSleep = () => died.launchExit?.resolve(1);
    };
    expect(await run([...UP, '--no-open'], died.deps)).toBe(3);
    expect(stderrText(died)).toContain('CLI-DEP-001');

    const degraded = createFakeEnv();
    degraded.hooks.onLaunch = () => {
      degraded.files.set(
        LOCK_PATH,
        JSON.stringify({
          pid: 5000,
          boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
          version: '1.2.3',
          started_at: 1,
          profile: 'test',
        }),
      );
      degraded.files.set(
        REGISTRY_PATH,
        registryText(
          {
            ...ALL_READY,
            content: { state: 'degraded', reason: 'exit_78:schema_needs_migrate' },
            gateway: { state: 'stopped', port: null, reason: 'waiting_deps' },
          },
          { state: 'degraded' },
        ),
      );
    };
    expect(await run([...UP, '--no-open'], degraded.deps)).toBe(3);
    expect(stderrText(degraded)).toContain('content: exit_78:schema_needs_migrate');
    expect(stderrText(degraded)).toContain('fathom doctor');

    const slow = createFakeEnv();
    expect(await run([...UP, '--no-open'], slow.deps)).toBe(3);
    expect(slow.clock.now() - 1_790_000_000_000).toBeGreaterThanOrEqual(UP_READY_TIMEOUT_MS);
    expect(slow.sleeps.every((ms) => ms === 100)).toBe(true);

    const spawnFail = createFakeEnv();
    spawnFail.launchThrows = true;
    expect(await run([...UP, '--no-open'], spawnFail.deps)).toBe(3);
  });

  it('UT-CLI-028 up: supervisor 75 → 1회 재시도·포트 폴백 안내 1회 · 브라우저 열기 실패 → 1 + 안내(URL·토큰 출력 0), --foreground는 supervisor 종료 코드를 따른다 [FR-SET-001][NFR-PERF-008][FR-SET-023]', async () => {
    {
      const f = createFakeEnv();
      f.hooks.onLaunch = () => {
        // 다른 CLI가 먼저 띄운 supervisor가 이미 살아 있고, 우리가 띄운 쪽은 75로 끝난다.
        f.files.set(
          LOCK_PATH,
          JSON.stringify({
            pid: 4242,
            boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
            version: '1.2.3',
            started_at: 1,
            profile: 'test',
          }),
        );
        f.alive.add(4242);
        f.files.set(
          REGISTRY_PATH,
          registryText(
            { ...ALL_READY, gateway: { state: 'ready', port: 4750 } },
            { notices: ['port_fallback:gateway:4750'] },
          ),
        );
        f.hooks.onSleep = () => f.launchExit?.resolve(75);
      };
      expect(await run([...UP, '--no-open'], f.deps)).toBe(0);
      expect(f.launches).toHaveLength(1);
      const out = stdoutText(f);
      expect(out.match(/기본 포트를 쓸 수 없어 4750/g)).toHaveLength(1);
      expect(out).toContain('Fathom 실행 중: http://127.0.0.1:4750/');
    }
    {
      const f = createFakeEnv();
      withToken(f);
      f.browserOk = false;
      f.files.set(
        LOCK_PATH,
        JSON.stringify({
          pid: 4242,
          boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
          version: '1.2.3',
          started_at: 1,
          profile: 'test',
        }),
      );
      f.alive.add(4242);
      f.files.set(REGISTRY_PATH, registryText(ALL_READY));
      expect(await run(UP, f.deps)).toBe(1);
      expect(stderrText(f)).toContain('브라우저를 열지 못했습니다');
      expect(`${stdoutText(f)}${stderrText(f)}`).not.toContain('127.0.0.1:4747/#');

      const fg = createFakeEnv();
      fg.hooks.onLaunch = () => {
        fg.files.set(
          LOCK_PATH,
          JSON.stringify({
            pid: 5000,
            boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
            version: '1.2.3',
            started_at: 1,
            profile: 'test',
          }),
        );
        fg.files.set(REGISTRY_PATH, registryText(ALL_READY));
      };
      const pending = run([...UP, '--foreground', '--no-open'], fg.deps);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(fg.launches[0]).toMatchObject({ foreground: true });
      fg.launchExit?.resolve(0);
      expect(await pending).toBe(0);
      const bad = createFakeEnv();
      bad.hooks.onLaunch = fg.hooks.onLaunch;
      bad.hooks.onLaunch = () => {
        bad.files.set(
          LOCK_PATH,
          JSON.stringify({
            pid: 5000,
            boot_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
            version: '1.2.3',
            started_at: 1,
            profile: 'test',
          }),
        );
        bad.files.set(REGISTRY_PATH, registryText(ALL_READY));
      };
      const pendingBad = run([...UP, '--foreground', '--no-open'], bad.deps);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      bad.launchExit?.resolve(70);
      expect(await pendingBad).toBe(1);
    }
  });
});
