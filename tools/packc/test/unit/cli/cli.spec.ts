// UT-PACKC-004·043·044·094~099 — CLI: 종료 코드 · 출력 형식 · --json/--pack/--only · 엔트리 · 인자 · stderr · 소스 규약 · 시계.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '../../../src/validate/finding.js';
import { compareFindings } from '../../../src/validate/finding.js';
import type { Mutation } from './helpers.js';
import { FIXTURES, lines, mutatedTree, PACKC_ROOT, REPO_POLICY, rmTmp, run, tmpRoot } from './helpers.js';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const r of roots.splice(0)) {
    rmTmp(r);
  }
});
function tree(m: Mutation = {}): { root: string; contentDir: string } {
  const t = mutatedTree(m);
  roots.push(t.root);
  return t;
}
function tmp(): string {
  const r = tmpRoot();
  roots.push(r);
  return r;
}

const PROBES = 'content/packs/k8s/concepts/k8s.probes.md';

describe('UT-PACKC-004 exit codes [NFR-MAINT-005]', () => {
  it('UT-PACKC-004 a valid tree is 0 and a violation is 1 [NFR-MAINT-005]', () => {
    const ok = tree();
    expect(run(['check', '--content-dir', ok.contentDir]).code).toBe(0);
    const bad = tree({ replace: [{ file: PROBES, from: 'required_for_level: 2', to: 'required_for_level: null' }] });
    expect(run(['check', '--content-dir', bad.contentDir]).code).toBe(1);
    const warnOnly = tree();
    expect(run(['check', '--content-dir', warnOnly.contentDir]).stdout).toContain('warn R-POOL');
  });

  it('UT-PACKC-004 engine failures are 2 and write nothing [NFR-MAINT-005]', () => {
    const root = tmp();
    const out = join(root, 'out');
    const cases: { name: string; argv: string[] }[] = [];
    const missing = join(root, 'missing');
    cases.push({ name: 'content dir missing', argv: ['build', '--content-dir', missing, '--out-dir', out] });
    mkdirSync(join(root, 'nopacks'), { recursive: true });
    writeFileSync(join(root, 'nopacks', 'README.md'), 'x');
    cases.push({ name: 'packs/ missing', argv: ['build', '--content-dir', join(root, 'nopacks'), '--out-dir', out] });
    mkdirSync(join(root, 'nopackdirs/packs'), { recursive: true });
    cases.push({
      name: 'no pack directories',
      argv: ['build', '--content-dir', join(root, 'nopackdirs'), '--out-dir', out],
    });
    mkdirSync(join(root, 'emptypack/packs/docker'), { recursive: true });
    cases.push({
      name: 'zero scanned files',
      argv: ['build', '--content-dir', join(root, 'emptypack'), '--out-dir', out],
    });
    const t = tree();
    mkdirSync(join(root, 'nopolicy'), { recursive: true });
    cases.push({
      name: 'policy missing',
      argv: ['build', '--content-dir', t.contentDir, '--policy-dir', join(root, 'nopolicy'), '--out-dir', out],
    });
    cases.push({ name: 'unknown subcommand', argv: ['frobnicate'] });
    cases.push({ name: 'no subcommand', argv: [] });
    cases.push({
      name: 'unknown argument',
      argv: ['build', '--content-dir', t.contentDir, '--out-dir', out, '--nope'],
    });
    cases.push({
      name: 'argument of another subcommand',
      argv: ['build', '--content-dir', t.contentDir, '--out-dir', out, '--only', 'V1'],
    });
    cases.push({
      name: 'unknown pack',
      argv: ['build', '--content-dir', t.contentDir, '--out-dir', out, '--pack', 'nope'],
    });
    cases.push({ name: 'missing value', argv: ['build', '--content-dir'] });
    cases.push({ name: 'bad --only', argv: ['check', '--content-dir', t.contentDir, '--only', 'V9'] });
    for (const c of cases) {
      const r = run(c.argv);
      expect(r.code, c.name).toBe(2);
      expect(r.stdout, c.name).toBe('');
      expect(existsSync(out), c.name).toBe(false);
    }
  });

  it('UT-PACKC-004 a violation never writes a pack (exit 1, no output directory) [NFR-MAINT-005]', () => {
    const t = tree({ replace: [{ file: PROBES, from: 'required_for_level: 2', to: 'required_for_level: null' }] });
    const out = join(t.root, 'dist');
    const r = run(['build', '--content-dir', t.contentDir, '--out-dir', out]);
    expect(r.code).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(lines(r.stdout).at(-1)).toMatch(/^packs:build packs=2 written=0 errors=1$/);
  });
});

