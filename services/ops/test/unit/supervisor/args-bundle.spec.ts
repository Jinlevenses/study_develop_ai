import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSupervisorArgs } from '../../../src/supervisor/args.js';
import { parseEntriesFile, readBundleInfo, resolveEntries } from '../../../src/supervisor/bundle.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'fathom-bundle-'));
  dirs.push(d);
  return d;
}
const FLAG = '--disable-warning=ExperimentalWarning';

describe('args · bundle · entries', () => {
  it('UT-SUP-010 args: 필수(--profile·--home) 누락 → 실패, 기본값(runtime dist·log-level info) [FR-SET-001]', () => {
    expect(parseSupervisorArgs([])).toEqual({ ok: false, error: { reason: 'profile_required' } });
    expect(parseSupervisorArgs(['--profile=prod'])).toMatchObject({ ok: false });
    const ok = parseSupervisorArgs(['--profile=prod', '--home=/data/f']);
    expect(ok).toEqual({
      ok: true,
      value: {
        profile: 'prod',
        home: '/data/f',
        runtime: 'dist',
        safe: false,
        foreground: false,
        logLevel: 'info',
        entries: null,
      },
    });
    const all = parseSupervisorArgs([
      '--profile=dev',
      '--home=/h',
      '--runtime=src',
      '--safe',
      '--foreground',
      '--log-level=debug',
    ]);
    expect(all).toMatchObject({ ok: true, value: { runtime: 'src', safe: true, foreground: true, logLevel: 'debug' } });
  });

  it('UT-SUP-011 args: 모르는 키·중복·상대 경로·값 형식 오류 → 실패 [FR-SET-001]', () => {
    const base = ['--profile=prod', '--home=/h'];
    expect(parseSupervisorArgs([...base, '--bogus=1'])).toMatchObject({
      ok: false,
      error: { reason: 'unknown:bogus' },
    });
    expect(parseSupervisorArgs([...base, '--safe', '--safe'])).toMatchObject({ ok: false });
    expect(parseSupervisorArgs(['--profile=prod', '--home=relative/dir'])).toMatchObject({ ok: false });
    expect(parseSupervisorArgs([...base, '--runtime=bun'])).toMatchObject({ ok: false });
    expect(parseSupervisorArgs([...base, '--safe=1'])).toMatchObject({ ok: false });
    expect(parseSupervisorArgs([...base, 'profile=x'])).toMatchObject({ ok: false });
    expect(parseSupervisorArgs([...base, '--log-level=trace'])).toMatchObject({ ok: false });
  });

  it('UT-SUP-012 args: --entries는 profile test + 절대 경로에서만 허용 [FR-SET-001][AP-12]', () => {
    for (const profile of ['prod', 'dev']) {
      expect(parseSupervisorArgs([`--profile=${profile}`, '--home=/h', '--entries=/e.json'])).toMatchObject({
        ok: false,
      });
    }
    expect(parseSupervisorArgs(['--profile=test', '--home=/h', '--entries=e.json'])).toMatchObject({ ok: false });
    expect(parseSupervisorArgs(['--profile=test', '--home=/h', '--entries=/e.json'])).toMatchObject({
      ok: true,
      value: { entries: '/e.json' },
    });
  });

  it('UT-SUP-013 bundle: version 읽기·SemVer 아님 → 0.0.0, 스냅샷 해시는 결정적·디렉터리 없음 폴백 [FR-SET-001][NFR-MAINT-006]', async () => {
    const root = await tmp();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }));
    const a = await readBundleInfo(root, 'src');
    expect(a).toMatchObject({ appRoot: root, runtime: 'src', appVersion: '2.3.4' });
    expect(a.contractsHash).toMatch(/^[0-9a-f]{64}$/);
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: 'not-semver' }));
    expect((await readBundleInfo(root, 'dist')).appVersion).toBe('0.0.0');
    const empty = await tmp();
    expect((await readBundleInfo(empty, 'dist')).appVersion).toBe('0.0.0');

    const snaps = path.join(root, 'packages', 'contracts', '.snapshots');
    await mkdir(snaps, { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '2.3.4' }));
    const noSnapshots = (await readBundleInfo(root, 'src')).contractsHash;
    await writeFile(path.join(snaps, 'b.json'), '{"b":1}');
    await writeFile(path.join(snaps, 'a.json'), '{"a":1}');
    const first = (await readBundleInfo(root, 'src')).contractsHash;
    expect(first).not.toBe(noSnapshots);
    expect((await readBundleInfo(root, 'dist')).contractsHash).toBe(first); // runtime·읽기 순서와 무관
    await writeFile(path.join(snaps, 'a.json'), '{"a":2}');
    expect((await readBundleInfo(root, 'src')).contractsHash).not.toBe(first);
  });

  it('UT-SUP-014 entries: src/dist execArgv·ops-api → services/ops·vite는 dev만·--entries 대체와 args 덧붙임 [FR-SET-001][AP-12]', () => {
    const src = resolveEntries('/app', 'src', 'prod');
    expect(src['ops-api']).toEqual({
      entry: '/app/services/ops/src/main.ts',
      execArgv: [FLAG, '--import', 'tsx', '--conditions=source'],
      args: [],
      cwd: '/app',
    });
    expect(src.gateway?.entry).toBe('/app/services/gateway/src/main.ts');
    expect(src['ai-gateway']?.entry).toBe('/app/services/ai-gateway/src/main.ts');
    const dist = resolveEntries('/app', 'dist', 'test');
    expect(dist.content).toMatchObject({ entry: '/app/services/content/dist/main.js', execArgv: [FLAG] });
    expect(dist.vite).toBeUndefined();
    expect(resolveEntries('/app', 'src', 'prod').vite).toBeUndefined();
    expect(resolveEntries('/app', 'src', 'dev').vite).toEqual({
      entry: '/app/apps/web/node_modules/vite/bin/vite.js',
      execArgv: [FLAG],
      args: ['--host', '127.0.0.1', '--port', '5173', '--strictPort'],
      cwd: '/app/apps/web',
    });
    const parsed = parseEntriesFile(
      JSON.stringify({
        content: { entry: '/fx/fake.ts', execArgv: ['--x'], args: ['--fx-a'] },
        learning: { entry: '/fx/l.ts' },
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        content: { entry: '/fx/fake.ts', execArgv: ['--x'], args: ['--fx-a'] },
        learning: { entry: '/fx/l.ts', execArgv: [], args: [] },
      },
    });
    expect(parseEntriesFile('{"content":{"entry":"rel.ts"}}')).toMatchObject({ ok: false });
    expect(parseEntriesFile('{"nope":{"entry":"/a.ts"}}')).toMatchObject({ ok: false });
    expect(parseEntriesFile('{"content":{"entry":"/a.ts","extra":1}}')).toMatchObject({ ok: false });
    expect(parseEntriesFile('not json')).toMatchObject({ ok: false });
  });
});
