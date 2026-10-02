// R-LVL — 선수 p, 개념 c: level(p) > level(c)+1 = error · level(p) > level(c) = warn.
import { finding } from '../../validate/finding.js';
import type { Finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';

export function ruleLvl(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const c of ctx.model.concepts) {
    for (const [i, p] of c.data.prereqs.entries()) {
      const pc = ctx.idx.conceptById.get(p);
      if (pc === undefined) {
        continue;
      }
      const msg = `prereq ${p} (L${pc.data.level}) is above ${c.data.id} (L${c.data.level})`;
      if (pc.data.level > c.data.level + 1) {
        out.push(finding('R-LVL', 'error', c.rel, `prereqs.${i}`, msg));
      } else if (pc.data.level > c.data.level) {
        out.push(finding('R-LVL', 'warn', c.rel, `prereqs.${i}`, msg));
      }
    }
  }
  return out;
}
