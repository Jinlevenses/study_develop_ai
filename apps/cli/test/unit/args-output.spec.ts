import { describe, expect, it } from 'vitest';
import { parseArgs, usage } from '../../src/lib/args.js';
import { CLI_CODES, EXIT, exitForProblemCode } from '../../src/lib/exit-codes.js';
import { createOutput } from '../../src/lib/output.js';
import { run } from '../../src/run.js';
import { createFakeEnv, SENTINEL, stderrText, stdoutText } from './fakes.js';

describe('종료 코드 · 인자 · 출력', () => {
  it('UT-CLI-001 EXIT 8개·CLI_CODES 3개 ↔ IF-01 §2.6.3, exitForProblemCode 매핑 [FR-SET-015][IR-014]', () => {
    expect(EXIT).toEqual({
      OK: 0,
      FAILED: 1,
      USAGE: 2,
      NOT_RUNNING: 3,
      AUTH: 4,
      CONFLICT: 5,
      VALIDATION: 6,
      PARTIAL: 7,
    });
    expect(Object.keys(EXIT)).toHaveLength(8);
    expect(CLI_CODES).toEqual({
      'CLI-DEP-001': { exit: 3, title: '앱이 실행 중이 아닙니다' },
      'CLI-AUTH-001': { exit: 4, title: 'CLI 토큰을 읽을 수 없습니다' },
      'CLI-VAL-001': { exit: 2, title: '사용법 오류' },
    });
    expect(exitForProblemCode('GW-AUTH-007')).toBe(4);
    expect(exitForProblemCode('OP-CONFLICT-010')).toBe(5);
    expect(exitForProblemCode('LR-VAL-010')).toBe(6);
    expect(exitForProblemCode('GW-DEP-001')).toBe(1);
    expect(exitForProblemCode('CLI-VAL-001')).toBe(2);
    expect(exitForProblemCode('CLI-DEP-001')).toBe(3);
    expect(exitForProblemCode('CLI-AUTH-001')).toBe(4);
    expect(exitForProblemCode('CLI-XXX-999')).toBe(1);
  });

  it('UT-CLI-010 명령별 --help·help <명령> → 사용법 출력 exit 0(명령 실행 0) [FR-SET-015]', async () => {
    for (const argv of [
      ['--help'],
      ['help'],
      ['up', '--help'],
      ['down', '--help'],
      ['status', '--help'],
      ['open', '--help'],
      ['help', 'up'],
    ]) {
      const f = createFakeEnv();
      expect(await run(argv, f.deps), argv.join(' ')).toBe(0);
      expect(stdoutText(f)).toContain('fathom');
      expect(f.launches).toHaveLength(0);
      expect(f.gatewayCalls).toHaveLength(0);
    }
    expect(usage('up')).toContain('--safe');
    expect(parseArgs(['up', '--help'])).toEqual({ ok: true, value: { kind: 'help', command: 'up' } });
  });

  it('UT-CLI-011 인자 없음 → 사용법(stdout) + 2, 모르는 명령·옵션·값 → CLI-VAL-001 + 2 [FR-SET-015]', async () => {
    const none = createFakeEnv();
    expect(await run([], none.deps)).toBe(2);
    expect(stdoutText(none)).toContain('사용법');
    for (const argv of [
      ['bogus'],
      ['up', '--bogus'],
      ['up', '--profile=staging'],
      ['up', '--safe=1'],
      ['up', '--log-level=trace'],
      ['down', '--safe'],
      ['status', 'extra'],
      ['up', '--no-open', '--no-open'],
      ['up', '--profile'],
    ]) {
      const f = createFakeEnv();
      expect(await run(argv, f.deps), argv.join(' ')).toBe(2);
      expect(stderrText(f)).toContain('CLI-VAL-001');
      expect(f.launches).toHaveLength(0);
    }
  });

  it('UT-CLI-012 --entries는 prod/dev·상대 경로에서 2, test + 절대 경로만 허용 [FR-SET-015]', async () => {
    for (const argv of [
      ['up', '--entries=/e.json'],
      ['up', '--profile=dev', '--entries=/e.json'],
      ['up', '--profile=test', '--entries=e.json'],
      ['open', '--entries=/e.json'],
    ]) {
      const f = createFakeEnv();
      expect(await run(argv, f.deps), argv.join(' ')).toBe(2);
      expect(stderrText(f)).toContain('CLI-VAL-001');
    }
    expect(parseArgs(['up', '--profile=test', '--entries=/e.json'])).toMatchObject({
      ok: true,
      value: { kind: 'up', entries: '/e.json', profile: 'test' },
    });
    expect(parseArgs(['open', '--profile=test', '--entries=/e.json', '--no-open'])).toMatchObject({
      ok: true,
      value: { kind: 'open', noOpen: true },
    });
  });

  it('UT-CLI-013 --version → app_version + 0 [FR-SET-015]', async () => {
    const f = createFakeEnv();
    expect(await run(['--version'], f.deps)).toBe(0);
    expect(stdoutText(f)).toBe('1.2.3\n');
    const bad = createFakeEnv();
    bad.files.set('/app/package.json', JSON.stringify({ version: 'x' }));
    expect(await run(['--version'], bad.deps)).toBe(0);
    expect(stdoutText(bad)).toBe('0.0.0\n');
  });

  it('UT-CLI-014 미래 명령(doctor·backup …) → "아직 지원하지 않는 명령" 2 [FR-SET-015]', async () => {
    for (const cmd of ['doctor', 'backup', 'restore', 'export', 'import']) {
      const f = createFakeEnv();
      expect(await run([cmd], f.deps)).toBe(2);
      expect(stderrText(f)).toContain('아직 지원하지 않는 명령');
    }
  });

  it('UT-CLI-015 --json이면 stdout JSON 정확히 1개·사람용 문장 0 [STD-LOG-40][NFR-SEC-019]', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const out = createOutput({
      stdout: { write: (s) => void stdout.push(s) },
      stderr: { write: (s) => void stderr.push(s) },
      json: true,
    });
    out.info('사람용 문장');
    out.result({ status: 'running', n: 1 });
    expect(stdout).toEqual(['{"status":"running","n":1}\n']);
    const human = createOutput({
      stdout: { write: (s) => void stdout.push(s) },
      stderr: { write: (s) => void stderr.push(s) },
      json: false,
    });
    human.result({ ignored: true });
    human.info('안녕');
    expect(stdout.at(-1)).toBe('안녕\n');
    expect(stdout).toHaveLength(2);
  });

  it('UT-CLI-016 오류는 stderr: 오류 [code] title (+ error_id) [STD-LOG-40][NFR-SEC-019]', () => {
    const stderr: string[] = [];
    const out = createOutput({
      stdout: { write: () => undefined },
      stderr: { write: (s) => void stderr.push(s) },
      json: false,
    });
    out.error({ code: 'GW-AUTH-007', title: 'CLI 인증에 실패했습니다', error_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    out.error({ code: 'CLI-DEP-001', title: '앱이 실행 중이 아닙니다' });
    expect(stderr).toEqual([
      '오류 [GW-AUTH-007] CLI 인증에 실패했습니다 (error_id: 01HZZZZZZZZZZZZZZZZZZZZZZZ)\n',
      '오류 [CLI-DEP-001] 앱이 실행 중이 아닙니다\n',
    ]);
  });

  it('UT-CLI-017 #bt= 포함 문자열 출력 시 invariant — 센티널 토큰은 stdout·stderr 어디에도 0 [STD-LOG-40][NFR-SEC-019]', () => {
    const written: string[] = [];
    const w = { write: (s: string): void => void written.push(s) };
    const out = createOutput({ stdout: w, stderr: w, json: true });
    const secret = `http://127.0.0.1:4747/#bt=${SENTINEL}`;
    expect(() => out.info(secret)).toThrow('invariant');
    expect(() => out.warn(secret)).toThrow('invariant');
    expect(() => out.result({ open_url: secret })).toThrow('invariant');
    expect(() => out.error({ code: 'X', title: secret })).toThrow('invariant');
    expect(written.join('')).not.toContain(SENTINEL);
  });
});
