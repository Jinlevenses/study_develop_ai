#!/usr/bin/env node
// ported-from: spikes/sp7-static-gates/src/check-graphify-edges.mjs (audit-fixed: 예외·노드 0 → exit 2(runGate), 위반 기준 = boundaries.json(isAllowed), graphify 없음(ENOENT) → exit 0 + skipped, 임시 디렉터리 os.tmpdir)
// audit:graph (NFR-MAINT-001, UR-09, STD-GATE-08, IF-EXT-13, CR-59) — graphify가 추출한 코드 그래프의 단위 간 직접 엣지를 boundaries.json과 대조한다.
//   boundary/graphify-edge: source 단위 ≠ target 단위 ∧ isAllowed(...) = false
// 옵션: --graph <graph.json> | --extract(`graphify extract <root> --code-only --no-cluster --force --out <tmp>` 실행). 둘 다 없으면 <root>/graphify-out/graph.json.
// graphify 없음(ENOENT) → exit 0 + {"check":"audit:graph","exit":0,"skipped":true,"reason":"graphify-unavailable"}(비차단, NFR-PORT-007)
// 사용: node tools/gates/check-graphify-edges.mjs [--root <dir>] [--graph <path>] [--extract] [--json] [--quiet]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMain, parseArgs, runGate } from './lib/common.mjs';
import { GateEngineError } from './lib/errors.mjs';
import { isAllowed, loadBoundaries, unitOf } from './lib/units.mjs';

const RELS = new Set(['imports_from', 're_exports', 'dynamic_import', 'imports']);
const SPEC = { flags: ['extract'], options: ['graph'] };

/** graph.json 분석: 반환 {files(= source_file이 있는 노드 수), violations}. */
export function analyzeGraph(graph, cfg, root) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : Array.isArray(graph?.links) ? graph.links : [];
  const relOf = (f) => {
    if (typeof f !== 'string' || f === '') {
      return null;
    }
    const norm = f.split(path.sep).join('/');
    const r = root.split(path.sep).join('/');
    return path.isAbsolute(f) && norm.startsWith(`${r}/`) ? norm.slice(r.length + 1) : norm;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const violations = [];
  for (const e of edges) {
    if (!RELS.has(e.relation)) {
      continue;
    }
    if (String(e.target).startsWith('ref_')) {
      continue; // 외부 패키지·내장 참조 노드
    }
    const sn = byId.get(e.source);
    const tn = byId.get(e.target);
    const sf = relOf(sn?.source_file);
    const tf = relOf(tn?.source_file);
    if (!sf || !tf || /(^|\/)package\.json$/.test(sf)) {
      continue; // 의존 목록은 코드 엣지가 아님
    }
    const su = unitOf(sf);
    const tu = unitOf(tf);
    if (!su || !tu || su === tu) {
      continue;
    }
    if (!isAllowed(cfg, su, tu, sf)) {
      violations.push({
        file: sf,
        line: Number(/\d+/.exec(String(e.source_location ?? 'L1'))?.[0]) || 1,
        rule: 'boundary/graphify-edge',
        message: `${su} -> ${tu} (${e.relation}, ${e.confidence ?? 'n/a'}) target ${tf}`,
        severity: 'error',
      });
    }
  }
  return { files: nodes.filter((n) => typeof n?.source_file === 'string' && n.source_file !== '').length, violations };
}

export function analyze(root, opts = {}) {
  const graphAbs = opts.graph ? path.resolve(root, opts.graph) : path.join(root, 'graphify-out', 'graph.json');
  if (!existsSync(graphAbs)) {
    throw new GateEngineError(
      'engine/input-missing',
      `graph.json not found: ${graphAbs} (run graphify or use --extract)`,
    );
  }
  let graph;
  try {
    graph = JSON.parse(readFileSync(graphAbs, 'utf8'));
  } catch (e) {
    throw new GateEngineError('engine/input-missing', `graph.json is not valid JSON: ${e.message}`);
  }
  const cfg = loadBoundaries(opts.config);
  return analyzeGraph(graph, cfg, root);
}

/** --extract 전처리: graphify 실행. 반환 {argv, skipped?, error?}. graphify 없음 → skipped. */
function prepareExtract(argv) {
  if (!argv.includes('--extract')) {
    return { argv };
  }
  let opts;
  try {
    opts = parseArgs(argv, SPEC);
  } catch {
    return { argv }; // runGate가 사용 오류를 exit 2로 보고한다
  }
  try {
    if (!statSync(opts.root).isDirectory()) {
      return { argv };
    }
  } catch {
    return { argv }; // root 없음 → runGate가 engine/no-root
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fathom-graph-'));
  const r = spawnSync('graphify', ['extract', opts.root, '--code-only', '--no-cluster', '--force', '--out', tmp], {
    encoding: 'utf8',
  });
  if (r.error?.code === 'ENOENT') {
    return { argv, skipped: { root: opts.root, json: opts.json } };
  }
  if (r.error || r.status !== 0) {
    return {
      argv,
      error: `graphify extract failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n')[0]}`,
    };
  }
  const nested = path.join(tmp, 'graphify-out', 'graph.json');
  const graph = existsSync(nested) ? nested : path.join(tmp, 'graph.json');
  const rest = argv.filter((a) => a !== '--extract');
  return { argv: [...rest, '--graph', graph] };
}

if (isMain(import.meta.url)) {
  const pre = prepareExtract(process.argv.slice(2));
  if (pre.skipped) {
    const body = { check: 'audit:graph', exit: 0, skipped: true, reason: 'graphify-unavailable' };
    process.stdout.write(
      pre.skipped.json ? `${JSON.stringify(body)}\n` : '[audit:graph] skipped: graphify-unavailable (non-blocking)\n',
    );
    process.exitCode = 0;
  } else {
    await runGate(
      { id: 'audit:graph', requireUnits: true, spec: SPEC },
      (o) => {
        if (pre.error) {
          throw new GateEngineError('engine/input-missing', pre.error);
        }
        return analyze(o.root, { graph: o.get('graph') });
      },
      pre.argv,
    );
  }
}
