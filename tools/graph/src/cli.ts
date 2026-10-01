// graph CLI: `snapshot --int <id>` → <out>/<id>/metrics.json (+ GRAPH_REPORT.md 복사), `god-nodes`.
// 종료 코드: 0 성공 · 2 입력·사용법 오류. 파일 I/O·시계·외부 호출(graphify·git·게이트)은 이 파일에만 둔다.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Graph, godNodes } from './god-nodes.js';
import { type AuditGraph, computeMetrics } from './snapshot.js';

const INT_RE = /^(INT-(1a|1b|[2-7])|PG-3)$/;

export interface CliDeps {
  now: () => number;
  graphifyVersion: () => string;
  commit: (root: string) => string;
  audit: (root: string, graphPath: string) => AuditGraph;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** graphify --version 첫 semver. 실패(ENOENT 포함) → "unavailable". */
function detectGraphifyVersion(): string {
  try {
    const text = execFileSync('graphify', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return /\d+\.\d+\.\d+/.exec(text)?.[0] ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function detectCommit(root: string): string {
  try {
    const text = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return /^[0-9a-f]{7,64}$/.test(text) ? text : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** audit:graph 스크립트가 있으면 실행해 exit만 기록한다(비차단). 없으면 skipped. */
function runAudit(root: string, graphPath: string): AuditGraph {
  const script = path.join(root, 'tools', 'gates', 'check-graphify-edges.mjs');
  if (!existsSync(script)) {
    return { exit: null, skipped: true };
  }
  try {
    execFileSync(process.execPath, [script, '--root', root, '--graph', graphPath, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exit: 0, skipped: false };
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return { exit: typeof status === 'number' ? status : 2, skipped: false };
  }
}

const DEFAULT_DEPS: CliDeps = {
  now: () => Date.now(),
  graphifyVersion: detectGraphifyVersion,
  commit: detectCommit,
  audit: runAudit,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

class UsageError extends Error {}

interface Parsed {
  command: string;
  values: Map<string, string>;
  flags: Set<string>;
}

const COMMANDS: Record<string, { options: string[]; flags: string[] }> = {
  snapshot: { options: ['int', 'root', 'graph', 'out'], flags: [] },
  'god-nodes': { options: ['top', 'graph', 'root'], flags: ['json'] },
};

function parse(argv: string[]): Parsed {
  const rest = [...argv];
  let command = 'snapshot';
  const first = rest[0];
  if (first !== undefined && !first.startsWith('--')) {
    command = first;
    rest.shift();
  }
  const spec = COMMANDS[command];
  if (spec === undefined) {
    throw new UsageError(`unknown command: ${command} (snapshot | god-nodes)`);
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? '';
    if (!a.startsWith('--')) {
      throw new UsageError(`unexpected argument: ${a}`);
    }
    const eq = a.indexOf('=');
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
    if (spec.flags.includes(name)) {
      flags.add(name);
    } else if (spec.options.includes(name)) {
      const value = eq >= 0 ? a.slice(eq + 1) : rest[++i];
      if (value === undefined) {
        throw new UsageError(`option --${name} needs a value`);
      }
      values.set(name, value);
    } else {
      throw new UsageError(`unknown option: --${name}`);
    }
  }
  return { command, values, flags };
}

function loadGraph(graphPath: string): Graph {
  if (!existsSync(graphPath)) {
    throw new UsageError(`graph missing — run graphify update . first (${graphPath})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(graphPath, 'utf8'));
  } catch (e) {
    throw new UsageError(`graph is not valid JSON: ${graphPath} (${e instanceof Error ? e.message : String(e)})`);
  }
  const g = raw as { nodes?: unknown; edges?: unknown; links?: unknown };
  const edges = Array.isArray(g.edges) ? g.edges : Array.isArray(g.links) ? g.links : null;
  if (!Array.isArray(g.nodes) || edges === null) {
    throw new UsageError(`graph has no nodes[]/edges[]: ${graphPath}`);
  }
  return { nodes: g.nodes as Graph['nodes'], edges: edges as Graph['edges'] };
}

function snapshot(p: Parsed, deps: CliDeps): void {
  const intId = p.values.get('int');
  if (intId === undefined || !INT_RE.test(intId)) {
    throw new UsageError(`--int must be one of INT-1a|INT-1b|INT-2..INT-7|PG-3 (got ${intId ?? 'nothing'})`);
  }
  const root = path.resolve(p.values.get('root') ?? '.');
  const graphPath = path.resolve(root, p.values.get('graph') ?? 'graphify-out/graph.json');
  const outDir = path.resolve(root, p.values.get('out') ?? 'docs/40-impl/graph');
  const graph = loadGraph(graphPath);
  const metrics = computeMetrics(graph, {
    intId,
    createdAt: deps.now(),
    graphifyVersion: deps.graphifyVersion(),
    commit: deps.commit(root),
    audit: deps.audit(root, graphPath),
  });
  const dir = path.join(outDir, intId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  const report = path.join(root, 'graphify-out', 'GRAPH_REPORT.md');
  if (existsSync(report)) {
    copyFileSync(report, path.join(dir, 'GRAPH_REPORT.md'));
  }
  deps.out(
    `[graph] ${intId}: ${metrics.nodes} nodes, ${metrics.edges} edges, ${metrics.cross_service_edge_count} cross-service edge(s) -> ${path.join(dir, 'metrics.json')}`,
  );
}

function godNodesCommand(p: Parsed, deps: CliDeps): void {
  const topText = p.values.get('top') ?? '10';
  const top = Number(topText);
  if (!Number.isInteger(top) || top < 1) {
    throw new UsageError(`--top must be a positive integer (got ${topText})`);
  }
  const root = path.resolve(p.values.get('root') ?? '.');
  const graph = loadGraph(path.resolve(root, p.values.get('graph') ?? 'graphify-out/graph.json'));
  const nodes = godNodes(graph, top);
  if (p.flags.has('json')) {
    deps.out(JSON.stringify(nodes));
    return;
  }
  deps.out('degree  label  source_file');
  for (const n of nodes) {
    deps.out(`${String(n.degree).padStart(6)}  ${n.label}  ${n.source_file}`);
  }
}

/** 명령 실행. 반환 = 종료 코드(0 성공 · 2 입력·사용법 오류). */
export function run(argv: string[], deps: CliDeps = DEFAULT_DEPS): number {
  try {
    const p = parse(argv);
    if (p.command === 'snapshot') {
      snapshot(p, deps);
    } else {
      godNodesCommand(p, deps);
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      deps.err(`[graph] ${e.message}`);
      return 2;
    }
    deps.err(`[graph] unexpected error: ${e instanceof Error ? e.message : String(e)}`);
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