describe('UT-PACKC-043 output format [NFR-MAINT-005]', () => {
  it('UT-PACKC-043 finding lines are sorted and the last line is the summary [NFR-MAINT-005]', () => {
    const t = tree({
      replace: [
        { file: PROBES, from: 'required_for_level: 2', to: 'required_for_level: null' },
        { file: PROBES, from: 'aliases: ["Probes", "헬스 체크"]', to: 'aliases: ["헬스 체크"]' },
        {
          file: 'content/packs/docker/concepts/docker.image-layer.md',
          from: 'prereqs: []',
          to: 'prereqs: [docker.dev-environment]',
        },
      ],
    });
    const r = run(['check', '--content-dir', t.contentDir]);
    expect(r.code).toBe(1);
    const all = lines(r.stdout);
    const summary = all.pop() ?? '';
    expect(summary).toBe('content:check packs=2 files=23 errors=2 warnings=3');
    const re = /^(error|warn|info) ([A-Za-z0-9-]+) (\S+?)(?:#(\S+))? (.+)$/;
    for (const l of all) {
      expect(re.test(l), l).toBe(true);
    }
    const parsed: Finding[] = all.map((l) => {
      const m = re.exec(l);
      return {
        severity: m?.[1] === 'error' || m?.[1] === 'warn' ? m[1] : 'info',
        rule: m?.[2] ?? '',
        file: m?.[3] ?? '',
        keypath: m?.[4] ?? '',
        message: m?.[5] ?? '',
      };
    });
    expect([...parsed].sort(compareFindings)).toEqual(parsed);
    expect(all).toContain(
      'error R-REQ packs/k8s/concepts/k8s.probes.md#required_for_level Tier B must have required_for_level = level (2)',
    );
    expect(all.some((l) => l.startsWith('warn R-LVL packs/docker/concepts/docker.image-layer.md#prereqs.0 '))).toBe(
      true,
    );
  });

  it('UT-PACKC-043 sorting is by code unit, not locale [NFR-MAINT-005]', () => {
    const a: Finding = { rule: 'R-A', severity: 'error', file: 'B', keypath: '', message: 'm' };
    const b: Finding = { rule: 'R-A', severity: 'error', file: 'a', keypath: '', message: 'm' };
    expect([a, b].sort(compareFindings)).toEqual([a, b]);
  });
});

describe('UT-PACKC-044 --json, --pack, --only [NFR-MAINT-005]', () => {
  it('UT-PACKC-044 --json is one line with ok, exit, findings and summary [NFR-MAINT-005]', () => {
    const t = tree({ replace: [{ file: PROBES, from: 'required_for_level: 2', to: 'required_for_level: null' }] });
    const r = run(['check', '--content-dir', t.contentDir, '--json']);
    expect(r.stdout.endsWith('\n')).toBe(true);
    expect(lines(r.stdout)).toHaveLength(1);
    const out = JSON.parse(r.stdout);
    expect(Object.keys(out).sort()).toEqual(['exit', 'findings', 'ok', 'summary']);
    expect(out).toMatchObject({ ok: false, exit: 1, summary: { packs: 2, files: 23, errors: 1, warnings: 2 } });
    expect(
      out.findings.every(
        (f: Record<string, unknown>) => Object.keys(f).sort().join() === 'file,keypath,message,rule,severity',
      ),
    ).toBe(true);
    const ok = JSON.parse(run(['check', '--content-dir', tree().contentDir, '--json']).stdout);
    expect(ok).toMatchObject({ ok: true, exit: 0 });
  });

  it('UT-PACKC-044 --pack limits the report to the selected packs plus common files; the whole tree is still loaded [NFR-MAINT-005]', () => {
    const t = tree({
      replace: [
        { file: PROBES, from: 'required_for_level: 2', to: 'required_for_level: null' },
        {
          file: 'content/packs/docker/concepts/docker.image-layer.md',
          from: 'prereqs: []',
          to: 'prereqs: [docker.dev-environment]',
        },
      ],
    });
    const docker = JSON.parse(run(['check', '--content-dir', t.contentDir, '--pack', 'docker', '--json']).stdout);
    expect(docker.exit).toBe(0);
    expect(docker.summary.packs).toBe(1);
    expect(docker.findings.every((f: { file: string }) => !f.file.startsWith('packs/k8s/'))).toBe(true);
    const k8s = JSON.parse(run(['check', '--content-dir', t.contentDir, '--pack', 'k8s', '--json']).stdout);
    expect(k8s.exit).toBe(1);
    expect(k8s.findings.every((f: { file: string }) => !f.file.startsWith('packs/docker/'))).toBe(true);
    const both = JSON.parse(
      run(['check', '--content-dir', t.contentDir, '--pack', 'docker', '--pack', 'k8s', '--json']).stdout,
    );
    expect(both.summary.packs).toBe(2);
    expect(both.exit).toBe(1);
    // 교차 팩 선수 간선(k8s.pod -> docker.dockerfile)은 k8s 한정 검사에서도 해석된다.
    expect(
      k8s.findings.some((f: { rule: string; severity: string }) => f.rule === 'R-REF' && f.severity === 'error'),
    ).toBe(false);
  });

  it('UT-PACKC-044 --only filters V2 and V7 findings; V1 findings are always reported [NFR-MAINT-005]', () => {
    const stale = tree({
      replace: [
        {
          file: 'content/packs/docker/items/docker.dockerfile.yaml',
          from: '  i01:\n    format: ox\n',
          to: '  i01:\n    format: ox\n    tags: ["qa:security"]\n',
        },
      ],
    });
    const rules = (only: string[]): string[] => {
      const args = only.length === 0 ? [] : ['--only', only.join(',')];
      const out = JSON.parse(run(['check', '--content-dir', stale.contentDir, '--json', ...args]).stdout);
      return [...new Set<string>(out.findings.map((f: { rule: string }) => f.rule))].sort();
    };
    expect(rules([])).toEqual(['R-POOL', 'V7']);
    expect(rules(['V1'])).toEqual([]);
    expect(rules(['V2'])).toEqual(['R-POOL']);
    expect(rules(['V7'])).toEqual(['V7']);
    expect(rules(['V2', 'V7'])).toEqual(['R-POOL', 'V7']);
    const broken = tree({
      replace: [
        {
          file: 'content/packs/docker/pack.yaml',
          from: 'content_license: repo',
          to: 'content_license: repo\nbogus: 1',
        },
      ],
    });
    const v1 = JSON.parse(run(['check', '--content-dir', broken.contentDir, '--json', '--only', 'V2']).stdout);
    expect(v1.exit).toBe(1);
    expect(v1.findings.some((f: { rule: string }) => f.rule === 'V1')).toBe(true);
  });

  it('UT-PACKC-044 build prints the build summary and --json for build [NFR-MAINT-005]', () => {
    const t = tree();
    const out = join(t.root, 'dist/packs');
    const r = run(['build', '--content-dir', t.contentDir, '--out-dir', out, '--json']);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, exit: 0, summary: { packs: 2, written: 2, errors: 0 } });
    expect(readdirSync(out).sort()).toEqual(['docker@0.1.0.fpack', 'k8s@0.1.0.fpack']);
  });
});

