// R-REQ — Tier A/B: required_for_level === level · Tier C: null.
import { finding } from '../../validate/finding.js';
import type { Finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';

export function ruleReq(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const c of ctx.model.concepts) {
    const { tier, level, required_for_level: req } = c.data;
    if (tier === 'C') {
      if (req !== null) {
        out.push(finding('R-REQ', 'error', c.rel, 'required_for_level', 'Tier C must have required_for_level: null'));
      }
    } else if (req !== level) {
      out.push(finding('R-REQ', 'error', c.rel, 'required_for_level', `Tier ${tier} must have required_for_level = level (${level})`));
    }
  }
  return out;
}
