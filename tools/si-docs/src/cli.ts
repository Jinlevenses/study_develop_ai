// si-docs CLI: reports · rtm · ids · pgm. 파일 I/O·시계·git 호출은 이 파일에만 둔다(나머지 모듈은 순수 함수).
// 종료 코드: 0 성공 · 1 검사 실패(ids) · 2 입력·사용법 오류.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDod } from './dod.js';
import {
  type BriefInfo,
  duplicateProblems,
  type IdDiagnostic,
  outOfRangeProblems,
  overlapProblems,
  parseBrief,
  placementProblems,
  type TestEntry,
} from './ids.js';
import { type GatesJson, parseGatesJson, renderItr } from './itr.js';
import { buildFileIndex, parsePgmTables, renderPgm, resolvePgm } from './pgm.js';
import { parsePrf, renderPrf } from './prf.js';
import { collectResults, type ResultInput } from './results.js';
import { buildRtm, renderRtm } from './rtm.js';
import { applyIteration, isIntId, parseIteration, parseRtmTables, previousInt, ShapeError } from './rtm-source.js';
import { renderSec } from './sec.js';
import { isTestSourcePath, scanSources } from './titles.js';
import { type CoverageSummary, renderUtr } from './utr.js';
import { extractClassFromRtm, parseVerificationClass, summarizeClasses } from './verification-class.js';