describe('UT-PACKC-094 entry [NFR-MAINT-005]', () => {
  it('UT-PACKC-094 importing the module has no side effects; the entry guard compares import.meta.url with argv[1] [NFR-MAINT-005]', async () => {
    const code = process.exitCode;
    const o = vi.spyOn(process.stdout, 'write');
    const e = vi.spyOn(process.stderr, 'write');
    vi.resetModules();
    const mod = await import('../../../src/cli.js');
    expect(typeof mod.main).toBe('function');
    expect(o).not.toHaveBeenCalled();
    expect(e).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(code);
    const src = readFileSync(join(PACKC_ROOT, 'src/cli.ts'), 'utf8');
    expect(src).toContain("import.meta.url === pathToFileURL(process.argv[1] ?? '').href");
    expect(src).toContain('process.exitCode = main(process.argv.slice(2))');
  });
});

describe('UT-PACKC-095 argv handling [NFR-MAINT-005]', () => {
  it('UT-PACKC-095 a leading -- is ignored; --pack accepts comma lists and repetition [NFR-MAINT-005]', () => {
    const t = tree();
    const plain = run(['check', '--content-dir', t.contentDir, '--json']);
    expect(run(['--', 'check', '--content-dir', t.contentDir, '--json']).stdout).toBe(plain.stdout);
    const comma = JSON.parse(run(['check', '--content-dir', t.contentDir, '--pack', 'docker,k8s', '--json']).stdout);
    const repeated = JSON.parse(
      run(['check', '--content-dir', t.contentDir, '--pack', 'docker', '--pack', 'k8s', '--json']).stdout,
    );
    expect(comma).toEqual(repeated);
    expect(comma.summary.packs).toBe(2);
    expect(run(['check', '--content-dir', t.contentDir, '--pack', 'docker,,k8s']).code).toBe(2);
    expect(run(['check', '--content-dir', t.contentDir, '--content-dir', t.contentDir]).code).toBe(2);
    expect(run(['--', '--', 'check']).code).toBe(2);
  });
});

