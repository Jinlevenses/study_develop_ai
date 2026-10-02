// R-DAG — 전체 트리 prereqs 그래프 순환 0. 순환(강연결 성분) 1개당 finding 1개, 가장 작은 id에서 시작하는 회전 `a → b → a`.

import type { Finding } from '../../validate/finding.js';
import { byCode, finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';

export function ruleDag(ctx: LintContext): Finding[] {
  const nodes = [...ctx.idx.conceptById.keys()].sort(byCode);
  const adj = new Map<string, string[]>();
  for (const id of nodes) {
    const c = ctx.idx.conceptById.get(id);
    adj.set(id, [...new Set(c?.data.prereqs ?? [])].filter((p) => ctx.idx.conceptById.has(p)).sort(byCode));
  }
  // Tarjan SCC
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  const strong = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      for (;;) {
        const w = stack.pop();
        if (w === undefined) {
          break;
        }
        onStack.delete(w);
        comp.push(w);
        if (w === v) {
          break;
        }
      }
      sccs.push(comp);
    }
  };
  for (const v of nodes) {
    if (!index.has(v)) {
      strong(v);
    }
  }
  const out: Finding[] = [];
  for (const comp of sccs) {
    const start = [...comp].sort(byCode)[0];
    if (start === undefined) {
      continue;
    }
    const selfLoop = (adj.get(start) ?? []).includes(start);
    if (comp.length < 2 && !selfLoop) {
      continue;
    }
    const inComp = new Set(comp);
    // start에서 start로 돌아오는 최단 경로(BFS, 이웃은 사전순)
    const queue: string[][] = [[start]];
    const seen = new Set<string>();
    let cycle: string[] = [start, start];
    while (queue.length > 0) {
      const path = queue.shift();
      if (path === undefined) {
        break;
      }
      const last: string = path[path.length - 1] ?? start;
      const neighbours: readonly string[] = adj.get(last) ?? [];
      let found = false;
      for (const w of neighbours) {
        if (!inComp.has(w)) {
          continue;
        }
        if (w === start) {
          cycle = [...path, start];
          found = true;
          break;
        }
        if (!seen.has(w)) {
          seen.add(w);
          queue.push([...path, w]);
        }
      }
      if (found) {
        break;
      }
    }
    const file = ctx.idx.conceptById.get(start)?.rel ?? '';
    out.push(finding('R-DAG', 'error', file, 'prereqs', `prerequisite cycle: ${cycle.join(' → ')}`));
  }
  return out;
}
