import { createFakeClock } from '@fathom/testkit/clock';
import { describe, expect, it } from 'vitest';
import { createService } from '../../../src/service/boot.js';
import { parseModeArgs } from '../../../src/service/modes.js';
import { defOf } from './support.js';
import { fakePort, lines } from './support-boot.js';

describe('parseModeArgs', () => {
  it('UT-SK-171 --mode 없음 = serve·모드별 허용 키·절대 경로·JSON 검증 [FR-SET-002]', () => {
    // Arrange / Act / Assert
    expect(parseModeArgs([])).toEqual({ ok: true, value: { mode: 'serve' } });
    expect(parseModeArgs(['--mode=serve'])).toEqual({ ok: true, value: { mode: 'serve' } });
    expect(parseModeArgs(['--mode=migrate', '--dry-run', '--db-copy-dir=/tmp/x'])).toEqual({
      ok: true,
      value: { mode: 'migrate', dryRun: true, dbCopyDir: '/tmp/x' },
    });
    expect(parseModeArgs(['--mode=migrate'])).toEqual({
      ok: true,
      value: { mode: 'migrate', dryRun: false, dbCopyDir: null },
    });
    expect(parseModeArgs(['--mode=verify', '--replay'])).toEqual({
      ok: true,
      value: { mode: 'verify', replay: true, dbCopyDir: null },
    });
    expect(parseModeArgs(['--mode=job', '--job=integrity'])).toEqual({
      ok: true,
      value: { mode: 'job', job: 'integrity' },
    });
    expect(parseModeArgs(['--mode=restore', '--from=/tmp/snap', '--rewind-cursors={"learning":5}'])).toEqual({
      ok: true,
      value: { mode: 'restore', from: '/tmp/snap', rewind: { learning: 5 } },
    });
    expect(parseModeArgs(['--mode=restore', '--from=/tmp/snap'])).toMatchObject({ ok: true, value: { rewind: {} } });
    const bad: string[][] = [
      ['--mode=bogus'],
      ['--mode'],
      ['--bogus=1'],
      ['--dry-run'], // serve에는 없는 키
      ['--mode=migrate', '--from=/x'],
      ['--mode=migrate', '--dry-run=yes'],
      ['--mode=migrate', '--db-copy-dir=relative/dir'],
      ['--mode=migrate', '--mode=serve'],
      ['--mode=job'],
      ['--mode=job', '--job=nope'],
      ['--mode=restore'],
      ['--mode=restore', '--from=rel'],
      ['--mode=restore', '--from=/x', '--rewind-cursors=not-json'],
      ['--mode=restore', '--from=/x', '--rewind-cursors={"nobody":1}'],
      ['--mode=restore', '--from=/x', '--rewind-cursors={"learning":-1}'],
      ['positional'],
      ['-x'],
    ];
    for (const argv of bad) {
      expect(parseModeArgs(argv).ok, argv.join(' ')).toBe(false);
    }
  });
});

describe('createService 모드 분기', () => {
  const clock = createFakeClock();
  const go = (argv: string[], def = defOf('content', { databases: [] })) => {
    const port = fakePort({ argv, hasIpc: false });
    const chunks: string[] = [];
    return {
      port,
      chunks,
      result: createService(def, {
        process: port.port,
        clock,
        logDestination: { write: (c: string) => void chunks.push(c) },
      }),
    };
  };

  it('UT-SK-171 모르는 모드·키 → 64(로그 mode.args.invalid), IPC가 없으면 fatal 송신 생략 [FR-SET-002]', async () => {
    for (const argv of [['--mode=bogus'], ['--nope']]) {
      // Arrange / Act
      const { port, chunks, result } = go(argv);
      // Assert
      expect(await result).toEqual({ kind: 'exited', code: 64 });
      expect(port.exits).toEqual([64]);
      expect(port.sent).toEqual([]);
      expect(lines(chunks)[0]).toMatchObject({ event: 'mode.args.invalid', level: 'error', svc: 'content' });
    }
  });

  it('UT-SK-171 verify 훅 없음 → 64 mode_unsupported, 있으면 그 반환 코드 [FR-SET-002]', async () => {
    // Arrange / Act / Assert
    const none = go(['--mode=verify']);
    expect(await none.result).toEqual({ kind: 'exited', code: 64 });
    expect(lines(none.chunks).some((l) => l.msg === 'mode_unsupported')).toBe(true);
    const seen: unknown[] = [];
    const hooked = go(['--mode=verify', '--replay'], {
      ...defOf('content', { databases: [] }),
      verify: (ctx) => {
        seen.push({ replay: ctx.replay, svc: ctx.svc, dbCopyDir: ctx.dbCopyDir });
        return Promise.resolve(3);
      },
    });
    expect(await hooked.result).toEqual({ kind: 'exited', code: 3 });
    expect(seen).toEqual([{ replay: true, svc: 'content', dbCopyDir: null }]);
    expect(hooked.port.exits).toEqual([3]);
  });

  it('UT-SK-171 --mode 없음 = serve(IPC 없음 → 78) [FR-SET-002]', async () => {
    const { port, result } = go([]);
    expect(await result).toEqual({ kind: 'exited', code: 78 });
    expect(port.exits).toEqual([78]);
  });
});
