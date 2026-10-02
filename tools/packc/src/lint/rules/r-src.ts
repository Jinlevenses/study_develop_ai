// R-SRC — 개념 sources 수: Tier A ≥ 2 · B ≥ 1 · C ≥ 1.

import type { Finding } from '../../validate/finding.js';
import { finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';

const MIN: Readonly<Record<'A' | 'B' | 'C', number>> = { A: 2, B: 1, C: 1 };

export function ruleSrc(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const c of ctx.model.concepts) {
    const min = MIN[c.data.tier];
    if (c.data.sources.length < min) {
      out.push(
        finding(
          'R-SRC',
          'error',
          c.rel,
          'sources',
          `Tier ${c.data.tier} needs at least ${min} sources (has ${c.data.sources.length})`,
        ),
      );
    }
  }
  return out;
}
