import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StackService } from '../../../src/spawn-stack.js';
import {
  APP_ROOT,
  allReady,
  cliInvocation,
  parseLock,
  parseRegistry,
  RECORDER_URL,
  serviceEntry,
  stackEnv,
  stackFailureOf,
} from '../../../src/spawn-stack.js';
import { lockJson, registryJson } from './fake-deps.js';

const SERVICE_DIR: Record<StackService, string> = {
  gateway: 'gateway',
  content: 'content',
  learning: 'learning',
  'ai-gateway': 'ai-gateway',
  'ops-api': 'ops',
};

describe('spawn-stack 파서·env·경로', () => {
  it('UT-TK-050 parseRegistry·parseLock은 표본을 통과시키고 미지 키·v:2·잘못된 state를 거부한다 [NFR-MAINT-011][NFR-SEC-003]', () => {
    // Arrange / Act
    const okRegistry = parseRegistry(registryJson());
    const okLock = parseLock(lockJson());
    // Assert
    expect(okRegistry.ok).toBe(true);
    expect(okLock.ok).toBe(true);
    expect(parseRegistry(registryJson({ extra: { self_token: 'a'.repeat(64) } })).ok).toBe(false);
    expect(parseRegistry(registryJson({ extra: { v: 2 } })).ok).toBe(false);
    expect(parseRegistry(registryJson({ services: { gateway: { pid: 1, port: 2, state: 'bogus' } } })).ok).toBe(false);
    expect(parseLock(lockJson({ token: 'x' })).ok).toBe(false);
    expect(parseLock('not json').ok).toBe(false);
    const parsed = parseRegistry(registryJson());
    expect(parsed.ok && allReady(parsed.value)).toBe(true);
    const degraded = parseRegistry(registryJson({ services: { content: { pid: 1, port: 2, state: 'degraded' } } }));
    expect(degraded.ok && allReady(degraded.value)).toBe(false);
  });

  it('UT-TK-051 stackEnv는 allowlist 키 + FATHOM_HOME + NODE_OPTIONS만 만들고 공백 URL은 recorder_missing이다 [NFR-AVL-001][NFR-SEC-003]', () => {
    // Arrange
    const injected: Record<string, string> = {
      PATH: '/usr/bin',
      HOME: '/home/x',
      LANG: 'C',
      ANTHROPIC_API_KEY: 'k',
      CI: '1',
      HTTPS_PROXY: 'http://p',
      FATHOM_EGRESS_MODE: 'block',
      NODE_OPTIONS: '--inspect',
    };
    const env = (name: string): string | undefined => injected[name];
    // Act
    const withRecorder = stackEnv({ home: '/h', recorderUrl: 'file:///r.mjs', env });
    const without = stackEnv({ home: '/h', recorderUrl: null, env });
    // Assert
    expect(withRecorder).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/x',
      LANG: 'C',
      FATHOM_HOME: '/h',
      NODE_OPTIONS: '--import=file:///r.mjs',
    });
    expect(without).toEqual({ PATH: '/usr/bin', HOME: '/home/x', LANG: 'C', FATHOM_HOME: '/h' });
    let code: string | undefined;
    try {
      stackEnv({ home: '/h', recorderUrl: 'file:///a b/r.mjs', env });
    } catch (e) {
      code = stackFailureOf(e)?.code;
    }
    expect(code).toBe('recorder_missing');
    expect(RECORDER_URL.endsWith('/preload/egress-recorder.mjs')).toBe(true);
  });

  it('UT-TK-052 serviceEntry·cliInvocation은 10행 표와 execArgv·CLI 진입을 APP_ROOT 아래 절대 경로로 낸다 [NFR-PERF-008]', () => {
    // Arrange
    const root = path.join(APP_ROOT, path.sep);
    // Act / Assert
    for (const svc of Object.keys(SERVICE_DIR) as StackService[]) {
      const dist = serviceEntry(APP_ROOT, svc, 'dist');
      const src = serviceEntry(APP_ROOT, svc, 'src');
      expect(dist.entry).toBe(path.join(root, 'services', SERVICE_DIR[svc], 'dist', 'main.js'));
      expect(src.entry).toBe(path.join(root, 'services', SERVICE_DIR[svc], 'src', 'main.ts'));
      expect(dist.execArgv).toEqual(['--disable-warning=ExperimentalWarning']);
      expect(src.execArgv).toEqual(['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source']);
      expect(path.isAbsolute(dist.entry) && dist.entry.startsWith(root)).toBe(true);
    }
    const cliDist = cliInvocation(APP_ROOT, 'dist', ['up']);
    const cliSrc = cliInvocation(APP_ROOT, 'src', ['up']);
    expect(cliDist.bin).toBe(process.execPath);
    expect(cliDist.args).toEqual([
      '--disable-warning=ExperimentalWarning',
      path.join(root, 'apps', 'cli', 'bin', 'fathom.mjs'),
      'up',
    ]);
    expect(cliSrc.args.slice(0, 4)).toEqual([
      '--disable-warning=ExperimentalWarning',
      '--import',
      'tsx',
      '--conditions=source',
    ]);
    expect(cliSrc.args.slice(4)).toEqual([path.join(root, 'apps', 'cli', 'src', 'main.ts'), 'up']);
  });
});
