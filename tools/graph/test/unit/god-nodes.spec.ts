import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CliDeps, run } from '../../src/cli.js';
import { type Graph, godNodes } from '../../src/god-nodes.js';
import { computeMetrics } from '../../src/snapshot.js';

const fixture = (name: string): string => new URL(`../fixtures/${name}`, import.meta.url).pathname;
const load = (name: string): Graph => JSON.parse(readFileSync(fixture(name), 'utf8')) as Graph;

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-graph-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function deps(over: Partial<CliDeps> = {}): { deps: CliDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      now: () => 1_790_000_000_000,
      graphifyVersion: () => '0.9.72',
      commit: () => 'abc1234',
      audit: () => ({ exit: null, skipped: true }),
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      ...over,
    },
  };
}

/** root에 graphify-out/graph.json을 복사한 임시 저장소를 만든다. */
function repoWithGraph(name = 'graph-cross.json'): string {
  const root = tmp();
  mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
  writeFileSync(path.join(root, 'graphify-out', 'graph.json'), readFileSync(fixture(name)));
  return root;
}

/** 심볼릭 링크 디렉터리 경유로 cli.ts 를 직접 실행한다(isEntry realpath 비교 회귀: 침묵 exit 0 금지). */
function runViaSymlink(args: string[]): { status: number | null; stderr: string } {
  const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-cli-link-'));
  try {
    const link = path.join(dir, 'lnk');
    symlinkSync(srcDir, link, 'dir');
    const r = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--import',
        'tsx',
        '--conditions=source',
        path.join(link, 'cli.ts'),
        ...args,
      ],
      { encoding: 'utf8', cwd: path.resolve(srcDir, '..') },
    );
    return { status: r.status, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('godNodes', () => {
  it('UT-GRAPH-010 godNodes는 degree 내림차순 → label 오름차순 → id 오름차순으로 정렬하고 동률을 안정적으로 푼다 [NFR-MAINT-001][PR-008]', () => {
    const g: Graph = {
      nodes: [
        { id: 'z', label: 'Same', source_file: 'services/a/src/z.ts' },
        { id: 'y', label: 'Same', source_file: 'services/a/src/y.ts' },
        { id: 'x', label: 'Alpha', source_file: 'services/a/src/x.ts' },
        { id: 'hub', label: 'Hub', source_file: 'services/a/src/hub.ts' },
      ],
      edges: [
        { source: 'hub', target: 'z' },
        { source: 'hub', target: 'y' },
        { source: 'hub', target: 'x' },
      ],
    };
    expect(godNodes(g).map((n) => [n.label, n.degree, n.source_file])).toEqual([
      ['Hub', 3, 'services/a/src/hub.ts'],
      ['Alpha', 1, 'services/a/src/x.ts'],
      ['Same', 1, 'services/a/src/y.ts'],
      ['Same', 1, 'services/a/src/z.ts'],
    ]);
  });

  it('UT-GRAPH-011 godNodes는 ref_ 노드와 package.json 노드를 제외하지만 그 엣지는 상대 노드의 degree에 센다 [NFR-MAINT-001][PR-008]', () => {
    const top = godNodes(load('graph-gods.json'));
    expect(top.map((n) => n.label)).toEqual(['Alpha', 'Beta', 'Gamma', 'Alpha', 'Delta']);
    expect(top.map((n) => n.degree)).toEqual([6, 4, 3, 2, 2]);
    expect(top.some((n) => n.label === 'external' || n.label === 'package.json')).toBe(false);
  });

  it('UT-GRAPH-012 godNodes는 top N으로 자르고 기본값은 10이며 전 relation의 엣지를 센다 [NFR-MAINT-001][PR-008]', () => {
    const g = load('graph-gods.json');
    expect(godNodes(g, 2).map((n) => n.degree)).toEqual([6, 4]);
    expect(godNodes(g, 0)).toEqual([]);
    expect(godNodes(g, 100)).toHaveLength(5);
    const big: Graph = {
      nodes: Array.from({ length: 15 }, (_, i) => ({
        id: `n${i}`,
        label: `n${String(i).padStart(2, '0')}`,
        source_file: `services/a/src/n${i}.ts`,
      })),
      edges: [],
    };
    expect(godNodes(big)).toHaveLength(10);
    const loop: Graph = { nodes: [{ id: 'a', label: 'a' }], edges: [{ source: 'a', target: 'a', relation: 'calls' }] };
    expect(godNodes(loop)[0]?.degree).toBe(1);
  });
});

describe('cli', () => {
  it('UT-GRAPH-013 graph 파일이 없으면 exit 2와 "graph missing" 안내를 낸다 [NFR-MAINT-001][PR-008]', () => {
    const root = tmp();
    const d = deps();
    expect(run(['snapshot', '--int', 'INT-1a', '--root', root], d.deps)).toBe(2);
    expect(d.err.join('\n')).toMatch(/graph missing — run graphify update \. first/);
    expect(existsSync(path.join(root, 'docs'))).toBe(false);
    const bad = tmp();
    mkdirSync(path.join(bad, 'graphify-out'));
    writeFileSync(path.join(bad, 'graphify-out', 'graph.json'), '{ nope');
    expect(run(['snapshot', '--int', 'INT-1a', '--root', bad], deps().deps)).toBe(2);
    writeFileSync(path.join(bad, 'graphify-out', 'graph.json'), '{"nodes": []}');
    expect(run(['snapshot', '--int', 'INT-1a', '--root', bad], deps().deps)).toBe(2);
  });

  it('UT-GRAPH-014 --int 형식 오류·누락·알 수 없는 옵션·명령은 exit 2다 [NFR-MAINT-001][PR-008]', () => {
    const root = repoWithGraph();
    for (const argv of [
      ['snapshot', '--int', 'INT-9', '--root', root],
      ['snapshot', '--int', 'int-1a', '--root', root],
      ['snapshot', '--root', root],
      ['snapshot', '--int'],
      ['snapshot', '--int', 'INT-1a', '--bogus', '1'],
      ['frobnicate'],
      ['snapshot', 'extra'],
      ['god-nodes', '--top', '0', '--root', root],
      ['god-nodes', '--top', 'abc', '--root', root],
    ]) {
      const d = deps();
      expect(run(argv, d.deps), argv.join(' ')).toBe(2);
      expect(d.err.length).toBeGreaterThan(0);
    }
    // 심볼릭 링크 경유 직접 실행도 침묵 exit 0 이 아니라 실제로 run() 을 호출한다
    const linked = runViaSymlink(['frobnicate']);
    expect(linked.status).toBe(2);
    expect(linked.stderr).toMatch(/\[graph\]/);
    for (const id of ['INT-1a', 'INT-1b', 'INT-2', 'INT-7', 'PG-3']) {
      expect(run(['snapshot', '--int', id, '--root', root, '--out', path.join(root, 'o')], deps().deps)).toBe(0);
    }
  });

  it('UT-GRAPH-015 snapshot은 <out>/<id>/metrics.json을 2칸 들여쓰기와 끝 줄바꿈으로 쓴다 [NFR-MAINT-001][PR-008]', () => {
    const root = repoWithGraph();
    const out = path.join(root, 'out');
    const d = deps({ audit: () => ({ exit: 0, skipped: false }) });
    expect(run(['--int', 'INT-1a', '--root', root, '--out', out], d.deps)).toBe(0);
    const file = path.join(out, 'INT-1a', 'metrics.json');
    const text = readFileSync(file, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.startsWith('{\n  "int_id": "INT-1a",\n  "created_at": 1790000000000,')).toBe(true);
    const expected = computeMetrics(load('graph-cross.json'), {
      intId: 'INT-1a',
      createdAt: 1_790_000_000_000,
      graphifyVersion: '0.9.72',
      commit: 'abc1234',
      audit: { exit: 0, skipped: false },
    });
    expect(JSON.parse(text)).toEqual(expected);
    expect(text).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(d.out.join('\n')).toMatch(/INT-1a: 11 nodes, 13 edges, 4 cross-service edge/);
    // --graph 와 --root 상대 경로
    mkdirSync(path.join(root, 'alt'));
    writeFileSync(path.join(root, 'alt', 'g.json'), readFileSync(fixture('graph-violations.json')));
    expect(
      run(['snapshot', '--int', 'INT-2', '--root', root, '--graph', 'alt/g.json', '--out', 'out2'], deps().deps),
    ).toBe(0);
    expect(
      (JSON.parse(readFileSync(path.join(root, 'out2', 'INT-2', 'metrics.json'), 'utf8')) as { nodes: number }).nodes,
    ).toBe(58);
  });

  it('UT-GRAPH-016 GRAPH_REPORT.md가 있으면 스냅샷 디렉터리로 복사하고 없으면 만들지 않는다 [NFR-MAINT-001][PR-008]', () => {
    const root = repoWithGraph();
    const out = path.join(root, 'out');
    expect(run(['snapshot', '--int', 'INT-1a', '--root', root, '--out', out], deps().deps)).toBe(0);
    expect(existsSync(path.join(out, 'INT-1a', 'GRAPH_REPORT.md'))).toBe(false);
    writeFileSync(path.join(root, 'graphify-out', 'GRAPH_REPORT.md'), '# report\n');
    expect(run(['snapshot', '--int', 'INT-1b', '--root', root, '--out', out], deps().deps)).toBe(0);
    expect(readFileSync(path.join(out, 'INT-1b', 'GRAPH_REPORT.md'), 'utf8')).toBe('# report\n');
  });

  it('UT-GRAPH-017 graphify가 없으면 graphify_version은 "unavailable"이고 git이 없으면 commit은 "unknown"이다 [NFR-MAINT-001][PR-008]', () => {
    const root = repoWithGraph();
    vi.stubEnv('PATH', '');
    const out = path.join(root, 'out');
    // 기본 탐지 경로(graphify·git 모두 PATH에 없음)를 쓴다
    const defaults = run(['snapshot', '--int', 'INT-1a', '--root', root, '--out', out]);
    expect(defaults).toBe(0);
    const m = JSON.parse(readFileSync(path.join(out, 'INT-1a', 'metrics.json'), 'utf8')) as {
      graphify_version: string;
      commit: string;
      audit_graph: { exit: number | null; skipped: boolean };
    };
    expect(m.graphify_version).toBe('unavailable');
    expect(m.commit).toBe('unknown');
    expect(m.audit_graph).toEqual({ exit: null, skipped: true });
  });

  it('UT-GRAPH-018 audit_graph는 게이트 스크립트가 없으면 skipped이고 있으면 그 exit를 기록한다 [NFR-MAINT-001][PR-008]', () => {
    const root = repoWithGraph();
    const out = path.join(root, 'out');
    vi.stubEnv('PATH', '');
    expect(run(['snapshot', '--int', 'INT-1a', '--root', root, '--out', out])).toBe(0);
    const read = (id: string): { audit_graph: unknown } =>
      JSON.parse(readFileSync(path.join(out, id, 'metrics.json'), 'utf8')) as { audit_graph: unknown };
    expect(read('INT-1a').audit_graph).toEqual({ exit: null, skipped: true });
    mkdirSync(path.join(root, 'tools', 'gates'), { recursive: true });
    writeFileSync(path.join(root, 'tools', 'gates', 'check-graphify-edges.mjs'), 'process.exit(1);\n');
    expect(run(['snapshot', '--int', 'INT-1b', '--root', root, '--out', out])).toBe(0);
    expect(read('INT-1b').audit_graph).toEqual({ exit: 1, skipped: false });
    writeFileSync(path.join(root, 'tools', 'gates', 'check-graphify-edges.mjs'), 'process.exit(0);\n');
    expect(run(['snapshot', '--int', 'INT-2', '--root', root, '--out', out])).toBe(0);
    expect(read('INT-2').audit_graph).toEqual({ exit: 0, skipped: false });
  });

  it('UT-GRAPH-019 god-nodes 명령은 표 또는 --json 으로 상위 노드를 출력한다 [NFR-MAINT-001][PR-008]', () => {
    const root = repoWithGraph('graph-gods.json');
    const table = deps();
    expect(run(['god-nodes', '--top', '2', '--root', root], table.deps)).toBe(0);
    expect(table.out[0]).toBe('degree  label  source_file');
    expect(table.out).toHaveLength(3);
    expect(table.out[1]).toBe('     6  Alpha  services/a/src/a.ts');
    const json = deps();
    expect(run(['god-nodes', '--json', '--top', '3', '--root', root], json.deps)).toBe(0);
    expect(JSON.parse(json.out[0] ?? '[]')).toEqual([
      { label: 'Alpha', degree: 6, source_file: 'services/a/src/a.ts' },
      { label: 'Beta', degree: 4, source_file: 'services/a/src/b.ts' },
      { label: 'Gamma', degree: 3, source_file: 'services/a/src/c.ts' },
    ]);
    expect(run(['god-nodes', '--root', root], deps().deps)).toBe(0);
    expect(run(['god-nodes', '--root', tmp()], deps().deps)).toBe(2);
  });
});
