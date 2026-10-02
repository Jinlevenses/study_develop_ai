// R-POOL — 트랙마다 cap 계산(§4.6) 결과의 blocker를 finding 1개로 요약. blocker가 있으면 warn, --release면 error.
// 판정은 반드시 @fathom/contracts/pack/feasibility의 structuralFeasibility() 호출(lint/inventory.ts) — 재구현 0.

import type { Finding } from '../../validate/finding.js';
import { finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';
import { buildInventory, computeCap } from '../inventory.js';

export function rulePool(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const p of ctx.model.packs) {
    const concepts = ctx.model.concepts.filter((c) => c.disc.track === p.data.id);
    const inv = buildInventory(p.data.id, concepts, ctx.idx, ctx.method);
    const cap = computeCap(ctx.mastery, inv);
    if (cap.offline_cap_level >= 5) {
      continue;
    }
    const k = cap.offline_cap_level;
    const key = `L${k}` as 'L1' | 'L2' | 'L3' | 'L4';
    const codes = cap.blockers[key].OFFLINE.map((b) => b.code).join(',');
    out.push(
      finding(
        'R-POOL',
        ctx.release ? 'error' : 'warn',
        p.rel,
        '',
        `cap OFFLINE=L${cap.offline_cap_level} FULL=L${cap.oracle_cap_level}; L${k}→L${k + 1} OFFLINE: ${codes}`,
      ),
    );
  }
  return out;
}
