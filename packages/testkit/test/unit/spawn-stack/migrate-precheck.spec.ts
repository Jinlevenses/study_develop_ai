import { describe, expect, it } from 'vitest';
import { APP_ROOT, launchStack, migrateHome, serviceEntry, stackFailureOf } from '../../../src/spawn-stack.js';
import { createFake, HOME, proc } from './fake-deps.js';

describe('spawn-stack migrate·사전 검사', () => {
  it('UT-TK-053 migrateHome은 ops-api→ai-gateway→content→learning 순서로 직렬 실행하고 실패 시 즉시 migrate_failed다 [NFR-MAINT-011]', async () => {
    // Arrange
    const fake = createFake();
    // Act
    const results = await migrateHome({ appRoot: APP_ROOT, home: HOME, runtime: 'src', egress: 'off' }, fake.deps);
    // Assert
    expect(results.map((r) => r.svc)).toEqual(['ops-api', 'ai-gateway', 'content', 'learning']);
    expect(fake.calls).toHaveLength(4);
    for (const [i, svc] of (['ops-api', 'ai-gateway', 'content', 'learning'] as const).entries()) {
      expect(fake.calls[i]?.args.at(-1)).toBe('--mode=migrate');
      expect(fake.calls[i]?.args).toContain(serviceEntry(APP_ROOT, svc, 'src').entry);
    }
    expect(fake.calls.some((c) => c.args.some((a) => a.includes('services/gateway/')))).toBe(false);
    // 실패 경로
    const failing = createFake();
    failing.onSpawn = () => (failing.calls.length === 2 ? proc({ exitCode: 78, stderrTail: 'boom' }) : null);
    const error = await migrateHome(
      { appRoot: APP_ROOT, home: HOME, runtime: 'dist', egress: 'off' },
      failing.deps,
    ).catch((e: unknown) => e);
    const failure = stackFailureOf(error);
    expect(failure?.code).toBe('migrate_failed');
    expect(failure?.svc).toBe('ai-gateway');
    expect(failure?.exitCode).toBe(78);
    expect(failure?.stderrTail).toBe('boom');
    expect(failing.calls).toHaveLength(2);
  });

  it('UT-TK-054 사전 검사는 빠진 산출물을 build_missing으로, 기록기 부재를 recorder_missing으로 보고하고 spawn하지 않는다 [NFR-MAINT-011]', async () => {
    // Arrange
    const fake = createFake();
    const supervisorDist = `${APP_ROOT}services/ops/dist/supervisor/main.js`;
    fake.missing.add(supervisorDist);
    // Act
    const distError = await launchStack({ runtime: 'dist', home: HOME, egress: 'off' }, fake.deps).catch(
      (e: unknown) => e,
    );
    // Assert
    const dist = stackFailureOf(distError);
    expect(dist?.code).toBe('build_missing');
    expect(dist?.detail).toContain('services/ops/dist/supervisor/main.js');
    expect(dist?.detail).toContain('pnpm build');
    expect(fake.calls).toHaveLength(0);
    // src는 web dist만 검사한다
    const srcFake = createFake();
    srcFake.missing.add(supervisorDist);
    srcFake.missing.add(`${APP_ROOT}apps/web/dist/index.html`);
    const srcError = await launchStack({ runtime: 'src', home: HOME, egress: 'off' }, srcFake.deps).catch(
      (e: unknown) => e,
    );
    const src = stackFailureOf(srcError);
    expect(src?.code).toBe('build_missing');
    expect(src?.detail).toContain('apps/web/dist/index.html');
    expect(src?.detail).not.toContain('supervisor');
    expect(srcFake.calls).toHaveLength(0);
    // 기록기 파일 없음
    const recFake = createFake();
    recFake.missing.add(new URL('../../../src/preload/egress-recorder.mjs', import.meta.url).pathname);
    recFake.deps = { ...recFake.deps, exists: (p) => Promise.resolve(!p.endsWith('egress-recorder.mjs')) };
    const recError = await launchStack({ runtime: 'src', home: HOME, egress: 'record' }, recFake.deps).catch(
      (e: unknown) => e,
    );
    expect(stackFailureOf(recError)?.code).toBe('recorder_missing');
    expect(recFake.calls).toHaveLength(0);
  });
});