describe('UT-PACKC-096 absolute paths only [NFR-MAINT-005]', () => {
  it('UT-PACKC-096 a relative --content-dir, --policy-dir or --out-dir is exit 2 [NFR-MAINT-005]', () => {
    const t = tree();
    for (const argv of [
      ['check', '--content-dir', 'content'],
      ['check', '--content-dir', t.contentDir, '--policy-dir', 'policy'],
      ['build', '--content-dir', t.contentDir, '--out-dir', 'dist'],
      ['schemas', '--content-dir', './content'],
      ['scaffold', '--content-dir', '../content'],
      ['hashes', '--pack', 'docker', '--content-dir', 'content'],
    ]) {
      const r = run(argv);
      expect(r.code, argv.join(' ')).toBe(2);
      expect(r.stderr).toContain('must be an absolute path');
    }
  });
});

describe('UT-PACKC-097 stderr [NFR-MAINT-005]', () => {
  it('UT-PACKC-097 stderr carries exactly one packc: line on engine failure and nothing otherwise [NFR-MAINT-005]', () => {
    const t = tree();
    for (const argv of [
      ['check', '--content-dir', t.contentDir],
      ['check', '--content-dir', t.contentDir, '--release'],
      ['schemas', '--check', '--content-dir', t.contentDir],
    ]) {
      expect(run(argv).stderr, argv.join(' ')).toBe('');
    }
    const fail = run(['check', '--content-dir', join(t.root, 'nope')]);
    expect(lines(fail.stderr)).toHaveLength(1);
    expect(fail.stderr.startsWith('packc: ')).toBe(true);
    expect(fail.stderr.endsWith('\n')).toBe(true);
    const policyless = run(['check', '--content-dir', t.contentDir, '--policy-dir', join(t.root, 'no-policy')]);
    expect(policyless.code).toBe(2);
    expect(lines(policyless.stderr)).toHaveLength(1);
  });
});

