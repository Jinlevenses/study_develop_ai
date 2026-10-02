// packc CLI — check | build | scaffold | schemas | hashes (PGM-PACKC-001~005·011·012, Brief T-01-03 §4.3).
// 종료 코드: 0 = error finding 0 · 1 = error ≥ 1 · 2 = 엔진 고장(입력 0·정책 로드 실패·알 수 없는 인자·예외). exit 2에서는 아무 파일도 쓰지 않는다.
// 출력은 process.stdout/stderr.write만(console 0), 시계는 `scaffold --as-of` 생략 시만, process.env 0.
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { PackBuild } from './emit/build.js';
import { buildPack, prepare, writeFpack } from './emit/build.js';
import type { Stage } from './lint/run.js';
import { packOfPath, runCheck } from './lint/run.js';
import { scaffold } from './scaffold/scaffold.js';
import { writeSchemas } from './schemas/schemas.js';
import type { Finding } from './validate/finding.js';
import { byCode, countBySeverity, formatFinding, sortFindings } from './validate/finding.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DEFAULTS = {
  content: `${REPO}content`,
  policy: `${REPO}policy`,
  out: `${REPO}dist/packs`,
  r4: `${REPO}docs/00-research/R4-curriculum-taxonomy.md`,
};

class UsageError extends Error {}

type Parsed = {
  readonly sub: string;
  readonly packs: string[];
  readonly only: Stage[] | null;
  readonly release: boolean;
  readonly json: boolean;
  readonly check: boolean;
  readonly contentDir: string;
  readonly policyDir: string;
  readonly outDir: string;
  readonly from: string;
  readonly asOf: string | null;
};

const SUBCOMMANDS = ['check', 'build', 'scaffold', 'schemas', 'hashes'] as const;
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  check: ['--pack', '--only', '--release', '--json', '--content-dir', '--policy-dir'],
  build: ['--pack', '--release', '--json', '--out-dir', '--content-dir', '--policy-dir'],
  scaffold: ['--from', '--as-of', '--content-dir'],
  schemas: ['--check', '--content-dir'],
  hashes: ['--pack', '--content-dir', '--policy-dir'],
};
const VALUE_OPTS: ReadonlySet<string> = new Set([
  '--pack',
  '--only',
  '--content-dir',
  '--policy-dir',
  '--out-dir',
  '--from',
  '--as-of',
]);
const FLAG_OPTS: ReadonlySet<string> = new Set(['--release', '--json', '--check']);

function absDir(name: string, value: string): string {
  if (!isAbsolute(value)) {
    throw new UsageError(`${name} must be an absolute path (got '${value}')`);
  }
  return resolve(value);
}

function isStage(s: string): s is Stage {
  return s === 'V1' || s === 'V2' || s === 'V7';
}

function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) {
    return false;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function parseArgs(argv: readonly string[]): Parsed {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const sub = args[0];
  if (sub === undefined) {
    throw new UsageError(`missing subcommand (${SUBCOMMANDS.join(' | ')})`);
  }
  const allowed = ALLOWED[sub];
  if (allowed === undefined) {
    throw new UsageError(`unknown subcommand '${sub}'`);
  }
  const packs: string[] = [];
  let only: Stage[] | null = null;
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i] ?? '';
    if (!allowed.includes(a)) {
      throw new UsageError(`unknown argument '${a}' for ${sub}`);
    }
    if (FLAG_OPTS.has(a)) {
      flags.add(a);
      continue;
    }
    if (!VALUE_OPTS.has(a)) {
      throw new UsageError(`unknown argument '${a}'`);
    }
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) {
      throw new UsageError(`${a} needs a value`);
    }
    i += 1;
    if (a === '--pack') {
      for (const p of v.split(',')) {
        if (p === '') {
          throw new UsageError('--pack has an empty id');
        }
        packs.push(p);
      }
    } else if (a === '--only') {
      const list: Stage[] = only ?? [];
      for (const s of v.split(',')) {
        if (!isStage(s)) {
          throw new UsageError(`--only accepts V1, V2, V7 (got '${s}')`);
        }
        list.push(s);
      }
      only = list;
    } else {
      if (values.has(a)) {
        throw new UsageError(`${a} given twice`);
      }
      values.set(a, v);
    }
  }
  const asOf = values.get('--as-of') ?? null;
  if (asOf !== null && !isCalendarDate(asOf)) {
    throw new UsageError(`--as-of must be a calendar date YYYY-MM-DD (got '${asOf}')`);
  }
  if (sub === 'hashes' && new Set(packs).size !== 1) {
    throw new UsageError('hashes needs exactly one --pack <id>');
  }
  const dir = (opt: string, fallback: string): string => {
    const v = values.get(opt);
    return v === undefined ? fallback : absDir(opt, v);
  };
  const from = values.get('--from');
  return {
    sub,
    packs,
    only,
    release: flags.has('--release'),
    json: flags.has('--json'),
    check: flags.has('--check'),
    contentDir: dir('--content-dir', DEFAULTS.content),
    policyDir: dir('--policy-dir', DEFAULTS.policy),
    outDir: dir('--out-dir', DEFAULTS.out),
    from: from === undefined ? DEFAULTS.r4 : resolve(from),
    asOf,
  };
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const fail = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