export interface CliEnv {
  now: () => number;
  commit: (root: string) => string;
  nodeVersion: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

function detectCommit(root: string): string {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return /^[0-9a-f]{7,64}$/.test(sha) ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

const DEFAULT_ENV: CliEnv = {
  now: () => Date.now(),
  commit: detectCommit,
  nodeVersion: process.version,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

class InputError extends Error {}

interface Parsed {
  command: string;
  values: Map<string, string>;
  flags: Set<string>;
}

const COMMANDS: Record<string, { options: string[]; flags: string[] }> = {
  reports: { options: ['int', 'root', 'in', 'out', 'min-reqs'], flags: ['dod'] },
  rtm: { options: ['int', 'root', 'in', 'out', 'min-reqs'], flags: [] },
  ids: { options: ['root', 'task', 'iteration'], flags: [] },
  pgm: { options: ['int', 'root', 'out'], flags: [] },
};

function parse(argv: string[]): Parsed {
  const rest = [...argv];
  let command = 'reports';
  const first = rest[0];
  if (first !== undefined && !first.startsWith('--')) {
    command = first;
    rest.shift();
  }
  const spec = COMMANDS[command];
  if (spec === undefined) {
    throw new InputError(`unknown command: ${command} (reports | rtm | ids | pgm)`);
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? '';
    if (!a.startsWith('--')) {
      throw new InputError(`unexpected argument: ${a}`);
    }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (spec.flags.includes(name)) {
      flags.add(name);
    } else if (spec.options.includes(name)) {
      const value = eq >= 0 ? a.slice(eq + 1) : rest[++i];
      if (value === undefined) {
        throw new InputError(`option --${name} needs a value`);
      }
      values.set(name, value);
    } else {
      throw new InputError(`unknown option: --${name}`);
    }
  }
  return { command, values, flags };
}

function requireInt(p: Parsed): string {
  const id = p.values.get('int');
  if (id === undefined || !isIntId(id)) {
    throw new InputError(`--int must match ^(INT-(1a|1b|[2-7])|PG-3)$ (got ${id ?? 'nothing'})`);
  }
  return id;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new InputError(`invalid JSON: ${file} (${e instanceof Error ? e.message : String(e)})`);
  }
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  'graphify-out',
  '.fathom-dev',
  'playwright-report',
  'test-results',
  '.reports',
]);

/** root 아래 모든 파일(posix 상대 경로, 정렬). */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const rec = (abs: string, rel: string): void => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const r = rel === '' ? ent.name : `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) {
          rec(path.join(abs, ent.name), r);
        }
      } else if (ent.isFile()) {
        out.push(r);
      }
    }
  };
  rec(root, '');
  return out.sort();
}

function writeText(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const SUITE_KEYS = ['ut', 'ct', 'it', 'sec', 'cha', 'e2e'] as const;

/** 결과 입력 수집(§4.3.5). 없는 입력은 건너뛴다. */
function readResultInputs(root: string, inDir: string): ResultInput[] {
  const inputs: ResultInput[] = [];
  const addFile = (file: string, key: ResultInput['key']): void => {
    inputs.push({ key, name: path.basename(file), text: readFileSync(file, 'utf8') });
  };
  for (const key of SUITE_KEYS) {
    const file = path.join(inDir, `${key}.json`);
    if (existsSync(file)) {
      addFile(file, key);
    }
    const dir = path.join(inDir, key);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      for (const name of readdirSync(dir)
        .filter((n) => n.endsWith('.json'))
        .sort()) {
        addFile(path.join(dir, name), key);
      }
    }
  }
  for (const group of ['apps', 'services', 'packages', 'tools']) {
    const groupDir = path.join(root, group);
    if (!existsSync(groupDir)) {
      continue;
    }
    for (const pkg of readdirSync(groupDir).sort()) {
      for (const key of ['ut', 'ct', 'it', 'sec'] as const) {
        const file = path.join(groupDir, pkg, '.reports', `${key}.json`);
        if (existsSync(file)) {
          addFile(file, key);
        }
      }
    }
  }
  if (existsSync(inDir)) {
    for (const name of readdirSync(inDir)
      .filter((n) => n.endsWith('.tap'))
      .sort()) {
      addFile(path.join(inDir, name), null);
    }
  }
  return inputs;
}

interface Context {
  root: string;
  int: string;
  inDir: string;
  rtmMd: string;
  rows: ReturnType<typeof parseRtmTables>;
  scan: ReturnType<typeof scanSources>;
  results: ReturnType<typeof collectResults>;
  manifest: ReturnType<typeof extractClassFromRtm>;
}

function buildContext(p: Parsed, env: CliEnv): Context {
  const int = requireInt(p);
  const root = path.resolve(p.values.get('root') ?? '.');
  const inDir = path.resolve(root, p.values.get('in') ?? path.join('.reports', int));
  const minText = p.values.get('min-reqs') ?? '300';
  const min = Number(minText);
  if (!Number.isInteger(min) || min < 0) {
    throw new InputError(`--min-reqs must be a non-negative integer (got ${minText})`);
  }
  const rtmPath = path.join(root, 'docs', '02-design', '09-rtm.md');
  if (!existsSync(rtmPath)) {
    throw new InputError(`RTM source missing: ${rtmPath}`);
  }
  const rtmMd = readFileSync(rtmPath, 'utf8');
  let rows = parseRtmTables(rtmMd);
  if (rows.length === 0) {
    throw new InputError('ambiguity: no table with ID·우선·슬·V·INT header cells found in 09-rtm.md');
  }
  if (rows.length < min) {
    throw new InputError(`RTM parsed ${rows.length} requirements < --min-reqs ${min} (vacuous-pass guard)`);
  }
  const iterFile = path.join(root, 'tools', 'si-docs', 'data', 'fr-iteration.json');
  const iter = readJson(iterFile);
  if (iter !== null) {
    try {
      rows = applyIteration(rows, parseIteration(iter));
    } catch (e) {
      if (e instanceof ShapeError) {
        throw new InputError(`ambiguity: ${e.message} (${iterFile})`);
      }
      throw e;
    }
  }
  const vcFile = readJson(path.join(root, 'packages', 'contracts', 'manifests', 'verification-class.json'));
  const manifest = (vcFile === null ? null : parseVerificationClass(vcFile)) ?? extractClassFromRtm(rtmMd);
  const files = walkFiles(root)
    .filter(isTestSourcePath)
    .map((f) => ({ path: f, text: readFileSync(path.join(root, f), 'utf8') }));
  const scan = scanSources(files);
  const results = collectResults(readResultInputs(root, inDir));
  env.out(
    `[si-docs] ${int}: ${rows.length} requirements, ${scan.titles.length} test titles, ${results.length} results`,
  );
  return { root, int, inDir, rtmMd, rows, scan, results, manifest };
}

function headerLine(env: CliEnv, root: string, int: string): string {
  return `실행: ${new Date(env.now()).toISOString()} · 커밋: ${env.commit(root)} · 명령: pnpm si:reports --int ${int} · Node ${env.nodeVersion}`;
}

function rtmReport(ctx: Context, env: CliEnv, outDir: string): void {
  const build = buildRtm({
    int: ctx.int,
    rows: ctx.rows,
    titles: ctx.scan.titles,
    titleErrors: ctx.scan.errors,
    results: ctx.results,
    manifest: ctx.manifest,
    generatedAt: env.now(),
    commit: env.commit(ctx.root),
  });
  const classes = ctx.manifest === null ? null : summarizeClasses(ctx.rows, ctx.manifest);
  writeText(path.join(outDir, `RTM-${ctx.int}.md`), renderRtm(build, headerLine(env, ctx.root, ctx.int), classes));
  writeText(path.join(ctx.inDir, 'rtm.json'), `${JSON.stringify(build.json, null, 2)}\n`);
}

function readBriefs(root: string, iteration?: string): BriefInfo[] {
  const base = path.join(root, 'docs', '40-impl', 'briefs');
  if (!existsSync(base)) {
    return [];
  }
  const out: BriefInfo[] = [];
  for (const dir of readdirSync(base)
    .filter((d) => /^IT-\d{2}$/.test(d) && (iteration === undefined || d === iteration))
    .sort()) {
    for (const name of readdirSync(path.join(base, dir))
      .filter((n) => /^T-\d{2}-\d{2}.*\.md$/.test(n))
      .sort()) {
      const rel = `docs/40-impl/briefs/${dir}/${name}`;
      out.push(parseBrief(rel, readFileSync(path.join(base, dir, name), 'utf8')));
    }
  }
  return out;
}

function reportsCommand(p: Parsed, env: CliEnv): void {
  const ctx = buildContext(p, env);
  const outDir = path.resolve(ctx.root, p.values.get('out') ?? path.join('docs', '40-impl', 'reports'));
  const header = headerLine(env, ctx.root, ctx.int);
  rtmReport(ctx, env, outDir);
  const prevInt = previousInt(ctx.int);
  const coverage = readJson(path.join(ctx.inDir, 'coverage-summary.json')) as CoverageSummary | null;
  const prevCoverage =
    prevInt === null
      ? null
      : (readJson(path.join(path.dirname(ctx.inDir), prevInt, 'coverage-summary.json')) as CoverageSummary | null);
  const detRaw = readJson(path.join(ctx.inDir, 'determinism.json')) as { equal?: unknown } | null;
  const gatesRaw = readJson(path.join(ctx.inDir, 'gates.json'));
  const gates: GatesJson | null = gatesRaw === null ? null : parseGatesJson(gatesRaw);
  const prfRaw = readJson(path.join(ctx.inDir, 'prf.json'));
  const prf = prfRaw === null ? null : parsePrf(prfRaw);
  const metrics = readJson(path.join(ctx.root, 'docs', '40-impl', 'graph', ctx.int, 'metrics.json')) as {
    cross_service_edge_count?: unknown;
  } | null;
  const quarantine = readJson(path.join(ctx.inDir, 'quarantine.json'));
  writeText(
    path.join(outDir, `UTR-${ctx.int}.md`),
    renderUtr({
      int: ctx.int,
      header,
      results: ctx.results,
      coverage,
      prevCoverage,
      determinism: typeof detRaw?.equal === 'boolean' ? { equal: detRaw.equal } : null,
      briefs: readBriefs(ctx.root),
      titles: ctx.scan.titles,
    }),
  );
  writeText(
    path.join(outDir, `ITR-${ctx.int}.md`),
    renderItr({
      int: ctx.int,
      header,
      results: ctx.results,
      prf,
      gates,
      crossServiceEdgeCount:
        typeof metrics?.cross_service_edge_count === 'number' ? metrics.cross_service_edge_count : null,
      egress: readJson(path.join(ctx.inDir, 'egress.json')),
      quarantine: Array.isArray(quarantine) ? quarantine : null,
    }),
  );
  if (prf !== null) {
    writeText(path.join(outDir, `PRF-${ctx.int}.md`), renderPrf(ctx.int, header, prf));
  }
  if (existsSync(path.join(ctx.inDir, 'sec.json'))) {
    writeText(
      path.join(outDir, `SEC-${ctx.int}.md`),
      renderSec({
        int: ctx.int,
        header,
        audit: readJson(path.join(ctx.inDir, 'audit.json')),
        gates,
        results: ctx.results,
      }),
    );
  }
  if (p.flags.has('dod') || ctx.int === 'INT-7' || ctx.int === 'PG-3') {
    const platforms = readJson(path.join(ctx.inDir, 'runner_verified_platforms.json'));
    writeText(
      path.join(outDir, `DOD-${ctx.int}.md`),
      renderDod({
        int: ctx.int,
        header,
        results: ctx.results,
        gates,
        platforms: platforms === null ? null : JSON.stringify(platforms),
      }),
    );
  }
  env.out(`[si-docs] reports written to ${outDir}`);
}

function rtmCommand(p: Parsed, env: CliEnv): void {
  const ctx = buildContext(p, env);
  const outDir = path.resolve(ctx.root, p.values.get('out') ?? path.join('docs', '40-impl', 'reports'));
  rtmReport(ctx, env, outDir);
  env.out(`[si-docs] RTM-${ctx.int}.md written to ${outDir}`);
}

function idsCommand(p: Parsed, env: CliEnv): number {
  const root = path.resolve(p.values.get('root') ?? '.');
  const task = p.values.get('task');
  const iteration = p.values.get('iteration');
  if (iteration !== undefined && !/^IT-\d{2}$/.test(iteration)) {
    throw new InputError(`--iteration must look like IT-00 (got ${iteration})`);
  }
  const files = walkFiles(root)
    .filter(isTestSourcePath)
    .map((f) => ({ path: f, text: readFileSync(path.join(root, f), 'utf8') }));
  const scan = scanSources(files);
  const entries: TestEntry[] = scan.titles.map((t) => ({ id: t.id, file: t.file, line: t.line }));
  const diags: IdDiagnostic[] = [
    ...scan.errors.map((e) => ({ file: e.file, line: e.line, rule: 'si/title', message: `${e.reason}: ${e.title}` })),
    ...duplicateProblems(entries),
    ...placementProblems(entries),
  ];
  const briefs = readBriefs(root, iteration);
  diags.push(...overlapProblems(briefs));
  if (task !== undefined) {
    const brief = readBriefs(root).find((b) => b.taskId === task);
    if (brief === undefined) {
      throw new InputError(`Brief not found for --task ${task} under docs/40-impl/briefs/`);
    }
    diags.push(...outOfRangeProblems(entries, brief));
  }
  diags.sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
  for (const d of diags) {
    env.out(`${d.file}:${d.line}  error  ${d.rule}  ${d.message}`);
  }
  env.out(
    `[si:ids] ${diags.length} error(s), ${entries.length} test ID(s) in ${new Set(entries.map((e) => e.file)).size} file(s)`,
  );
  return diags.length > 0 ? 1 : 0;
}

function pgmCommand(p: Parsed, env: CliEnv): void {
  const int = requireInt(p);
  const root = path.resolve(p.values.get('root') ?? '.');
  const wbs = path.join(root, 'docs', '02-design', '08-wbs-iteration-plan.md');
  if (!existsSync(wbs)) {
    throw new InputError(`WBS source missing: ${wbs}`);
  }
  const rows = parsePgmTables(readFileSync(wbs, 'utf8'));
  if (rows.length === 0) {
    throw new InputError('ambiguity: no | PGM- rows found in 08-wbs-iteration-plan.md');
  }
  const index = buildFileIndex(walkFiles(root));
  const results = rows.map((r) => resolvePgm(r, index));
  const outDir = path.resolve(root, p.values.get('out') ?? path.join('docs', '40-impl', 'reports'));
  writeText(path.join(outDir, `PGM-${int}.md`), renderPgm(int, headerLine(env, root, int), results));
  env.out(`[si-docs] PGM-${int}.md written to ${outDir} (${rows.length} rows)`);
}

/** 명령 실행. 반환 = 종료 코드. */
export function run(argv: string[], env: CliEnv = DEFAULT_ENV): number {
  try {
    const p = parse(argv);
    switch (p.command) {
      case 'reports':
        reportsCommand(p, env);
        return 0;
      case 'rtm':
        rtmCommand(p, env);
        return 0;
      case 'ids':
        return idsCommand(p, env);
      default:
        pgmCommand(p, env);
        return 0;
    }
  } catch (e) {
    if (e instanceof InputError) {
      env.err(`[si-docs] ${e.message}`);
      return 2;
    }
    env.err(`[si-docs] unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

/** 진입점 판정. import.meta.url 은 realpath, argv[1] 은 심볼릭 링크를 유지할 수 있어 둘 다 realpath 로 비교한다(침묵 exit 0 방지). */
function isEntry(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}

if (isEntry(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