describe('UT-PACKC-098 source conventions [NFR-MAINT-005]', () => {
  const dirs = ['src/parse', 'src/validate', 'src/lint', 'src/emit', 'src/scaffold', 'src/schemas'];
  function sources(): { rel: string; text: string }[] {
    const out: { rel: string; text: string }[] = [];
    const walk = (rel: string): void => {
      for (const e of readdirSync(join(PACKC_ROOT, rel), { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) {
          walk(r);
        } else if (e.name.endsWith('.ts')) {
          out.push({ rel: r, text: readFileSync(join(PACKC_ROOT, r), 'utf8') });
        }
      }
    };
    for (const d of dirs) {
      walk(d);
    }
    for (const f of ['src/cli.ts', 'src/format-map.ts']) {
      out.push({ rel: f, text: readFileSync(join(PACKC_ROOT, f), 'utf8') });
    }
    return out;
  }

  it('UT-PACKC-098 no console.*, process.env, any, non-null assertion, barrel, enum or dynamic import in the sources [NFR-MAINT-005]', () => {
    const all = sources();
    expect(all.length).toBeGreaterThan(40);
    for (const { rel, text } of all) {
      const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(/\bconsole\./.test(code), `${rel} console`).toBe(false);
      expect(/process\.env/.test(code), `${rel} process.env`).toBe(false);
      expect(/:\s*any\b|<any>|\bas any\b/.test(code), `${rel} any`).toBe(false);
      expect(/\benum\s+\w+\s*\{/.test(code), `${rel} enum`).toBe(false);
      expect(/\brequire\(/.test(code), `${rel} require`).toBe(false);
      expect(/\bimport\(\s*[^'"\s]/.test(code), `${rel} dynamic import`).toBe(false);
      expect(/export \* from/.test(code), `${rel} barrel`).toBe(false);
      expect(rel.endsWith('/index.ts'), `${rel} index`).toBe(false);
      expect(/\bfrom '\.{1,2}\/[^']*(?<!\.js)'/.test(code), `${rel} relative import without .js`).toBe(false);
    }
  });

  it('UT-PACKC-098 R-POOL reuses structuralFeasibility from contracts instead of re-implementing it [FR-CUR-025]', () => {
    const inv = readFileSync(join(PACKC_ROOT, 'src/lint/inventory.ts'), 'utf8');
    expect(inv).toContain("import { structuralFeasibility } from '@fathom/contracts/pack/feasibility';");
    for (const { rel, text } of sources()) {
      expect(text.includes('NO_ASSESSMENT_POOL'), `${rel} re-implements a blocker code`).toBe(false);
    }
  });

  it('UT-PACKC-098 the repository policy directory used by the tests exists [NFR-MAINT-005]', () => {
    expect(existsSync(join(REPO_POLICY, 'mastery_rules@v1.yaml'))).toBe(true);
    expect(existsSync(join(FIXTURES, 'base/content/packs/docker/pack.yaml'))).toBe(true);
  });
});

describe('UT-PACKC-099 clock [NFR-MAINT-005]', () => {
  it('UT-PACKC-099 only scaffold without --as-of reads the clock [NFR-MAINT-005]', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-05-06T12:00:00Z'));
    const a = tmp();
    run(['scaffold', '--content-dir', join(a, 'content')]);
    const text = readFileSync(join(a, 'content/packs/alg/concepts/alg.complexity.md'), 'utf8');
    expect(text).toContain('valid_as_of: "2030-05-06"');
    expect(text).toContain('review_by: "2033-05-05"');
    const b = tmp();
    run(['scaffold', '--content-dir', join(b, 'content'), '--as-of', '2026-10-02']);
    expect(readFileSync(join(b, 'content/packs/alg/concepts/alg.complexity.md'), 'utf8')).toContain(
      'valid_as_of: "2026-10-02"',
    );
  });

  it('UT-PACKC-099 --as-of must be a calendar date; no other source reads the clock or randomness [NFR-MAINT-005]', () => {
    const r = run(['scaffold', '--content-dir', join(tmp(), 'content'), '--as-of', '2026-02-30']);
    expect(r.code).toBe(2);
    expect(run(['scaffold', '--content-dir', join(tmp(), 'content'), '--as-of', 'today']).code).toBe(2);
    const clock = /new Date\(\)|Date\.now\(|Math\.random|performance\.now|randomUUID|randomBytes/;
    const hits: string[] = [];
    const walk = (rel: string): void => {
      for (const e of readdirSync(join(PACKC_ROOT, rel), { withFileTypes: true })) {
        const p = `${rel}/${e.name}`;
        if (e.isDirectory()) {
          walk(p);
        } else if (
          e.name.endsWith('.ts') &&
          p !== 'src/policy/lock-cli.ts' &&
          clock.test(readFileSync(join(PACKC_ROOT, p), 'utf8').replace(/\/\/.*$/gm, ''))
        ) {
          hits.push(p);
        }
      }
    };
    walk('src');
    expect(hits).toEqual(['src/cli.ts']);
  });
});