function report(p: Parsed, findings: readonly Finding[], summaryLine: string, summary: Record<string, number>): number {
  const errors = countBySeverity(findings, 'error');
  const exit = errors > 0 ? 1 : 0;
  if (p.json) {
    out(
      JSON.stringify({
        ok: exit === 0,
        exit,
        findings,
        summary: { ...summary, errors, warnings: countBySeverity(findings, 'warn') },
      }),
    );
  } else {
    for (const f of findings) {
      out(formatFinding(f));
    }
    out(summaryLine);
  }
  return exit;
}

function runCheckCommand(p: Parsed): number {
  const r = runCheck({
    contentDir: p.contentDir,
    policyDir: p.policyDir,
    packs: p.packs.length === 0 ? null : p.packs,
    only: p.only === null ? null : new Set(p.only),
    release: p.release,
  });
  if (!r.ok) {
    fail(`packc: ${r.error}`);
    return 2;
  }
  const f = r.value.findings;
  const e = countBySeverity(f, 'error');
  const w = countBySeverity(f, 'warn');
  return report(p, f, `content:check packs=${r.value.packs.length} files=${r.value.files} errors=${e} warnings=${w}`, {
    packs: r.value.packs.length,
    files: r.value.files,
  });
}

function runBuildCommand(p: Parsed): number {
  const r = runCheck({
    contentDir: p.contentDir,
    policyDir: p.policyDir,
    packs: p.packs.length === 0 ? null : p.packs,
    only: null,
    release: p.release,
  });
  if (!r.ok) {
    fail(`packc: ${r.error}`);
    return 2;
  }
  const { ctx } = r.value;
  const findings: Finding[] = [...r.value.findings];
  const builds: PackBuild[] = [];
  if (countBySeverity(findings, 'error') === 0) {
    const ids = new Set<string>(ctx.model.packs.map((x) => x.data.id));
    for (const packId of r.value.packs.filter((x) => ids.has(x))) {
      const v2Warnings = findings.filter(
        (f) => f.severity === 'warn' && f.rule.startsWith('R-') && packOfPath(f.file) === packId,
      ).length;
      builds.push(buildPack({ ctx, packId, v2Warnings }));
    }
    for (const b of builds) {
      if (b.fpack === null) {
        findings.push(...b.findings);
      }
    }
  }
  const sorted = sortFindings(findings);
  let written = 0;
  if (countBySeverity(sorted, 'error') === 0) {
    for (const b of builds) {
      writeFpack(p.outDir, b);
      written += 1;
    }
  }
  const e = countBySeverity(sorted, 'error');
  return report(p, sorted, `packs:build packs=${r.value.packs.length} written=${written} errors=${e}`, {
    packs: r.value.packs.length,
    written,
  });
}

function runHashesCommand(p: Parsed): number {
  const r = runCheck({
    contentDir: p.contentDir,
    policyDir: p.policyDir,
    packs: p.packs,
    only: new Set<Stage>(['V1', 'V2']),
    release: false,
  });
  if (!r.ok) {
    fail(`packc: ${r.error}`);
    return 2;
  }
  if (countBySeverity(r.value.findings, 'error') > 0) {
    return 1;
  }
  const packId = p.packs[0] ?? '';
  if (!r.value.ctx.model.packs.some((x) => x.data.id === packId)) {
    fail(`packc: pack ${packId} has no pack.yaml`);
    return 2;
  }
  const subjects: Record<string, string> = {};
  for (const [id, hash] of [...prepare(r.value.ctx, packId).bodies.subjects.entries()].sort((a, b) =>
    byCode(a[0], b[0]),
  )) {
    subjects[id] = hash;
  }
  out(canonicalJson(subjects));
  return 0;
}

function runScaffoldCommand(p: Parsed): number {
  const asOf = p.asOf ?? new Date().toISOString().slice(0, 10);
  const r = scaffold({ r4Path: p.from, contentDir: p.contentDir, asOf });
  if (!r.ok) {
    fail(`packc: ${r.error}`);
    return 2;
  }
  const s = r.value;
  out(
    `scaffold rows=${s.rows} edges=${s.edges} created=${s.created} skipped=${s.skipped} packs_created=${s.packsCreated}`,
  );
  return 0;
}

function runSchemasCommand(p: Parsed): number {
  const s = writeSchemas(p.contentDir, p.check);
  if (p.check) {
    for (const f of s.stale) {
      out(`stale ${f}`);
    }
    if (s.stale.length > 0) {
      return 1;
    }
    out('schemas ok');
    return 0;
  }
  out(`schemas written=${s.written}`);
  return 0;
}

/** 종료 코드를 돌려준다(프로세스를 끝내지 않는다). */
export function main(argv: readonly string[]): number {
  try {
    const p = parseArgs(argv);
    switch (p.sub) {
      case 'check':
        return runCheckCommand(p);
      case 'build':
        return runBuildCommand(p);
      case 'scaffold':
        return runScaffoldCommand(p);
      case 'schemas':
        return runSchemasCommand(p);
      default:
        return runHashesCommand(p);
    }
  } catch (e) {
    fail(`packc: ${(e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'failure'}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
