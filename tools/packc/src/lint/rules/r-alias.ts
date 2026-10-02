// R-ALIAS — title.ko에 한글이 있으면 aliases에 영문자를 포함한 항목 ≥ 1.
import { finding } from '../../validate/finding.js';
import type { Finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';

export function ruleAlias(ctx: LintContext): Finding[] {
  const out: Finding[] = [];
  for (const c of ctx.model.concepts) {
    if (/[가-힣]/.test(c.data.title.ko) && !c.data.aliases.some((a) => /[A-Za-z]/.test(a))) {
      out.push(finding('R-ALIAS', 'error', c.rel, 'aliases', 'Korean title needs at least one alias containing Latin letters'));
    }
  }
  return out;
}
