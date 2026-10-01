import { z } from 'zod';
import { ContextBlock } from '../../../ai/data-class.js';
import { TaskId } from '../../../ai/tasks.js';
import { DataClass } from '../../../common/domain.js';
import { ObjKey, PolicyRef, ProviderId, Ulid } from '../../../common/ids.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const FirewallAction = z.enum(['pass', 'masked', 'force_local', 'block']);
export type FirewallAction = z.infer<typeof FirewallAction>;
export const UserPattern = S({ pattern_id: Ulid, kind: z.enum(['domain', 'employee_id', 'project_code', 'regex', 'literal']), value: z.string().min(2).max(500) });
export type UserPattern = z.infer<typeof UserPattern>;
export const FirewallPatterns = S({
  builtin_policy: PolicyRef, builtin_rule_ids: z.array(z.string().max(60)).max(200),
  user_patterns: z.array(UserPattern.extend({ created_at: EpochMs })).max(500),
  local_classifier: S({ enabled: z.boolean(), provider_id: z.literal('ollama').nullable() }),
});
export type FirewallPatterns = z.infer<typeof FirewallPatterns>;
export const PutFirewallPatternsBody = S({ user_patterns: z.array(UserPattern).max(500), local_classifier_enabled: z.boolean() });
export type PutFirewallPatternsBody = z.infer<typeof PutFirewallPatternsBody>;
export const FirewallLogEntry = S({ decision_id: Ulid, ts: EpochMs, task_id: TaskId.nullable(), provider_id: ProviderId.nullable(),
  data_class: DataClass, rule_hits: z.array(z.string().max(60)).max(50), action: FirewallAction });
export type FirewallLogEntry = z.infer<typeof FirewallLogEntry>;
export const FirewallPreviewBody = S({ blocks: z.array(ContextBlock).min(1).max(16), route: z.enum(['external', 'local_only']) });
export type FirewallPreviewBody = z.infer<typeof FirewallPreviewBody>;
export const FirewallPreviewResult = S({ action: FirewallAction, data_class: DataClass,
  masks: z.array(S({ block_key: ObjKey, start: z.number().int(), end: z.number().int(), token: z.string().regex(/^⟨SECRET_\d{1,4}⟩$/), rule_id: z.string().max(60) })).max(500),
  masked_blocks: z.array(S({ key: ObjKey, text: z.string() })).max(16) });
export type FirewallPreviewResult = z.infer<typeof FirewallPreviewResult>;
