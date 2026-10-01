// god-nodes: graphify 그래프에서 연결이 가장 많은 노드(리뷰 입력, STD §18.4). 순수 함수 — 파일 I/O 없음.

export interface GraphNode {
  id: string;
  label?: string;
  source_file?: string | null;
  source_location?: string | null;
  community?: number | string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation?: string;
  confidence?: string;
  source_file?: string | null;
  source_location?: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GodNode {
  label: string;
  degree: number;
  source_file: string;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 제외 대상: 외부 패키지 참조 노드(`ref_`)와 package.json 의존 목록 노드. */
export function isExcludedNode(node: GraphNode): boolean {
  return node.id.startsWith('ref_') || (node.source_file ?? '').endsWith('package.json');
}

/** degree = 그 노드가 source 또는 target인 엣지 수(전 relation, 자기 루프는 1). */
export function degrees(graph: Graph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of graph.edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    if (e.target !== e.source) {
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
  }
  return deg;
}

/** 상위 `top`개. 정렬 = degree 내림차순 → label 오름차순 → id 오름차순. */
export function godNodes(graph: Graph, top = 10): GodNode[] {
  const deg = degrees(graph);
  return graph.nodes
    .filter((n) => !isExcludedNode(n))
    .map((n) => ({ id: n.id, label: n.label ?? n.id, degree: deg.get(n.id) ?? 0, source_file: n.source_file ?? '' }))
    .sort((a, b) => b.degree - a.degree || compare(a.label, b.label) || compare(a.id, b.id))
    .slice(0, Math.max(0, top))
    .map(({ label, degree, source_file }) => ({ label, degree, source_file }));
}
