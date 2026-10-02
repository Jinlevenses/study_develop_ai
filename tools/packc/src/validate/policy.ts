// 정책 로드(Brief T-01-03 §4.6): loadPolicy('mastery_rules'|'method_policy', 1, { policyDir, schema }) — 실패 = 엔진 고장(exit 2).
import { MasteryRulesV1 } from '@fathom/contracts/policy/mastery_rules';
import { MethodPolicyV1 } from '@fathom/contracts/policy/method_policy';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { loadPolicy } from '@fathom/shared-kernel/policy/policy';
import type { z } from 'zod';

export type Policies = {
  readonly mastery: z.infer<typeof MasteryRulesV1>;
  readonly method: z.infer<typeof MethodPolicyV1>;
};

export function loadPolicies(policyDir: string): Result<Policies, string> {
  const mastery = loadPolicy('mastery_rules', 1, { policyDir, schema: MasteryRulesV1 });
  if (!mastery.ok) {
    return err(`policy ${mastery.error.ref}: ${mastery.error.reason}: ${mastery.error.detail}`);
  }
  const method = loadPolicy('method_policy', 1, { policyDir, schema: MethodPolicyV1 });
  if (!method.ok) {
    return err(`policy ${method.error.ref}: ${method.error.reason}: ${method.error.detail}`);
  }
  return ok({ mastery: mastery.value.value, method: method.value.value });
}
