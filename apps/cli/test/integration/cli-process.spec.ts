import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupSandboxes,
  cliEnv,
  entriesArg,
  isAlive,
  lockPid,
  makeSandbox,
  runCli,
  spawnCli,
  waitFor,
} from './harness.js';

afterEach(cleanupSandboxes);

const T = ['--profile=test'];

describe('fathom CLI (진짜 CLI → 진짜 supervisor → fixture 서비스)', () => {
  it('IT-610 up --profile=test --no-open → exit 0·lock 생존·stdout URL에 #bt= 0 [FR-SET-001][FR-SET-015]', async () => {
    const box = await makeSandbox();
    const r = await runCli(['up', ...T, '--no-open', entriesArg(box)], cliEnv(box));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Fathom 실행 중: http:\/\/127\.0\.0\.1:\d+\//);
    expect(`${r.stdout}${r.stderr}`).not.toContain('#bt=');
    const pid = lockPid(box);
    expect(pid).not.toBeNull();
    expect(isAlive(pid ?? 0)).toBe(true);
  });

  it('IT-611 실행 중 up 재호출 → supervisor pid 불변·exit 0 [FR-SET-001]', async () => {
    const box = await makeSandbox();
    expect((await runCli(['up', ...T, '--no-open', entriesArg(box)], cliEnv(box))).code).toBe(0);
    const before = lockPid(box);
    const again = await runCli(['up', ...T, '--no-open', entriesArg(box)], cliEnv(box));
    expect(again.code).toBe(0);
    expect(lockPid(box)).toBe(before);
  });

  it('IT-612 status → 0 표시, status --json → 한 줄 JSON 파싱 가능 [FR-SET-015]', async () => {
    const box = await makeSandbox();
    await runCli(['up', ...T, '--no-open', entriesArg(box)], cliEnv(box));
    const human = await runCli(['status', ...T], cliEnv(box));
    expect(human.code).toBe(0);
    expect(human.stdout).toContain('Fathom 실행 중');
    const json = await runCli(['status', ...T, '--json'], cliEnv(box));
    expect(json.code).toBe(0);
    const lines = json.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ profile: 'test' });
  });

  it('IT-613 open --no-open → bootstrap-token 201 경로 exit 0, 꺼진 상태 open --no-open --profile=test → 기동 후 0 [FR-SET-023]', async () => {
    const box = await makeSandbox();
    const cold = await runCli(['open', ...T, '--no-open', entriesArg(box)], cliEnv(box)); // UC-36: 꺼져 있으면 기동
    expect(cold.code).toBe(0);
    expect(lockPid(box)).not.toBeNull();
    const warm = await runCli(['open', ...T, '--no-open'], cliEnv(box));
    expect(warm.code).toBe(0);
    expect(`${warm.stdout}${warm.stderr}`).not.toContain('#bt=');
  });

  it('IT-614 down(fake gateway /cli/shutdown 404) → SIGTERM 폴백 → supervisor 정상 종료·lock 삭제·잔존 pid 0·exit 0 [FR-SET-015][NFR-AVL-003]', async () => {
    const box = await makeSandbox();
    await runCli(['up', ...T, '--no-open', entriesArg(box)], cliEnv(box));
    const sup = lockPid(box) ?? 0;
    const reg = JSON.parse(await readFile(path.join(box.home, 'run', 'registry.json'), 'utf8')) as {
      services: Record<string, { pid: number }>;
    };
    const pids = [sup, ...Object.values(reg.services).map((s) => s.pid)];
    const r = await runCli(['down', ...T], cliEnv(box));
    expect(r.code).toBe(0);
    expect(lockPid(box)).toBeNull();
    for (const p of pids) {
      expect(isAlive(p)).toBe(false);
    }
  });

  it('IT-615 꺼진 상태 down → 0, status → 3 + stderr CLI-DEP-001 [FR-SET-015]', async () => {
    const box = await makeSandbox();
    expect((await runCli(['down', ...T], cliEnv(box))).code).toBe(0);
    const status = await runCli(['status', ...T], cliEnv(box));
    expect(status.code).toBe(3);
    expect(status.stderr).toContain('CLI-DEP-001');
  });

  it('IT-616 실행 중 run/cli.token 삭제 후 open --no-open → 4 + CLI-AUTH-001 [NFR-SEC-019]', async () => {
    const box = await makeSandbox();
    await runCli(['up', ...T, '--no-open', entriesArg(box)], cliEnv(box));
    await rm(path.join(box.home, 'run', 'cli.token'));
    const r = await runCli(['open', ...T, '--no-open'], cliEnv(box));
    expect(r.code).toBe(4);
    expect(r.stderr).toContain('CLI-AUTH-001');
  });

  it('IT-617 content fixture --fx-exit=78 → up exit 3·stderr에 원인 reason·doctor 안내 [FR-SET-002]', async () => {
    const box = await makeSandbox({ content: ['--fx-exit=78'] });
    const r = await runCli(['up', ...T, '--no-open', entriesArg(box)], cliEnv(box));
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('exit_78:fx_schema_needs_migrate');
    expect(r.stderr).toContain('fathom doctor');
    expect(r.stderr).toContain('CLI-DEP-001');
  });

  it('IT-618 up --foreground --no-open → ready 출력 후 대기, supervisor에 SIGTERM → CLI exit 0 [FR-SET-001][AP-12]', async () => {
    const box = await makeSandbox();
    const child = spawnCli(['up', ...T, '--foreground', '--no-open', entriesArg(box)], cliEnv(box));
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      stdout += c;
    });
    child.stderr?.resume();
    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code));
    });
    await waitFor('ready banner', () => (stdout.includes('Fathom 실행 중') ? true : null));
    const sup = await waitFor('lock pid', () => lockPid(box));
    expect(child.exitCode).toBeNull(); // 대기 중
    process.kill(sup, 'SIGTERM');
    expect(await exited).toBe(0);
  });

  it('IT-619 up --profile=test 인자 없음(FATHOM_HOME 미설정) → 2, fathom bogus → 2 [FR-SET-015]', async () => {
    const box = await makeSandbox();
    const env = cliEnv(box);
    const { FATHOM_HOME: _removed, ...bare } = env;
    const noHome = await runCli(['up', ...T, '--no-open'], bare);
    expect(noHome.code).toBe(2);
    expect(noHome.stderr).toContain('CLI-VAL-001');
    const bogus = await runCli(['bogus'], env);
    expect(bogus.code).toBe(2);
    expect(bogus.stderr).toContain('CLI-VAL-001');
  });
});
