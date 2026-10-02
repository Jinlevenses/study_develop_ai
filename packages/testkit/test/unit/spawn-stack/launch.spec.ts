import { describe, expect, it } from 'vitest';
import type { Stack } from '../../../src/spawn-stack.js';
import { launchStack, RECORDER_URL, stackEnv, stackFailureOf } from '../../../src/spawn-stack.js';
import type { Fake } from './fake-deps.js';
import { createFake, HOME, proc, REGISTRY_PATH, registryJson, SUP_PID } from './fake-deps.js';

const UP_ARGS = ['up', '--profile=test', '--no-open', '--log-level=info'];

async function launched(fake: Fake): Promise<Stack> {
  return await launchStack({ runtime: 'src', home: HOME, egress: 'off', migrate: false }, fake.deps);
}

describe('spawn-stack launchStack', () => {
  it('UT-TK-055 launchStack 성공은 up 인자·env·bootMs·gatewayUrl·supervisorPid를 낸다 [NFR-PERF-008][FR-SET-001]', async () => {
    // Arrange
    const fake = createFake();
    fake.onSpawn = (call) => {
      if (call.args.includes('up')) {
        fake.clock.t += 1234;
      }
      return null;
    };
    // Act
    const stack = await launchStack({ runtime: 'dist', home: HOME, safe: true, migrate: true }, fake.deps);
    // Assert
    expect(fake.calls).toHaveLength(5);
    const up = fake.calls[4];
    expect(up?.args.slice(-5)).toEqual([...UP_ARGS, '--safe']);
    expect(up?.env).toEqual(stackEnv({ home: HOME, recorderUrl: RECORDER_URL, env: fake.deps.env }));
    expect(stack.bootMs).toBe(1234);
    expect(stack.gatewayUrl).toBe('http://127.0.0.1:5001');
    expect(stack.supervisorPid).toBe(SUP_PID);
    expect(stack.migrations.map((m) => m.svc)).toEqual(['ops-api', 'ai-gateway', 'content', 'learning']);
    const plain = createFake();
    await launched(plain);
    expect(plain.calls).toHaveLength(1);
    expect(plain.calls[0]?.args.slice(-4)).toEqual(UP_ARGS);
  });

  it('UT-TK-056 launchStack 실패는 up_failed·registry_invalid로 정리 후 던진다 [FR-SET-001]', async () => {
    // Arrange: CLI exit 7(일부 degraded) — 살아 있는 supervisor는 SIGTERM → 5s 후 SIGKILL
    const exit7 = createFake();
    exit7.onSpawn = () => proc({ exitCode: 7, stdout: 'out', stderrTail: 'err' });
    // Act
    const error = await launched(exit7).catch((e: unknown) => e);
    // Assert
    const failure = stackFailureOf(error);
    expect(failure?.code).toBe('up_failed');
    expect(failure?.exitCode).toBe(7);
    expect(failure?.stdout).toBe('out');
    expect(failure?.stderrTail).toBe('err');
    expect(failure?.registry).not.toBeNull();
    expect(exit7.signals[0]).toEqual([SUP_PID, 'SIGTERM']);
    expect(exit7.signals.some(([pid, sig]) => pid === SUP_PID && sig === 'SIGKILL')).toBe(true);
    expect(exit7.signals.filter(([, sig]) => sig === 'SIGKILL').length).toBe(6);
    // SIGTERM에 죽으면 SIGKILL은 서비스 pid뿐
    const exit3 = createFake();
    exit3.onSpawn = () => proc({ exitCode: 3 });
    exit3.onSignal = (pid, sig) => {
      if (sig === 'SIGTERM') {
        exit3.alive.delete(pid);
      }
    };
    expect(stackFailureOf(await launched(exit3).catch((e: unknown) => e))?.code).toBe('up_failed');
    expect(exit3.signals.some(([pid, sig]) => pid === SUP_PID && sig === 'SIGKILL')).toBe(false);
    // timedOut
    const slow = createFake();
    slow.onSpawn = () => proc({ exitCode: null, timedOut: true });
    expect(stackFailureOf(await launched(slow).catch((e: unknown) => e))?.code).toBe('up_failed');
    // registry 파싱 실패
    const broken = createFake();
    broken.files.set(REGISTRY_PATH, '{"v":2}');
    expect(stackFailureOf(await launched(broken).catch((e: unknown) => e))?.code).toBe('registry_invalid');
    // exit 0인데 ready가 아님
    const notReady = createFake();
    notReady.files.set(REGISTRY_PATH, registryJson({ state: 'starting' }));
    expect(stackFailureOf(await launched(notReady).catch((e: unknown) => e))?.code).toBe('up_failed');
  });

  it('UT-TK-057 waitForState는 조건 충족까지 ≤50ms 간격으로 폴링하고 초과 시 wait_timeout, pid 없음은 not_running이다 [NFR-AVL-002]', async () => {
    // Arrange
    const fake = createFake();
    const stack = await launched(fake);
    fake.files.set(
      REGISTRY_PATH,
      registryJson({ services: { content: { pid: 4002, port: 5002, state: 'degraded' } } }),
    );
    fake.onSleep = (n) => {
      if (n === 3) {
        fake.files.set(REGISTRY_PATH, registryJson());
      }
    };
    // Act
    const view = await stack.waitForState('content', 'ready');
    // Assert
    expect(view.state).toBe('ready');
    expect(fake.sleeps).toHaveLength(3);
    expect(Math.max(...fake.sleeps)).toBeLessThanOrEqual(50);
    // 시간 초과
    fake.onSleep = () => undefined;
    fake.files.set(
      REGISTRY_PATH,
      registryJson({ services: { content: { pid: 4002, port: 5002, state: 'degraded' } } }),
    );
    const timeout = await stack.waitForState('content', 'ready', { timeoutMs: 200 }).catch((e: unknown) => e);
    const failure = stackFailureOf(timeout);
    expect(failure?.code).toBe('wait_timeout');
    expect(failure?.svc).toBe('content');
    const last = failure?.registry;
    expect(last === null || typeof last === 'object').toBe(true);
    // pid 없음
    fake.files.set(
      REGISTRY_PATH,
      registryJson({ services: { learning: { pid: null, port: null, state: 'stopped' } } }),
    );
    expect(stackFailureOf(await stack.pidOf('learning').catch((e: unknown) => e))?.code).toBe('not_running');
    expect(stackFailureOf(await stack.portOf('learning').catch((e: unknown) => e))?.code).toBe('not_running');
    expect(await stack.pidOf('gateway')).toBe(4001);
    expect(await stack.portOf('gateway')).toBe(5001);
  });

  it('UT-TK-058 restart는 이전 pid에 SIGKILL 1회 후 새 pid ready까지 기다린다 [NFR-AVL-002]', async () => {
    // Arrange
    const fake = createFake();
    const stack = await launched(fake);
    fake.onSignal = (pid, sig) => {
      if (pid === 4002 && sig === 'SIGKILL') {
        fake.files.set(
          REGISTRY_PATH,
          registryJson({ services: { content: { pid: 4002, port: 5002, state: 'ready' } } }),
        );
      }
    };
    fake.onSleep = (n) => {
      if (n === 4) {
        fake.files.set(
          REGISTRY_PATH,
          registryJson({ services: { content: { pid: 4999, port: 5002, state: 'ready' } } }),
        );
      }
    };
    // Act
    const result = await stack.restart('content');
    // Assert
    expect(result).toEqual({ oldPid: 4002, newPid: 4999 });
    expect(fake.signals.filter(([pid, sig]) => pid === 4002 && sig === 'SIGKILL')).toHaveLength(1);
    expect(fake.sleeps.length).toBeGreaterThanOrEqual(4);
  });
});
