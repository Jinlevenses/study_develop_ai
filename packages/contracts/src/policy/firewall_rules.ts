import { z } from 'zod';
import { DataClass } from '../common/domain.js';
import { S } from '../common/schema.js';

// [Brief 결정 §4.8·D9 — CR-43 T1 저작] policy/firewall_rules@v1.yaml 의 zod. 구조 원천 = AI-01 §10.3(27규칙) + IF §13.4 표의 `data_class_defaults`(선택)·규칙 `class`(선택).
// 정규식 문자열의 컴파일 검사는 하지 않는다(RE2 부분집합·`(?i)` 플래그는 소비 서비스가 해석).
const RuleId = z.string().regex(/^FW-(SEC|PII|NET|USR|LCL|LOC)-\d{3}$/);
const RuleName = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export const FirewallPatternRule = S({
  id: RuleId,
  name: RuleName,
  pattern: z.string().min(1).max(500),
  action: z.enum(['mask', 'block', 'force_local']),
  group: z.number().int().min(1).max(9).optional(),
  c0_action: z.literal('mask').optional(),
  span: z.literal('until_end_marker').optional(),
  except_allow_literals: z.literal(true).optional(),
  validate: z.literal('luhn').optional(),
  class: DataClass.optional(),
});
export type FirewallPatternRule = z.infer<typeof FirewallPatternRule>;
export const FirewallSourceRule = S({
  id: RuleId,
  name: RuleName,
  source: z.enum(['ai_firewall_pattern', 'SYS-FWCLS', 'request.local_only']),
  action: z.literal('force_local'),
  when: z.string().max(200).optional(),
  class: DataClass.optional(),
});
export type FirewallSourceRule = z.infer<typeof FirewallSourceRule>;
export const FirewallRulesV1 = S({
  version: z.literal('firewall_rules@v1'),
  mask_token: z.literal('⟨SECRET_{n}⟩'),
  allow_literals: z.array(z.string().min(1).max(100)).max(50),
  rules: z
    .array(z.union([FirewallPatternRule, FirewallSourceRule]))
    .min(1)
    .max(100),
  injection_patterns: z.array(z.string().min(1).max(500)).max(50),
  data_class_defaults: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), DataClass).optional(),
}).refine((v) => new Set(v.rules.map((r) => r.id)).size === v.rules.length, 'rule ids must be unique');
export type FirewallRulesV1 = z.infer<typeof FirewallRulesV1>;
