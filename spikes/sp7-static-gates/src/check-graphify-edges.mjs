#!/usr/bin/env node
// check:graphify-edges  (NFR-MAINT-001 [A]: "graphify 교차 서비스 직접 엣지 0")
// Reads graphify's graph.json (built by `graphify extract <root> --code-only`) and reports edges between different units
// (services/*, apps/*, packages/*) that are not in the shared allowlist.  Independent of TypeScript's compiler API
// (graphify uses tree-sitter).  Granularity: file pair (graphify collapses same-endpoint edges), not per-line.
// Usage: node src/check-graphify-edges.mjs --root <fixture> [--graph <graph.json>] [--run] [--json]
import { readFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { parseArgs, finish } from "./lib/common.mjs";
import { POLICY } from "./check-boundaries.mjs";

const RELS = new Set(["imports_from", "re_exports", "dynamic_import", "imports"]);
const unitOf = (f) => { const m = f && POLICY.unitPattern.exec(f); return m ? `${m[1]}/${m[2]}` : null; };

export function graphifyRun(root, outDir) {
  const t0 = performance.now();
  const r = spawnSync("graphify", ["extract", root, "--code-only", "--no-cluster", "--force", "--out", outDir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`graphify failed: ${r.stderr || r.stdout}`);
  return { ms: performance.now() - t0, graph: path.join(outDir, "graphify-out", "graph.json") };
}

export function analyze(graphPath) {
  const g = JSON.parse(readFileSync(graphPath, "utf8"));
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const v = [];
  for (const e of g.edges) {
    if (!RELS.has(e.relation)) continue;
    const sn = nodes.get(e.source), tn = nodes.get(e.target);
    const su = unitOf(sn?.source_file), tu = unitOf(tn?.source_file);
    if (String(e.target).startsWith("ref_")) continue;                    // external package / builtin reference node
    if (!su || !tu || su === tu || POLICY.shared.has(tu)) continue;
    if (/package\.json$/.test(sn.source_file)) continue;                 // dependency lists are not code edges
    v.push({ file: sn.source_file, line: Number(String(e.source_location ?? "L1").replace(/\D/g, "")) || 1, rule: "boundary/graphify-edge", message: `${su} -> ${tu} (${e.relation}, ${e.confidence}) target ${tn.source_file}` });
  }
  return { nodes: g.nodes.length, edges: g.edges.length, violations: v };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs();
  const argv = process.argv.slice(2);
  let graph = argv.includes("--graph") ? path.resolve(argv[argv.indexOf("--graph") + 1]) : null;
  let ms = null;
  if (!graph) { const r = graphifyRun(opts.root, mkdtempSync(path.join(os.tmpdir(), "sp7-graphify-"))); graph = r.graph; ms = r.ms; }
  const { nodes, edges, violations } = analyze(graph);
  finish("check:graphify-edges", opts.root, violations, opts, { graphNodes: nodes, graphEdges: edges, graphifyMs: ms && Math.round(ms) });
}
