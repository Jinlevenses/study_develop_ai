import { createFakeClock } from '@fathom/testkit/clock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createService } from '../../../src/service/boot.js';
import { defOf } from './support.js';
import { envelope, fakePort, SELF_TOKEN } from './support-boot.js';

afterEach(() => {
  vi.useRealTimers();
});

function run(def = defOf('content', { databases: [] }), port = fakePort()) {
  const chunks: string[] = [];
  const result = createService(def, {
    process: port.port,
    clock: createFakeClock(),
    logDestination: { write: (c: string) => void chunks.push(c) },
  });
  return { port, chunks, result };
}

const fatalOf = (port: ReturnType<typeof fakePort>): unknown =>
  port.sent.find((m) => typeof m === 'object' && m !== null && 'type' in m && m.type === 'fatal');

describe('부트스트랩 실패 경로', () => {
  it('UT-SK-170 IPC 없음 → 78 no_ipc (보낼 곳이 없으니 fatal 메시지 없음) [NFR-SEC-003][FR-SET-002]', async () => {
    // Arrange / Act
    const { port, result } = run(undefined, fakePort({ hasIpc: false }));
    // Assert
    expect(await result).toEqual({ kind: 'exited', code: 78 });
    expect(port.exits).toEqual([78]);
    expect(port.sent).toEqual([]);
  });

  it('UT-SK-170 10s 안에 첫 메시지가 없으면 78 bootstrap_timeout [NFR-SEC-003][FR-SET-002]', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { port, result } = run();
    // Act
    await vi.advanceTimersByTimeAsync(9999);
    expect(port.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    // Assert
    expect(await result).toEqual({ kind: 'exited', code: 78 });
    expect(fatalOf(port)).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: 'bootstrap_timeout' });
  });

  it('UT-SK-170 type·스키마·svc 불일치 → 각 code로 78, 로그·fatal 메시지에 self_token·callers 값 0 [NFR-SEC-003][FR-SET-002]', async () => {
    const cases: { name: string; message: unknown; code: string }[] = [
      { name: 'type', message: { type: 'registry.updated', v: 1, peers: {} }, code: 'bootstrap_unexpected' },
      { name: 'not an object', message: 'hello', code: 'bootstrap_unexpected' },
      { name: 'schema', message: { ...envelope(), self_token: 'short' }, code: 'bootstrap_invalid' },
      { name: 'extra key', message: { ...envelope(), surplus: 1 }, code: 'bootstrap_invalid' },
      { name: 'svc', message: envelope({ svc: 'learning' }), code: 'bootstrap_svc_mismatch' },
      {
        name: 'host',
        message: { ...envelope(), listen: { host: '0.0.0.0', port: 4762 } },
        code: 'listen_host_forbidden',
      },
    ];
    for (const c of cases) {
      // Arrange
      const { port, chunks, result } = run();
      // Act
      port.deliver(c.message);
      // Assert
      expect(await result, c.name).toEqual({ kind: 'exited', code: 78 });
      expect(fatalOf(port), c.name).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: c.code });
      const everything = JSON.stringify([chunks, port.sent]);
      expect(everything, c.name).not.toContain(SELF_TOKEN);
      expect(everything, c.name).not.toContain('1'.repeat(64)); // callers 토큰(gateway)
    }
  });

  it('UT-SK-007 FATHOM_DEPLOY=container → 78 container_mode_unsupported [NFR-SEC-001]', async () => {
    // Arrange
    const { port, chunks, result } = run(undefined, fakePort({ env: { FATHOM_DEPLOY: 'container' } }));
    // Act
    port.deliver(envelope());
    // Assert
    expect(await result).toEqual({ kind: 'exited', code: 78 });
    expect(fatalOf(port)).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: 'container_mode_unsupported' });
    expect(JSON.stringify(chunks)).not.toContain(SELF_TOKEN);
  });

  it('UT-SK-199 FATHOM_SUPERVISOR → 78, profile prod + FATHOM_AI_CASSETTE_DIR → 78, 계약 해시 불일치 → 78 [NFR-SEC-003]', async () => {
    const cases: {
      env: Parameters<typeof fakePort>[0];
      message: unknown;
      code: string;
      def?: Parameters<typeof defOf>[1];
    }[] = [
      { env: { env: { FATHOM_SUPERVISOR: '1' } }, message: envelope(), code: 'external_supervisor_unsupported' },
      {
        env: { env: { FATHOM_AI_CASSETTE_DIR: '/x' } },
        message: envelope({ profile: 'prod' }),
        code: 'test_env_in_prod',
      },
      { env: {}, message: envelope(), code: 'contracts_hash_mismatch', def: { contractsHash: 'd'.repeat(64) } },
    ];
    for (const c of cases) {
      // Arrange
      const { port, result } = run(defOf('content', { databases: [], ...(c.def ?? {}) }), fakePort(c.env));
      // Act
      port.deliver(c.message);
      // Assert
      expect(await result, c.code).toEqual({ kind: 'exited', code: 78 });
      expect(fatalOf(port), c.code).toEqual({ type: 'fatal', v: 1, exit_code: 78, code: c.code });
    }
  });

  it('UT-SK-195 unhandledRejection → fatal{70, unhandled} + exit 70·uncaughtException도 같다 [NFR-MAINT-001]', () => {
    for (const kind of ['unhandledRejection', 'uncaughtException'] as const) {
      // Arrange
      const { port, chunks } = run();
      // Act
      port.fatal(kind, new Error('kaboom'));
      // Assert
      expect(fatalOf(port)).toEqual({ type: 'fatal', v: 1, exit_code: 70, code: 'unhandled' });
      expect(port.exits).toEqual([70]);
      expect(chunks).toEqual([]); // 로거가 만들어지기 전이라 로그는 없다
    }
  });
});
