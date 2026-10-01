import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Graph } from '../../src/god-nodes.js';
import { computeMetrics, countCommunities, crossServiceEdges, nodesByUnit, unitOfFile } from '../../src/snapshot.js';

const load = (name: string): Graph =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as Graph;

const input = {
  intId: 'INT-1a',
  createdAt: 1_790_000_000_000,
  graphifyVersion: '0.9.72',
  commit: 'abc1234',
  audit: { exit: 0, skipped: false },
};

describe('computeMetrics', () => {
  it('UT-GRAPH-001 metrics는 STD §18.4 키 순서를 지키고 노드·엣지 수를 센다 [NFR-MAINT-001][PR-008]', () => {
    const graph = load('graph-violations.json');
    const m = computeMetrics(graph, input);
    expect(Object.keys(m)).toEqual([
      'int_id',
      'created_at',
      'graphify_version',
      'commit',
      'nodes',
      'edges',
      'communities',
      'nodes_by_unit',
      'god_nodes_top10',
      'cross_service_edges',
      'cross_service_edge_count',
      'audit_graph',
    ]);
    expect(m.nodes).toBe(graph.nodes.length);
    expect(m.edges).toBe(graph.edges.length);
    expect(m.nodes).toBe(58);
    expect(m.edges).toBe(96);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it('UT-GRAPH-002 communities는 community 속성의 서로 다른 값 수이고 속성이 없으면 0이다 [NFR-MAINT-001][PR-008]', () => {
    expect(computeMetrics(load('graph-violations.json'), input).communities).toBe(0);
    expect(computeMetrics(load('graph-cross.json'), input).communities).toBe(4);
    const mixed: Graph = {
      nodes: [
        { id: 'a', community: 1 },
        { id: 'b', community: '1' },
        { id: 'c', community: 2 },
        { id: 'd', community: null },
        { id: 'e' },
      ],
      edges: [],
    };
    expect(countCommunities(mixed)).toBe(2);
  });

  it('UT-GRAPH-003 nodes_by_unit은 단위별 노드 수이고 키가 사전순이며 단위 없는 노드는 제외한다 [NFR-MAINT-001][PR-008]', () => {
    const byUnit = nodesByUnit(load('graph-cross.json'));
    expect(Object.keys(byUnit)).toEqual([
      'apps/web',
      'packages/contracts',
      'services/a',
      'services/b',
      'tests',
      'tools/gates',
    ]);
    expect(byUnit).toEqual({
      'apps/web': 1,
      'packages/contracts': 1,
      'services/a': 4,
      'services/b': 3,
      tests: 1,
      'tools/gates': 1,
    });
    const odd: Graph = {
      nodes: [{ id: 'x', source_file: 'README.md' }, { id: 'y' }, { id: 'z', source_file: 'services/q/src/z.ts' }],
      edges: [],
    };
    expect(nodesByUnit(odd)).toEqual({ 'services/q': 1 });
    expect(unitOfFile('apps/web/src/a.ts')).toBe('apps/web');
    expect(unitOfFile('tests/e2e/x.spec.ts')).toBe('tests');
    expect(unitOfFile(null)).toBeNull();
  });

  it('UT-GRAPH-004 cross_service_edges는 서비스↔서비스·앱↔서비스 import만 중복 없이 사전순으로 낸다 [NFR-MAINT-001][PR-008]', () => {
    const edges = crossServiceEdges(load('graph-cross.json'));
    expect(edges).toEqual([
      { from: 'apps/web/src/app.ts', to: 'services/a/src/x.ts', relation: 'imports' },
      { from: 'services/a/src/x.ts', to: 'services/b/src/y.ts', relation: 'imports_from' },
      { from: 'services/a/src/y.ts', to: 'services/b/src/z.ts', relation: 'dynamic_import' },
      { from: 'services/b/src/z.ts', to: 'apps/web/src/app.ts', relation: 're_exports' },
    ]);
  });

  it('UT-GRAPH-005 ref_ 대상·package.json 출처·같은 단위·packages 대상·calls/contains 관계는 교차 엣지에서 제외한다 [NFR-MAINT-001][PR-008]', () => {
    const base = graphWith([
      ['svc_a', 'services/a/src/x.ts'],
      ['svc_b', 'services/b/src/y.ts'],
      ['ref_zod', 'services/a/package.json'],
      ['pkg', 'packages/contracts/src/index.ts'],
      ['json', 'services/a/package.json'],
      ['tool', 'tools/gates/x.mjs'],
    ]);
    const only = (source: string, target: string, relation: string): Graph => ({
      nodes: base.nodes,
      edges: [{ source, target, relation }],
    });
    expect(crossServiceEdges(only('svc_a', 'svc_b', 'imports_from'))).toHaveLength(1);
    expect(crossServiceEdges(only('svc_a', 'ref_zod', 'imports_from'))).toHaveLength(0);
    expect(crossServiceEdges(only('svc_a', 'pkg', 'imports_from'))).toHaveLength(0);
    expect(crossServiceEdges(only('pkg', 'svc_a', 'imports_from'))).toHaveLength(0);
    expect(crossServiceEdges(only('json', 'svc_b', 'imports'))).toHaveLength(0);
    expect(crossServiceEdges(only('tool', 'svc_a', 'imports'))).toHaveLength(0);
    expect(crossServiceEdges(only('svc_a', 'svc_a', 'imports'))).toHaveLength(0);
    expect(crossServiceEdges(only('svc_a', 'svc_b', 'calls'))).toHaveLength(0);
    expect(crossServiceEdges(only('svc_a', 'svc_b', 'contains'))).toHaveLength(0);
    expect(crossServiceEdges(only('svc_a', 'missing_node', 'imports_from'))).toHaveLength(0);
  });

  it('UT-GRAPH-006 SP-7 위반 그래프의 교차 엣지는 파일 쌍으로 집계되고 count가 목록 길이와 같다 [NFR-MAINT-001][PR-008]', () => {
    const graph = load('graph-violations.json');
    const m = computeMetrics(graph, input);
    expect(m.cross_service_edge_count).toBe(m.cross_service_edges.length);
    const pairs = m.cross_service_edges.map((e) => `${e.from} -> ${e.to} (${e.relation})`);
    expect(pairs).toContain('services/a/src/cross.ts -> services/b/src/local.ts (imports_from)');
    expect(pairs).toContain('services/a/src/cross.ts -> services/b/src/local.ts (dynamic_import)');
    expect(pairs).toContain('services/a/src/cross.ts -> services/b/src/local.ts (re_exports)');
    expect(pairs).toContain('services/a/src/alias-evasion.ts -> services/b/src/index.ts (imports_from)');
    expect(pairs).toContain('apps/web/src/leak.ts -> services/a/src/index.ts (imports_from)');
    expect(pairs.some((p) => p.startsWith('packages/contracts/src/leak.ts'))).toBe(false);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('UT-GRAPH-007 audit_graph 필드는 입력 그대로 전달된다 [NFR-MAINT-001][PR-008]', () => {
    const graph = load('graph-cross.json');
    expect(computeMetrics(graph, { ...input, audit: { exit: 1, skipped: false } }).audit_graph).toEqual({
      exit: 1,
      skipped: false,
    });
    expect(computeMetrics(graph, { ...input, audit: { exit: null, skipped: true } }).audit_graph).toEqual({
      exit: null,
      skipped: true,
    });
  });

  it('UT-GRAPH-008 int_id·created_at·graphify_version·commit은 주입값 그대로이고 같은 입력은 같은 결과다 [NFR-MAINT-001][PR-008]', () => {
    const graph = load('graph-cross.json');
    const a = computeMetrics(graph, { ...input, graphifyVersion: 'unavailable', commit: 'unknown', intId: 'PG-3' });
    expect(a.int_id).toBe('PG-3');
    expect(a.created_at).toBe(1_790_000_000_000);
    expect(a.graphify_version).toBe('unavailable');
    expect(a.commit).toBe('unknown');
    expect(JSON.stringify(computeMetrics(graph, input))).toBe(JSON.stringify(computeMetrics(graph, input)));
  });

  it('UT-GRAPH-009 god_nodes_top10은 최대 10개이고 교차 엣지 count와 별개로 계산된다 [NFR-MAINT-001][PR-008]', () => {
    const m = computeMetrics(load('graph-violations.json'), input);
    expect(m.god_nodes_top10.length).toBeLessThanOrEqual(10);
    expect(m.god_nodes_top10.length).toBeGreaterThan(0);
    for (let i = 1; i < m.god_nodes_top10.length; i++) {
      expect((m.god_nodes_top10[i - 1]?.degree ?? 0) >= (m.god_nodes_top10[i]?.degree ?? 0)).toBe(true);
    }
    expect(m.god_nodes_top10.every((n) => !n.source_file.endsWith('package.json'))).toBe(true);
  });
});

function graphWith(nodes: [string, string][]): Graph {
  return { nodes: nodes.map(([id, source_file]) => ({ id, label: id, source_file })), edges: [] };
}
