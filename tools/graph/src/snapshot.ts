// snapshot: graphify 그래프 → INT 스냅샷 metrics.json 계산(STD §18.4). 순수 함수 — 시계·git·파일 I/O는 cli.ts가 주입한다.
import { type GodNode, type Graph, godNodes } from './god-nodes.js';

export interface AuditGraph {
  exit: number | null;
  skipped: boolean;
}

export interface CrossServiceEdge {
  from: string;
  to: string;
  relation: string;
}

export interface Metrics {
  int_id: string;
  created_at: number;
  graphify_version: string;
  commit: string;
  nodes: number;
  edges: number;
  communities: number;
  nodes_by_unit: Record<string, number>;
  god_nodes_top10: GodNode[];
  cross_service_edges: CrossServiceEdge[];
  cross_service_edge_count: number;
  audit_graph: AuditGraph;
}

export interface MetricsInput {
  intId: string;
  createdAt: number;
  graphifyVersion: string;
  commit: string;
  audit: AuditGraph;
}

const UNIT_RE = /^(apps|services|packages|tools)\/([^/]+)\//;
const CROSS_RELATIONS = new Set(['imports_from', 're_exports', 'dynamic_import', 'imports']);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** source_file의 단위(`apps/<n>`·`services/<n>`·`packages/<n>`·`tools/<n>`·`tests`). 단위 없음 = null. */
export function unitOfFile(file: string | null | undefined): string | null {
  if (!file) {
    return null;
  }
  const m = UNIT_RE.exec(file);
  if (m) {
    return `${m[1]}/${m[2]}`;
  }
  return file.startsWith('tests/') ? 'tests' : null;
}

const isCrossUnit = (unit: string | null): unit is string =>
  unit !== null && (unit.startsWith('services/') || unit.startsWith('apps/'));

/** 서비스·앱 사이의 파일 단위 import 엣지(중복 제거·사전순). */
export function crossServiceEdges(graph: Graph): CrossServiceEdge[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Map<string, CrossServiceEdge>();
  for (const e of graph.edges) {
    if (e.relation === undefined || !CROSS_RELATIONS.has(e.relation) || e.target.startsWith('ref_')) {
      continue;
    }
    const from = byId.get(e.source)?.source_file ?? e.source_file ?? null;
    const to = byId.get(e.target)?.source_file ?? null;
    if (from === null || to === null || from.endsWith('package.json')) {
      continue;
    }
    const fromUnit = unitOfFile(from);
    const toUnit = unitOfFile(to);
    if (!isCrossUnit(fromUnit) || !isCrossUnit(toUnit) || fromUnit === toUnit) {
      continue;
    }
    seen.set(`${from}\u0000${to}\u0000${e.relation}`, { from, to, relation: e.relation });
  }
  return [...seen.values()].sort(
    (a, b) => compare(a.from, b.from) || compare(a.to, b.to) || compare(a.relation, b.relation),
  );
}

/** 단위별 노드 수(키 사전순, 단위 없는 노드 제외). */
export function nodesByUnit(graph: Graph): Record<string, number> {
  const counts = new Map<string, number>();
  for (const n of graph.nodes) {
    const unit = unitOfFile(n.source_file);
    if (unit !== null) {
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }
  }
  const out: Record<string, number> = {};
  for (const key of [...counts.keys()].sort(compare)) {
    out[key] = counts.get(key) ?? 0;
  }
  return out;
}

/** `community` 속성의 서로 다른 값 수(속성이 없으면 0). */
export function countCommunities(graph: Graph): number {
  const values = new Set<string>();
  for (const n of graph.nodes) {
    if (n.community !== undefined && n.community !== null) {
      values.add(String(n.community));
    }
  }
  return values.size;
}

/** STD §18.4 형식(키 순서 고정). */
export function computeMetrics(graph: Graph, input: MetricsInput): Metrics {
  const cross = crossServiceEdges(graph);
  return {
    int_id: input.intId,
    created_at: input.createdAt,
    graphify_version: input.graphifyVersion,
    commit: input.commit,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    communities: countCommunities(graph),
    nodes_by_unit: nodesByUnit(graph),
    god_nodes_top10: godNodes(graph, 10),
    cross_service_edges: cross,
    cross_service_edge_count: cross.length,
    audit_graph: input.audit,
  };
}
