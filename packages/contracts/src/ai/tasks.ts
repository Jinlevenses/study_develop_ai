import { z } from 'zod';
import { DataClass } from '../common/domain.js';
import { ProviderId } from '../common/ids.js';
import { S } from '../common/schema.js';

export const JudgeTaskId = z.enum(['AI-J01', 'AI-J02', 'AI-J03', 'AI-J04', 'AI-J05', 'AI-J06', 'AI-J07', 'AI-J08', 'AI-J09', 'AI-J10',
  'AI-J11', 'AI-J12', 'AI-J13', 'AI-J14', 'AI-J15', 'AI-J16', 'AI-J17', 'AI-J18', 'AI-J19']);
export type JudgeTaskId = z.infer<typeof JudgeTaskId>;
export const GenerateTaskId = z.enum(['AI-G01', 'AI-G02', 'AI-G03', 'AI-G04', 'AI-G05', 'AI-G06', 'AI-G07', 'AI-G08', 'AI-G09',
  'AI-G10', 'AI-G11', 'AI-G12', 'AI-G13']);                                   // "정답 대필" 과업은 enum에 존재하지 않는다
export type GenerateTaskId = z.infer<typeof GenerateTaskId>;
export const TaskId = z.union([JudgeTaskId, GenerateTaskId]);
export type TaskId = z.infer<typeof TaskId>;
export const SystemTaskId = z.enum(['SYS-CANARY', 'SYS-SMOKE', 'SYS-FWCLS']);     // ai-gateway 내부 전용(HTTP 라우팅 불가) — ai_call_log.task_id·캐시 정책 키(D-AI-10)
export type SystemTaskId = z.infer<typeof SystemTaskId>;
export const TaskRegistryEntry = S({                                         // tasks.yaml 한 항목(ADR-005 §4)
  kind: z.enum(['judge', 'generate']), lane: z.enum(['interactive', 'conversational', 'background']),
  chain: z.array(z.enum(['jev', 'llm-judge', 'llm'])).min(1).max(3), question_types: z.array(z.enum(['noul', 'choice', 'score'])).max(3).optional(),
  max_questions_per_request: z.number().int().min(1).max(15).optional(), schema: z.string().regex(/^ai\/[A-Za-z]+@\d+$/).optional(),
  tier: z.enum(['low', 'mid', 'high']).optional(), prompt: S({ id: TaskId, channel: z.enum(['active', 'candidate']) }).optional(),
  prefer: z.array(ProviderId).max(10).optional(), deny: z.record(ProviderId, z.array(z.string().max(40))).optional(),
  data_class_max: DataClass, family_constraint: z.enum(['none', 'different_from_generator']), deadline_ms: z.number().int().min(100).max(600_000),
  requires_work_order: z.boolean(),
});
export type TaskRegistryEntry = z.infer<typeof TaskRegistryEntry>;
