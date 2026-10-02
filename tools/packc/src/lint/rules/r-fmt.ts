// R-FMT — V1 사전 검사(validate/v1-schema.ts)와 짝: method_policy@v1.formats 키 집합 = FormatId.options(33).
import { FormatId } from '@fathom/contracts/common/domain';
import { byCode, finding } from '../../validate/finding.js';
import type { Finding } from '../../validate/finding.js';
import type { LintContext } from '../../validate/model.js';

export const METHOD_POLICY_REL = 'policy/method_policy@v1.yaml';

export function ruleFmt(ctx: LintContext): Finding[] {
  const keys = new Set(Object.keys(ctx.method.formats));
  const want = new Set<string>(FormatId.options);
  const out: Finding[] = [];
  const missing = [...want].filter((f) => !keys.has(f)).sort(byCode);
  const extra = [...keys].filter((f) => !want.has(f)).sort(byCode);
  if (missing.length > 0) {
    out.push(finding('R-FMT', 'error', METHOD_POLICY_REL, 'formats', `missing formats: ${missing.join(',')}`));
  }
  if (extra.length > 0) {
    out.push(finding('R-FMT', 'error', METHOD_POLICY_REL, 'formats', `unknown formats: ${extra.join(',')}`));
  }
  return out;
}
